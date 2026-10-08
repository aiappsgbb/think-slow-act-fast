# Lessons

What we learned building a live 11 v 11 football match on this pattern: 22 players decided by a decision model,
an LLM manager per team, everything visible on screen. Numbers are from a full recorded 90-minute match.

## The fast loop

1. **One request per group, not per agent.** Shared state goes in once; each agent adds one short question. A
   team of 11 cost about 2,700 input tokens per request and answered in about 235 ms (p50).
2. **Code computes the options and filters them by context.** Our first probe offered "press the carrier" while
   our own team had the ball. The model picked it. Never offer an option code knows is invalid.
3. **Describe in words, not coordinates.** "In the attacking third, right wing; an opponent is closing you down"
   works. Raw x/y does not. Put the deciding fact inside each option: "ground pass to Silva, forward, open lane,
   likely to arrive".
4. **Give each agent an identity.** Role and playing style ("a dribbler who loves taking players on") made
   choices differ by character, and made the result watchable.
5. **Shuffle options** to counter first-option bias.
6. **Timer plus triggers.** A 333 ms cadence alone made the ball carrier wait. Firing immediately on possession
   change, pass received and restarts fixed it.
7. **Freshness checks are not optional.** Answers arrive after the world has moved. Drop an on-ball answer if
   the agent no longer has the ball, and an off-ball answer if the team's phase changed. We dropped about 5%.
8. **Speculate where you can.** While a pass is in flight, ask the receiver what he'll do when it arrives.
   About 80% of receptions then had an answer waiting, with no network wait.
9. **Sample, and show hesitation.** Sampling from the odds gave variety without randomness. Confidence below 0.5
   delayed the action by up to a fraction of a second, visibly.
10. **Fallbacks earn their keep in demos.** A carrier with no fresh decision after 1 s gets a rule decision;
    three errors in a row and rules drive the team until the model answers. In the recorded match: 0 fallbacks,
    0 errors, but the presenter can trust it.
11. **Execution odds live in code, seeded.** The model decides to shoot; code decides whether it goes in. Keeps
    the model honest and the physics consistent.

## The slow loop

1. **Code writes the report.** Compact JSON: score, plan in words, per-zone passing, where the ball was lost and
   won, shots and xG, what the agents chose on the ball and how often they hesitated, the opponent's plan, the
   squad. No raw event logs.
2. **Strict schema, enums everywhere.** Every plan field is an enum; `change` is a boolean; at most two
   instructions for named agents; a one-sentence reason "for the TV audience". Structured output removes a
   whole class of parsing bugs.
3. **Cooldown, or it flip-flops.** An LLM asked every half minute will find something to change. Fix: after
   a change, no regular review for 8 match minutes; tell the model when it last changed and what; ask it not to
   change without evidence. Event triggers (a goal, half time, the other side dominating) still fire.
4. **Watch the timer arithmetic.** A goal-triggered review reset the next-review timer and cancelled the
   cooldown. Take the later of the two times.
5. **The plan must reach the agents.** Tactics appear in every question's shared state; per-agent instructions
   appear in that agent's question. Otherwise the LLM is decoration.
6. **Measure the LLM like any other dependency.** Ours took about 2 s per call and cost about $0.16 for a whole
   match for both managers. Use a current model that meets your latency, and log every call.

## Making it visible

The demo only lands if people can see both speeds working.

1. **Show the decision, not the plumbing.** A lower-third for the agent on the ball: name, the call, and the top
   three options with their odds. Probability pills on the pitch were noise.
2. **Show that everyone decides.** A short ring pulse on each agent when it gets a new decision. Twenty-two
   pulsing players say "constant decisions" better than any feed of text.
3. **Show the LLM thinking.** A small "reviewing" status per manager, and a card when it changes the plan: the
   reason in one sentence and the changes as chips.
4. **Live numbers:** decisions per second, median decision time, cost so far.
5. **Pace and camera.** At full speed nobody could follow it. 0.8× speed, a camera that follows the ball and
   zooms in, and full-screen moments for goals with a slow replay made it watchable.
6. **Label the layers in plain words.** "Decision model" and "LLM manager", not product names.

## Building the starter (warehouse)

1. **The same core held for a different domain.** Swapping football for warehouse robots changed only the domain
   adapter: options, words, freshness, report and plan. The scheduler, engines and planner loop didn't change.
2. **Reserve at decision time.** Otherwise two robots can pick the same order while the first one hesitates. The
   starter reserves the order in `apply`, before the robot moves.
3. **Hard safety stays in code.** A robot below 8% battery goes to charge regardless of the model or the plan.
   The models choose within a safe space; they never own the safety rule.
4. **Laya is one-at-a-time.** With `maxInFlight: 1` and six robots per request, Laya answered in 90–300 ms on a
   laptop GPU with no errors; more in flight only queued.
5. **A fresh Copilot SDK session per review** kept the planner cheap and predictable; the report and the "last
   change" line in the prompt are its memory.
6. **Structured output differs by provider.** Foundry's Responses API took our schema as is; another provider
   rejected numeric and array bounds. Keep the schema plain and clamp in code.
7. **Give the planner a real problem.** With a south-zone surge and `own_zone_only`, the south backed up while
   the north idled. The planner switched to `help_anywhere`, citing the open-order counts per zone.

## What we'd do again, and what we wouldn't

- **Again:** rules first; one interface for all engines; metrics from day one; a seeded demo mode with boosted
  finishing so a short match produces goals.
- **Not again:** we dropped a side-by-side "decision model vs LLM" mode before building it. It would have split
  attention. Tell the story with one system working, and quote the numbers.
