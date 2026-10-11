import { DefaultAzureCredential } from '@azure/identity';
import { z } from 'zod';
import type { Rng } from './rng.js';
import type { DecisionEngine, EngineResult, Snapshot } from './types.js';

/**
 * Microsoft-Decision-1 on Foundry. baseUrl is the account's services.ai.azure.com host;
 * model is the deployment name, not the catalog model ID. Entra is the default.
 */
export interface SystemOneOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  tokenProvider?: () => Promise<string>;
  timeoutMs?: number;
  /** Sample from the probabilities (variety) instead of taking the top choice (determinism). */
  sample?: boolean;
  /** USD per input token, for the cost meter. */
  pricePerInputToken?: number;
  /** Keep questions compact; this is an application cap, not a model limit. */
  maxOptions?: number;
  name?: string;
}

const responseSchema = z.object({
  answers: z.record(z.string(), z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  })),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }),
});

export class SystemOneEngine implements DecisionEngine {
  readonly name: string;
  private readonly tokenProvider: () => Promise<string>;
  constructor(private readonly o: SystemOneOptions, private readonly rng: Rng) {
    const url = new URL(o.baseUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || !o.model.trim()) throw new Error('Microsoft Decision needs an HTTPS Foundry account host and deployment name');
    this.name = o.name ?? 'Microsoft-Decision-1 (Foundry)';
    const credential = new DefaultAzureCredential();
    this.tokenProvider = o.tokenProvider ?? (async () => (await credential.getToken('https://cognitiveservices.azure.com/.default')).token);
  }

  get pricePerInputToken(): number {
    return this.o.pricePerInputToken ?? 0.042 / 1_000_000;
  }

  async decide(s: Snapshot): Promise<EngineResult> {
    const questions: Record<string, unknown> = {};
    const offered = new Map<string, Set<string>>();
    if (s.agents.some((a) => !a.options.length)) throw new Error('Microsoft Decision question has no valid options');
    const asked = s.agents.filter((a) => a.options.length > 1);
    for (const a of asked) {
      // Shuffle to counter first-option bias; cap the count for small models.
      const opts = this.rng.shuffle(a.options).slice(0, this.o.maxOptions ?? 12);
      offered.set(a.agentId, new Set(opts.map((o) => o.key)));
      questions[a.agentId] = {
        type: 'choice',
        instructions: {
          you: a.identity,
          what_you_see: a.seeing,
          ...(a.instruction ? { instruction_from_the_plan: a.instruction } : {}),
          question: a.question,
        },
        criteria: Object.fromEntries(opts.map((o) => [o.key, o.text])),
      };
    }
    const t0 = performance.now();
    let answers: z.infer<typeof responseSchema>['answers'] = {};
    let inputTokens = 0;
    if (asked.length) {
      const auth: Record<string, string> = this.o.apiKey ? { 'api-key': this.o.apiKey } : { authorization: `Bearer ${await this.tokenProvider()}` };
      const res = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/providers/microsoft/v1/systemone`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...auth,
        },
        // Keys starting with _ are for code only (e.g. the rule engine's raw plan), never sent to the model.
        body: JSON.stringify({ state: Object.fromEntries(Object.entries(s.shared).filter(([k]) => !k.startsWith('_'))), questions, ...(this.o.model ? { model: this.o.model } : {}) }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 5000),
      });
      if (!res.ok) throw new Error(`systemone ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = responseSchema.parse(await res.json());
      answers = body.answers;
      inputTokens = body.usage.input_tokens;
      for (const a of asked) {
        const ans = answers[a.agentId];
        const keys = offered.get(a.agentId)!;
        if (!ans || !keys.has(ans.choice) || Object.keys(ans.probabilities).length !== keys.size ||
            [...keys].some((k) => ans.probabilities[k] === undefined) ||
            Math.abs(Object.values(ans.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.01) {
          throw new Error(`Invalid Microsoft Decision answer for ${a.agentId}`);
        }
      }
    }
    const latencyMs = performance.now() - t0;
    const decisions = s.agents.map((a) => {
      const ans = answers[a.agentId];
      if (a.options.length === 1) return { agentId: a.agentId, key: a.options[0].key, probabilities: { [a.options[0].key]: 1 }, confidence: 1 };
      const key = this.o.sample === false ? ans.choice : this.rng.pickWeighted(ans.probabilities);
      return { agentId: a.agentId, key, probabilities: ans.probabilities, confidence: ans.confidence };
    });
    return { decisions, latencyMs, inputTokens, engine: this.name };
  }
}
