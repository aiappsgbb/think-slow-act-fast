import type { Rng } from './rng.js';
import type { AgentQuestion, DecisionEngine, EngineResult, Option, Snapshot } from './types.js';

/** Score one option for one agent. Higher is better. Build this first: it is the baseline, the fallback and the test oracle. */
export type ScoreFn = (o: Option, a: AgentQuestion, s: Snapshot) => number;

/** Rule engine: scores every option, softmax with a low temperature, then samples. Instant and deterministic given the seed. */
export class RuleEngine implements DecisionEngine {
  readonly name = 'rules';
  constructor(private readonly score: ScoreFn, private readonly rng: Rng, private readonly temperature = 0.15) {}

  decideSync(s: Snapshot): EngineResult {
    const decisions = s.agents.map((a) => {
      const scores = a.options.map((o) => this.score(o, a, s) / this.temperature);
      const max = Math.max(...scores);
      const exps = scores.map((x) => Math.exp(x - max));
      const sum = exps.reduce((x, y) => x + y, 0);
      const probabilities = Object.fromEntries(a.options.map((o, i) => [o.key, exps[i] / sum]));
      const sorted = Object.values(probabilities).sort((x, y) => y - x);
      return { agentId: a.agentId, key: this.rng.pickWeighted(probabilities), probabilities, confidence: sorted[0] - (sorted[1] ?? 0) };
    });
    return { decisions, latencyMs: 0, inputTokens: 0, engine: this.name };
  }

  async decide(s: Snapshot): Promise<EngineResult> {
    return this.decideSync(s);
  }
}
