/**
 * Core types for the think-slow-act-fast pattern. Domain-free: your domain builds Snapshots,
 * an engine turns them into Decisions, and the scheduler applies only the fresh ones.
 */

export type Facts = Record<string, number | string | boolean>;

/** One thing an agent can do right now. Code builds it; the decision model only picks among these. */
export interface Option {
  /** Stable action key your executor understands, e.g. "pick_order_17". */
  key: string;
  /** Plain-English description carrying the deciding facts, e.g. "pick order 17: 6 m away, 2 items, due in 40 s". */
  text: string;
  /** The same facts as numbers, for the rule engine and for logging. */
  facts: Facts;
}

/** One agent's question in a group request. */
export interface AgentQuestion {
  agentId: string;
  /** Who the agent is, in words: "robot R3, a fast picker with a small battery". */
  identity: string;
  /** What it can see, in words. Never raw coordinates. */
  seeing: Record<string, string>;
  /** An instruction from the planner for this agent only, if any. */
  instruction?: string;
  /** The question itself, e.g. "What do you do next?". */
  question: string;
  options: Option[];
  /** Delay-critical agents get a rule decision if the model is late (see Scheduler.deadlineMs). */
  urgent?: boolean;
}

/** Everything one request needs. `shared` is sent once per request, not once per agent. */
export interface Snapshot<C = unknown> {
  group: string;
  /** World tick the questions were built from. Answers older than the last applied tick are dropped. */
  tick: number;
  /** Domain context the freshness check compares against (e.g. which agent holds the ball). */
  context: C;
  /** Shared state in words: the goal, the current plan, the situation. */
  shared: Record<string, unknown>;
  agents: AgentQuestion[];
}

export interface Decision {
  agentId: string;
  key: string;
  probabilities: Record<string, number>;
  /** 0..1. Low confidence is information: hesitate, or hand off. */
  confidence: number;
}

export interface EngineResult {
  decisions: Decision[];
  latencyMs: number;
  inputTokens: number;
  engine: string;
  fallback?: boolean;
}

export interface DecisionEngine {
  readonly name: string;
  /** Network engines: one request per group. */
  decide(s: Snapshot): Promise<EngineResult>;
  /** Instant engines (rules) also implement this so the scheduler can use them as a same-tick fallback. */
  decideSync?(s: Snapshot): EngineResult;
}
