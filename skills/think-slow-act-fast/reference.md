# Reference

Shapes from the football demo, in TypeScript. Adapt the names to your domain; keep the separation.

## Interfaces (from the starter)

The working code is in `starter/src/core/`. The shapes you implement or call:

```ts
// types.ts
interface Option { key: string; text: string; facts: Record<string, number | string | boolean> }
interface AgentQuestion { agentId: string; identity: string; seeing: Record<string, string>; instruction?: string;
                          question: string; options: Option[]; urgent?: boolean }
interface Snapshot<C> { group: string; tick: number; context: C; shared: Record<string, unknown>; agents: AgentQuestion[] }
interface Decision { agentId: string; key: string; probabilities: Record<string, number>; confidence: number }
interface DecisionEngine { name: string; decide(s: Snapshot): Promise<EngineResult>; decideSync?(s: Snapshot): EngineResult }

// scheduler.ts: you implement Domain; one Scheduler per group; call tick(world) every step.
interface Domain<W, C> {
  time(w: W): number; tick(w: W): number;
  snapshot(w: W, group: string): Snapshot<C>;
  triggerKey(w: W, group: string): string;                    // change => ask now
  isFresh(w: W, s: Snapshot<C>, d: Decision): boolean;        // still valid?
  apply(w: W, d: Decision, how: { engine: string; fallback: boolean }): void;
  urgent?(w: W, group: string): { agentId: string; since: number }[];
}
new Scheduler(group, domain, engine /* SystemOneEngine */, fallback /* RuleEngine */, { intervalS: 1/3, maxInFlight: 2, deadlineS: 1, outageErrors: 3 });

// planner.ts + copilot-planner.ts: the slow loop.
new PlannerLoop(initialPlan, new CopilotPlanner({ planSchema, instructions, model, foundryEndpoint }),
                (trigger) => report(world, since, trigger), { intervalS: 15, cooldownS: 30 }, onChange);
```

The football demo used the same shapes with one group per team, 11 agents per group.

## One real question and answer

Captured during a recorded match (abbreviated to five of nine options). The decision model's own API shape will
differ; the content is what matters.

Shared state, sent once for the team:

```json
{
  "our_aim": "score: move the ball towards their goal whenever it is reasonably safe, get into the box and shoot when you have a chance; only play it safe in our own third",
  "match": { "score": "Redhill Rovers 0 - 0 Bluewater City (level)", "minute": "16th minute", "phase": "we have the ball" },
  "our_tactics": { "formation": "4-3-3", "build_up": "mix short and long", "defensive_line": "medium",
                   "pressing": "high intensity, on back pass", "width": "balanced", "tempo": "fast" },
  "ball": "with our #9 in the attacking third, centre"
}
```

The ball carrier's question:

```json
{
  "you": "#9 Moreau, striker, a strong target man who holds the ball up (the team's star player)",
  "what_you_see": { "where": "the attacking third, centre", "pressure": "no one near you" },
  "coach_instruction_for_you": "Press their centre-backs and contest long clearances",
  "question": "You have the ball. Following our aim, our tactics, your playing style and what you see, what do you do with it now?",
  "options": {
    "shoot": "shoot at goal: a decent shooting chance",
    "dribble_forward": "carry the ball forward: some space ahead",
    "hold_up_ball": "shield the ball and wait for support",
    "pass_to_#11": "ground medium pass to Lindqvist (#11, left winger) in midfield, centre: sideways; open lane, he is free; likely to arrive",
    "pass_to_#7": "ground medium pass to Achebe (#7, right winger) in the attacking third, centre: sideways; open lane, he has a marker nearby; likely to arrive"
  }
}
```

Answer, 245 ms, for the whole team's request:

```json
{ "probabilities": { "dribble_forward": 0.44, "shoot": 0.43, "hold_up_ball": 0.10, "pass_to_#11": 0.02, "pass_to_#7": 0.01 },
  "confidence": 0.37 }
```

Off-ball agents get the same shape with options like `press_carrier`, `mark_#7`, `cover_lane_to_#9`,
`run_in_behind`, `hold_shape`, each only when code says it makes sense (for example, only the three nearest
players are offered `press_carrier`).

## Scheduler, per group (football version of `starter/src/core/scheduler.ts`)

