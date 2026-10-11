import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.js';
import { RuleEngine } from '../src/core/rules.js';
import { DEFAULTS, RequestBudget, Scheduler, type Domain } from '../src/core/scheduler.js';
import type { Decision, DecisionEngine, EngineResult, Snapshot } from '../src/core/types.js';

/** A tiny world: one agent, a "ball" that can move to another agent, a clock. */
interface Toy { t: number; tick: number; holder: string; applied: { d: Decision; fallback: boolean }[]; urgentSince: number | null }

const options = [
  { key: 'a', text: 'option a', facts: { score: 1 } },
  { key: 'b', text: 'option b', facts: { score: 0 } },
];
const domain: Domain<Toy, { holder: string }> = {
  time: (w) => w.t,
  tick: (w) => w.tick,
  snapshot: (w, group) => ({ group, tick: w.tick, context: { holder: w.holder }, shared: {}, agents: [{ agentId: 'p1', identity: 'p1', seeing: {}, question: '?', options }] }),
  triggerKey: (w) => w.holder,
  isFresh: (w, s) => w.holder === s.context.holder,
  apply: (w, d, how) => w.applied.push({ d, fallback: how.fallback }),
  urgent: (w) => (w.urgentSince === null ? [] : [{ agentId: 'p1', since: w.urgentSince }]),
};
const rules = new RuleEngine((o) => Number(o.facts.score), new Rng(1));

/** An engine whose answers we release by hand, to control ordering and timing. */
class ManualEngine implements DecisionEngine {
  readonly name = 'manual';
  pending: { s: Snapshot; resolve: (r: EngineResult) => void; reject: (e: Error) => void }[] = [];
  decide(s: Snapshot): Promise<EngineResult> {
    return new Promise((resolve, reject) => this.pending.push({ s, resolve, reject }));
  }
  answer(i: number, key = 'a'): void {
    const p = this.pending[i];
    p.resolve({ decisions: [{ agentId: 'p1', key, probabilities: { a: 0.7, b: 0.3 }, confidence: 0.4 }], latencyMs: 200, inputTokens: 100, engine: this.name });
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const toy = (): Toy => ({ t: 0, tick: 0, holder: 'p1', applied: [], urgentSince: null });

describe('Scheduler', () => {
  it('shares a 60RPM wall-clock budget fairly across groups even with triggers', async () => {
    const w = toy();
    const e = new ManualEngine();
    let milliseconds = 0;
    const budget = new RequestBudget(60, () => milliseconds);
    const schedulers = ['north', 'south'].map((g) => new Scheduler(g, domain, e, rules, { ...DEFAULTS, requestBudget: budget }));
    for (let i = 0; i < 600; i++) {
      milliseconds = i * 100;
      w.t = i / 10;
      w.tick = i;
      w.holder = `holder-${i}`;
      for (const s of schedulers) s.tick(w);
      for (const p of e.pending) p.resolve({ decisions: [], inputTokens: 100, latencyMs: 1, engine: e.name });
      await flush();
    }
    expect(e.pending).toHaveLength(60);
    expect(e.pending.filter((p) => p.s.group === 'north')).toHaveLength(30);
    expect(e.pending.filter((p) => p.s.group === 'south')).toHaveLength(30);
    expect(schedulers.reduce((n, s) => n + s.metrics.throttled, 0)).toBeGreaterThan(0);
  });

  it('does not consume the budget for empty snapshots', () => {
    const w = toy();
    const e = new ManualEngine();
    const budget = new RequestBudget(60, () => 0);
    const empty = { ...domain, snapshot: (w: Toy, g: string) => ({ ...domain.snapshot(w, g), agents: [] }) };
    new Scheduler('empty', empty, e, rules, { ...DEFAULTS, requestBudget: budget }).tick(w);
    new Scheduler('active', domain, e, rules, { ...DEFAULTS, requestBudget: budget }).tick(w);
    expect(e.pending).toHaveLength(1);
  });

  it('rejects invalid RPM configuration', () => {
    expect(() => new RequestBudget(0)).toThrow();
    expect(() => new RequestBudget(NaN)).toThrow();
  });

  it('applies a fresh answer and records latency and tokens', async () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules);
    s.tick(w);
    e.answer(0);
    await flush();
    expect(w.applied).toHaveLength(1);
    expect(s.metrics.applied).toBe(1);
    expect(s.metrics.tokensPerRequest).toBe(100);
  });

  it('drops an answer when the situation changed (stale)', async () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules);
    s.tick(w);
    w.holder = 'p2';
    e.answer(0);
    await flush();
    expect(w.applied).toHaveLength(0);
    expect(s.metrics.stale).toBe(1);
  });

  it('drops an older answer that arrives after a newer one', async () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules);
    s.tick(w);
    w.t = 0.4;
    w.tick = 4;
    s.tick(w);
    e.answer(1);
    await flush();
    e.answer(0);
    await flush();
    expect(w.applied).toHaveLength(1);
    expect(s.metrics.stale).toBe(1);
  });

  it('never has more than maxInFlight requests out', () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules, { ...DEFAULTS, maxInFlight: 2 });
    for (let i = 0; i < 10; i++) {
      w.t += 0.5;
      w.tick += 5;
      s.tick(w);
    }
    expect(e.pending).toHaveLength(2);
  });

  it('gives an urgent agent a rule decision after the deadline', () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules, { ...DEFAULTS, deadlineS: 1 });
    w.urgentSince = 0;
    s.tick(w);
    w.t = 1.1;
    w.tick = 11;
    s.tick(w);
    expect(w.applied.some((a) => a.fallback)).toBe(true);
    expect(s.metrics.fallbacks).toBe(1);
  });

  it('lets rules drive the group after repeated errors', async () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules, { ...DEFAULTS, maxInFlight: 5, outageErrors: 3 });
    for (let i = 0; i < 3; i++) {
      w.t += 0.4;
      w.tick += 4;
      s.tick(w);
    }
    e.pending.forEach((p) => p.reject(new Error('down')));
    await flush();
    w.t += 0.4;
    w.tick += 4;
    s.tick(w);
    expect(s.metrics.errors).toBe(3);
    expect(w.applied.some((a) => a.fallback)).toBe(true);
  });

  it('ignores an answer whose key was not offered', async () => {
    const w = toy();
    const e = new ManualEngine();
    const s = new Scheduler('g', domain, e, rules);
    s.tick(w);
    e.answer(0, 'teleport');
    await flush();
    expect(w.applied).toHaveLength(0);
    expect(s.metrics.invalid).toBe(1);
  });
});

describe('RuleEngine and Rng', () => {
  it('prefers the higher-scoring option and returns a distribution', () => {
    const r = rules.decideSync(domain.snapshot(toy(), 'g'));
    const p = r.decisions[0].probabilities;
    expect(p.a).toBeGreaterThan(p.b);
    expect(p.a + p.b).toBeCloseTo(1);
  });

  it('is reproducible for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next(), a.pickWeighted({ x: 1, y: 2 })]).toEqual([b.next(), b.next(), b.pickWeighted({ x: 1, y: 2 })]);
  });
});
