import type { Decision, DecisionEngine, EngineResult, Snapshot } from './types.js';

/** What your domain must provide. Everything else (timing, freshness bookkeeping, fallbacks, metrics) is here. */
export interface Domain<W, C> {
  /** Current world time in seconds and the current tick. */
  time(w: W): number;
  tick(w: W): number;
  /** Build the group's questions from the current world. Options must already be valid and filtered by context. */
  snapshot(w: W, group: string): Snapshot<C>;
  /** A short signature of "what matters" for the group. When it changes, ask immediately instead of waiting for the cadence. */
  triggerKey(w: W, group: string): string;
  /** Is this answer still valid in the world as it is now? (Same task still open? Same agent still holding it?) */
  isFresh(w: W, s: Snapshot<C>, d: Decision): boolean;
  /** Act on a decision. Execution and its odds stay in code. */
  apply(w: W, d: Decision, how: { engine: string; fallback: boolean }): void;
  /** Delay-critical agents in the group and since when they have been waiting for a decision (seconds), if any. */
  urgent?(w: W, group: string): { agentId: string; since: number }[];
}

export interface SchedulerOptions {
  /** Seconds between requests per group when nothing triggers one. The football demo used 1/3. */
  intervalS: number;
  /** Requests in flight per group. 2 worked; more raises the stale rate. */
  maxInFlight: number;
  /** An urgent agent with no fresh decision this long after it started waiting gets a rule decision. */
  deadlineS: number;
  /** Consecutive errors before the fallback drives the whole group. */
  outageErrors: number;
}

export const DEFAULTS: SchedulerOptions = { intervalS: 1 / 3, maxInFlight: 2, deadlineS: 1, outageErrors: 3 };

export class Metrics {
  requests = 0;
  responses = 0;
  applied = 0;
  stale = 0;
  invalid = 0;
  errors = 0;
  fallbacks = 0;
  inputTokens = 0;
  readonly latencies: number[] = [];
  lastError: string | null = null;

  record(r: EngineResult): void {
    if (r.fallback || r.inputTokens === 0) return;
    this.responses++;
    this.inputTokens += r.inputTokens;
    this.latencies.push(r.latencyMs);
    if (this.latencies.length > 200) this.latencies.shift();
  }
  pct(p: number): number {
    if (!this.latencies.length) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
  }
  get stalePct(): number {
    const d = this.applied + this.stale;
    return d ? (100 * this.stale) / d : 0;
  }
  get tokensPerRequest(): number {
    return this.responses ? Math.round(this.inputTokens / this.responses) : 0;
  }
}

/** One scheduler per group (a team, a zone, a cell). Call tick() every simulation step; it never blocks. */
export class Scheduler<W, C> {
  readonly metrics = new Metrics();
  private inFlight = 0;
  private lastFire = -Infinity;
  private lastKey: string | null = null;
  private lastAppliedTick = -1;
  private consecutiveErrors = 0;
  private lastOutageFire = -Infinity;
  private readonly decidedAt = new Map<string, number>();

  constructor(
    readonly group: string,
    private readonly domain: Domain<W, C>,
    public engine: DecisionEngine,
    private readonly fallback: DecisionEngine & Required<Pick<DecisionEngine, 'decideSync'>>,
    private readonly o: SchedulerOptions = DEFAULTS,
  ) {}

  tick(w: W): void {
    const now = this.domain.time(w);
    this.deadlineFallback(w, now);
    this.outageFallback(w, now);
    const key = this.domain.triggerKey(w, this.group);
    const triggered = key !== this.lastKey;
    const due = now - this.lastFire >= this.o.intervalS - 1e-9;
    if (!(due || triggered) || this.inFlight >= this.o.maxInFlight) return;
    this.lastKey = key;
    this.lastFire = now;
    this.fire(w);
  }

  private fire(w: W): void {
    const snap = this.domain.snapshot(w, this.group);
    if (!snap.agents.length) return;
    this.metrics.requests++;
    this.inFlight++;
    const engine = this.engine;
    this.engine
      .decide(snap)
      .then((r) => {
        this.consecutiveErrors = 0;
        this.metrics.record(r);
        this.apply(w, snap, r, engine.name, false);
      })
      .catch((e: unknown) => {
        this.metrics.errors++;
        this.consecutiveErrors++;
        this.metrics.lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => this.inFlight--);
  }

  private apply(w: W, snap: Snapshot<C>, r: EngineResult, engine: string, fallback: boolean): void {
    // Out of order: a newer snapshot was already applied.
    if (snap.tick < this.lastAppliedTick) {
      this.metrics.stale += r.decisions.length;
      return;
    }
    this.lastAppliedTick = snap.tick;
    const options = new Map(snap.agents.map((a) => [a.agentId, new Set(a.options.map((o) => o.key))]));
    for (const d of r.decisions) {
      if (!options.get(d.agentId)?.has(d.key)) {
        this.metrics.invalid++;
        continue;
      }
      if (!this.domain.isFresh(w, snap, d)) {
        this.metrics.stale++;
        continue;
      }
      this.domain.apply(w, d, { engine, fallback });
      this.decidedAt.set(d.agentId, this.domain.time(w));
      if (fallback) this.metrics.fallbacks++;
      else this.metrics.applied++;
    }
  }

  /** The model is late for a delay-critical agent: decide for that agent alone with rules. */
  private deadlineFallback(w: W, now: number): void {
    if (!this.domain.urgent || this.engine === this.fallback) return;
    for (const u of this.domain.urgent(w, this.group)) {
      if (now - u.since < this.o.deadlineS) continue;
      if ((this.decidedAt.get(u.agentId) ?? -Infinity) >= u.since) continue;
      const snap = this.domain.snapshot(w, this.group);
      const one = { ...snap, agents: snap.agents.filter((a) => a.agentId === u.agentId) };
      if (!one.agents.length) continue;
      this.apply(w, one, { ...this.fallback.decideSync(one), fallback: true }, this.fallback.name, true);
    }
  }

  /** The model keeps failing: rules drive the whole group at the normal cadence until a request succeeds. */
  private outageFallback(w: W, now: number): void {
    if (this.consecutiveErrors < this.o.outageErrors || this.engine === this.fallback) return;
    if (now - this.lastOutageFire < this.o.intervalS) return;
    this.lastOutageFire = now;
    const snap = this.domain.snapshot(w, this.group);
    this.apply(w, snap, { ...this.fallback.decideSync(snap), fallback: true }, this.fallback.name, true);
  }
}
