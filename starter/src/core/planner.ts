/**
 * The slow loop. Never blocks the simulation: reviews run in the background and the plan changes
 * when an answer arrives. The backend (an LLM) only sees what the domain's report gives it.
 */

export interface PlanChange<P> {
  /** false: keep the current plan. */
  change: boolean;
  plan: P;
  /** One sentence for humans: why. */
  reasoning: string;
}

export interface ReviewInput<P> {
  /** Why the planner is being asked now: "regular review", "an alarm fired", ... */
  trigger: string;
  /** Compact report built by code: numbers for a window, not raw logs. */
  report: Record<string, unknown>;
  currentPlan: P;
  /** The last change and how long ago, so the model gives a change time to work instead of flip-flopping. */
  lastChange: { secondsAgo: number; plan: P; reasoning: string } | null;
}

export interface PlannerBackend<P> {
  readonly name: string;
  review(input: ReviewInput<P>): Promise<PlanChange<P>>;
}

export interface PlannerOptions {
  /** Seconds (world time) between regular reviews. */
  intervalS: number;
  /** After a change, no regular review for this long. Event triggers still fire. */
  cooldownS: number;
}

export interface PlannerState<P> {
  plan: P;
  status: 'idle' | 'reviewing' | 'error' | 'off';
  reviews: number;
  changes: number;
  lastReasoning: string;
  lastError: string | null;
  latenciesMs: number[];
  history: { at: number; plan: P; reasoning: string }[];
}

export class PlannerLoop<P> {
  readonly state: PlannerState<P>;
  private nextReview: number;
  private pending: string | null = null;
  private inFlight = false;

  constructor(
    initialPlan: P,
    private readonly backend: PlannerBackend<P> | null,
    private readonly report: (trigger: string) => Record<string, unknown>,
    private readonly o: PlannerOptions,
    private readonly onChange?: (c: PlanChange<P>) => void,
  ) {
    this.state = { plan: initialPlan, status: backend ? 'idle' : 'off', reviews: 0, changes: 0, lastReasoning: '', lastError: null, latenciesMs: [], history: [] };
    this.nextReview = o.intervalS;
  }

  /** Ask for a review as soon as possible (a goal, an alarm, a big backlog). */
  trigger(reason: string): void {
    this.pending = reason;
  }

  tick(now: number): void {
    if (!this.backend || this.inFlight) return;
    if (!this.pending && now >= this.nextReview) this.pending = 'regular review';
    if (!this.pending) return;
    const trigger = this.pending;
    this.pending = null;
    // Never shorten a cooldown: take the later of the two.
    this.nextReview = Math.max(this.nextReview, now + this.o.intervalS);
    this.inFlight = true;
    this.state.status = 'reviewing';
    this.state.reviews++;
    const last = this.state.history.at(-1);
    const t0 = performance.now();
    this.backend
      .review({
        trigger,
        report: this.report(trigger),
        currentPlan: this.state.plan,
        lastChange: last ? { secondsAgo: Math.round(now - last.at), plan: last.plan, reasoning: last.reasoning } : null,
      })
      .then((c) => {
        this.state.latenciesMs.push(performance.now() - t0);
        this.state.status = 'idle';
        this.state.lastError = null;
        this.state.lastReasoning = c.reasoning;
        if (c.change && JSON.stringify(c.plan) !== JSON.stringify(this.state.plan)) {
          this.state.plan = c.plan;
          this.state.changes++;
          this.state.history.push({ at: now, plan: c.plan, reasoning: c.reasoning });
          this.nextReview = now + this.o.cooldownS;
          this.onChange?.(c);
        }
      })
      .catch((e: unknown) => {
        this.state.status = 'error';
        this.state.lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => (this.inFlight = false));
  }
}
