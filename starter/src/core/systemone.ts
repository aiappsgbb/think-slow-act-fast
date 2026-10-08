import type { Rng } from './rng.js';
import type { DecisionEngine, EngineResult, Snapshot } from './types.js';

/**
 * Decision model over the System One contract: POST {baseUrl}/v1/systemone with a shared `state`
 * and a map of typed `choice` questions; the answer is a probability for every option.
 *
 * Works with any server that speaks the contract:
 *  - Laya, open source (Apache-2.0), runs locally: pip install "laya[serve]"; laya-serve; baseUrl http://127.0.0.1:8000, no key.
 *  - TypeSafe Jev, hosted: baseUrl https://api.typesafe.ai, apiKey from TYPESAFE_API_KEY, model "jev-latest".
 */
export interface SystemOneOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** Sample from the probabilities (variety) instead of taking the top choice (determinism). */
  sample?: boolean;
  /** USD per input token, for the cost meter. */
  pricePerInputToken?: number;
  /** Small local models want short option texts and few options (Laya: ~15 options, ~190 tokens of options). */
  maxOptions?: number;
  name?: string;
}

interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export class SystemOneEngine implements DecisionEngine {
  readonly name: string;
  constructor(private readonly o: SystemOneOptions, private readonly rng: Rng) {
    this.name = o.name ?? (o.baseUrl.includes('127.0.0.1') || o.baseUrl.includes('localhost') ? 'decision-model (local)' : 'decision-model');
  }

  get pricePerInputToken(): number {
    return this.o.pricePerInputToken ?? 0;
  }

  async decide(s: Snapshot): Promise<EngineResult> {
    const questions: Record<string, unknown> = {};
    const asked = s.agents.filter((a) => a.options.length > 1);
    for (const a of asked) {
      // Shuffle to counter first-option bias; cap the count for small models.
      const opts = this.rng.shuffle(a.options).slice(0, this.o.maxOptions ?? 12);
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
    let answers: Record<string, ChoiceAnswer> = {};
    let inputTokens = 0;
    if (asked.length) {
      const res = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}),
        },
        // Keys starting with _ are for code only (e.g. the rule engine's raw plan), never sent to the model.
        body: JSON.stringify({ state: Object.fromEntries(Object.entries(s.shared).filter(([k]) => !k.startsWith('_'))), questions, ...(this.o.model ? { model: this.o.model } : {}) }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 1500),
      });
      if (!res.ok) throw new Error(`systemone ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { answers: Record<string, ChoiceAnswer>; usage?: { input_tokens?: number } };
      answers = body.answers;
      inputTokens = body.usage?.input_tokens ?? 0;
    }
    const latencyMs = performance.now() - t0;
    const decisions = s.agents.map((a) => {
      const ans = answers[a.agentId];
      if (!ans) return { agentId: a.agentId, key: a.options[0].key, probabilities: { [a.options[0].key]: 1 }, confidence: 1 };
      const key = this.o.sample === false ? ans.choice : this.rng.pickWeighted(ans.probabilities);
      return { agentId: a.agentId, key, probabilities: ans.probabilities, confidence: ans.confidence };
    });
    return { decisions, latencyMs, inputTokens, engine: this.name };
  }
}