```ts
const INTERVAL_S = 1 / 3;          // cadence
const MAX_IN_FLIGHT = 2;
const CARRIER_FALLBACK_S = 1.0;    // delay-critical agent gets a rule decision after this
const OUTAGE_ERRORS = 3;           // consecutive errors before rules drive the group

function tick(world) {
  useSpeculativeAnswerIfBallArrived(world);
  carrierFallback(world);          // rules decide for a carrier waiting > CARRIER_FALLBACK_S
  outageFallback(world);           // rules drive the group while errors >= OUTAGE_ERRORS
  const triggered = carrierChanged(world) || phaseChanged(world);
  const due = world.time - lastFire >= INTERVAL_S;
  if (!(due || triggered) || inFlight >= MAX_IN_FLIGHT) return;
  fire(buildSnapshot(world));      // stamps snapshot.tick
}

function apply(world, snap, answer) {
  if (snap.tick < lastAppliedTick) return countStale(answer);          // out of order
  lastAppliedTick = snap.tick;
  for (const d of answer.decisions) {
    if (!snap.optionsFor(d.agentId).includes(d.key)) { invalid++; continue; }
    const fresh = d.agentId === snap.carrierId
      ? world.carrierId === d.agentId && world.controlSince <= snap.time  // still has the same ball
      : world.phase === snap.phase && world.carrierId !== d.agentId;      // situation unchanged
    if (!fresh) { stale++; continue; }
    applyDecision(d);              // sample, hesitate if confidence < 0.5
    applied++;
  }
}
```

## The LLM's plan: strict schema

Every field is required; enums keep the plan executable.

```json
{
  "name": "tactics", "strict": true,
  "schema": {
    "type": "object", "additionalProperties": false,
    "required": ["change", "formation", "defensive_line", "pressing_intensity", "pressing_trigger", "width",
                 "tempo", "build_up", "player_instructions", "noticed", "reasoning", "shout"],
    "properties": {
      "change": { "type": "boolean", "description": "true only if you are changing something now" },
      "formation": { "type": "string", "enum": ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "5-3-2"] },
      "defensive_line": { "type": "string", "enum": ["deep", "medium", "high"] },
      "pressing_intensity": { "type": "string", "enum": ["low", "medium", "high"] },
      "pressing_trigger": { "type": "string", "enum": ["immediately", "on_back_pass", "in_wide_areas", "only_in_our_half"] },
      "width": { "type": "string", "enum": ["narrow", "balanced", "wide"] },
      "tempo": { "type": "string", "enum": ["patient", "balanced", "fast"] },
      "build_up": { "type": "string", "enum": ["short", "mixed", "direct"] },
      "player_instructions": { "type": "array", "description": "0-2 instructions for named players",
        "items": { "type": "object", "additionalProperties": false, "required": ["shirt", "instruction"],
                   "properties": { "shirt": { "type": "integer" }, "instruction": { "type": "string" } } } },
      "noticed": { "type": "string" },
      "reasoning": { "type": "string", "description": "one sentence for the audience" },
      "shout": { "type": "string", "description": "max 6 words" }
    }
  }
}
```

## The LLM's loop

```ts
const REVIEW_EVERY_S = 30;          // match seconds
const COOLDOWN_AFTER_CHANGE_S = 480;

onEvent(goal | halfTime | opponentDominating) => pending = reason;
if (!inFlight && (pending || now >= nextReview)) {
  nextReview = Math.max(nextReview, now + REVIEW_EVERY_S);   // never shorten a cooldown
  ask(systemPrompt(philosophy), report({ window: sinceLastChangeOrAtLeast5Min, lastChange, trigger }));
}
onAnswer(d) => if (d.change && diff(plan, d).length) {
  plan = d; nextReview = now + COOLDOWN_AFTER_CHANGE_S; showCard(d.reasoning, diff);
}
```

System prompt essentials: who it is and its philosophy; agents decide for themselves, it sets the plan; change
only on clear evidence from the report; give a change time to work; be specific and cite numbers; at most two
agent instructions; a one-sentence reason for the audience.

## The report, built by code

```json
{
  "why_you_are_asked": "regular review",
  "minute": "34:49",
  "score": "Redhill Rovers 0 - 0 Bluewater City",
  "current_tactics": { "...": "in words" },
  "window": "since 17'",
  "in_window": {
    "goals": "0 for, 0 against",
    "our_passes_completed_by_zone": { "own_third": "41/44", "middle_third": "38/47", "final_third": "9/16" },
    "ball_lost_by_zone": { "own_third": 1, "middle_third": 6, "final_third": 5 },
    "our_shots": "3 (xG 0.41)",
    "their_shots": "1 (xG 0.09)",
    "our_player_decisions_on_the_ball": "pass 71%, dribble forward 14%, ...; 22% were hesitant (low confidence)"
  },
  "your_last_change": { "at": "17'", "minutes_ago": 17, "what": ["..."], "why": "..." },
  "opponent_tactics": { "...": "in words" },
  "squad": { "#9": "Moreau, ST, a strong target man who holds the ball up, star" }
}
```

(Illustrative values; the structure is the one used.)

## Metrics

| Metric | Definition |
| --- | --- |
| p50 / p95 latency | Over the last 200 responses from the decision model |
| Decisions applied per second | Applied decisions (not dropped) across all groups, per wall-clock second |
| Stale % | Dropped as no longer fresh ÷ (applied + stale) |
| Invalid | Answers whose key wasn't among the agent's options (should be 0) |
| Fallbacks | Decisions made by rules (late carrier or outage) |
| Tokens per request | Input tokens ÷ requests |
| Cost so far / per hour | Decision model + LLM, from token counts and your prices |
| LLM | Calls, changes, latency, tokens |
