---
name: think-slow-act-fast
description: Use when building a system where many agents must act continuously in real time (games, simulations, robot or vehicle fleets, routing, live operations) and calling an LLM for every decision is too slow or too expensive; when splitting work between an LLM planner, a fast decision model and code; or when such a system feels sluggish, erratic, stale or costly.
---

# Think slow, act fast

## Overview

Many agents, each deciding several times a second, cannot wait seconds for an LLM. They don't need to. Split
the work three ways:

| Layer | Speed | Job |
| --- | --- | --- |
| **Code** | Every tick | Physics, rules, state. Works out which options are actually possible and the facts about each one (distance, risk, odds) |
| **Decision model** | ~250 ms, many per second | Picks one of the options code offered, for every agent, and returns a probability for each option |
| **LLM** | Seconds, about once a minute | Reads a short report written by code, sets the plan and explains why. Its plan becomes part of every agent's next question |

The LLM thinks slowly about the big picture. The decision model acts fast, inside limits code has checked.
Results flow back to the LLM in the next report.

| File | Read it when |
| --- | --- |
| `concepts.md` | The user asks what the pattern is, why it works, or whether their use case fits |
| `lessons.md` | Designing the fast loop or the slow loop, or before telling the user a design is sound |
| `reference.md` | You need an interface, a question or answer shape, a schema or a metric definition |

The worked example throughout is a live 11 v 11 football match: 22 players decided by a decision model about
three times a second each, and an LLM manager per team.

## Rules for the agent running this skill

1. **One step at a time.** Don't start a step until the previous step's **Done when** is true, and show the user
   the evidence (test output, a log line, a measured number).
2. **Code owns the facts.** Never let a model invent a position, a price, a distance or a rule. If a decision
   needs a fact, code computes it and puts it in the question.
3. **Build the rule-based baseline first.** It is the fallback, the test oracle and the thing you compare against.
4. **Measure, don't assume.** Latency, decisions per second, stale rate and cost come from the running system.
5. **Ask before you create** cloud resources or deployments, and say what they will cost. Use the user's own
   subscription and keys from the environment; never hard-code or print secrets.
6. **Stay model-neutral.** The pattern needs *a* decision model and *an* LLM. Pick by measured latency, quality
   and price for the user's case, not by brand.
7. **If a check fails twice, stop.** Report what you ran, what you saw and the matching row in Common problems.

## Step 0: confirm the fit

Ask for, or estimate: number of agents, decisions per agent per second, the latency budget for one decision, and
how often the plan should change. Then do the arithmetic in `concepts.md`.

**Done when** you can state, with numbers, why one LLM call per decision won't do (too slow, too costly, or
both), and what the slow loop's cadence will be. If one LLM call per decision *is* fine, say so and stop: this
pattern adds moving parts.

## Step 1: draw the three layers

Write down, for this system:

- **Code:** the state, the tick rate, and the rules. The list of actions an agent can take, and the facts code
  can compute for each.
- **Decision model:** which agents it decides for, how often, and what one question looks like.
- **LLM:** what it controls (the plan's fields), what it reads (the report's fields), and what triggers a review.

**Done when** every field the LLM can set is used by code or by the decision model's questions, and every fact
in a question is computed by code.

## Step 2: build the engine interface and the rule baseline

One interface, several engines: rules (instant, deterministic), the decision model, and optionally a local model.
See `reference.md` for the shape. The rule engine scores the same options with simple weights and a softmax.

**Done when** the system runs end to end on rules alone, with tests, and you can swap engines without touching
the scheduler.

## Step 3: write the questions

For each agent, one choice question:

- **Shared state once per batch:** the group's aim, score or status, the current plan in words.
- **Per agent:** who it is (role, style), what it can see *in words* (zones, distance bands, pressure), any
  instruction from the LLM's plan, and only the options code has validated, each with a short plain description
  carrying the facts ("short pass to Silva, sideways, open lane, likely to arrive").
- Shuffle the options to counter first-option bias. Filter options by context (don't offer "press the carrier"
  when your team has the ball).

**Done when** a printed question reads like a clear brief to a human player, a batch for the whole group fits the
model's input budget, and every option key maps to an action code can execute.

## Step 4: schedule the fast loop

- Batch: one request per group (a team, a zone, a cell), all its agents' questions together.
- Cadence plus triggers: a fixed interval (the football demo used 333 ms) and an immediate request on events
  that change everything (possession change, a new task, an alarm).
- Cap requests in flight per group (2 worked). Stamp each request with its state tick.
- On every answer, check freshness: drop it if a newer answer was already applied, or if the situation it was
  asked about has changed. Count what you drop.
- Speculate where the next state is predictable: while a pass is in flight, ask the receiver now what he'll do
  when it arrives, and apply the answer the moment he controls the ball if it's still valid.

**Done when** the stale rate is measured and under about 10%, and the agent most sensitive to delay (the ball
carrier) gets a fresh decision within your latency budget.

## Step 5: act on the answers

- **Sample** from the returned probabilities for variety, or take the top choice when you need determinism.
  Decide deliberately and say which in the UI.
- **Low confidence is information.** Below about 0.5, delay the action briefly and show the hesitation.
- **Execution stays in code.** The model chooses *what*; code decides *how well it worked* (pass success odds,
  travel time), seeded so runs can be replayed.

**Done when** the system looks purposeful: agents commit to choices, and variety comes from the odds, not noise.

## Step 6: fallbacks

- A delay-critical agent with no fresh decision after a deadline (1 s for the ball carrier) gets a rule decision.
- After N consecutive errors (3), the rule engine drives the whole group until a request succeeds.
- Label fallback decisions and count them.

**Done when** you can kill the decision model's network mid-run and the system keeps going, visibly on fallback,
and recovers by itself.

## Step 7: the slow loop

- **Report built by code, compact:** status, the current plan, numbers for a window (since the last change, at
  least a few minutes), what the agents chose and how often they hesitated, the opposition's plan.
- **Strict JSON schema** output with enums for every plan field, a `change` flag, a one-sentence reason for
  humans, and at most two instructions for named agents.
- **Triggers:** a regular interval, plus events (a goal, half time, the other side dominating).
- **Cooldown:** after a change, give it time (8 match minutes in the demo) before the next regular review. Events
  can still trigger one. Tell the model when it last changed things, so it doesn't flip-flop.
- The new plan flows into every agent's next question. The next report shows whether it worked.

**Done when** the LLM changes the plan a handful of times per session, each change has a reason tied to numbers in
the report, and you can see agents' choices shift afterwards.

## Step 8: measure and show it

Track per group: p50 and p95 latency, decisions applied per second, stale %, fallbacks, errors, input tokens per
request, cost so far and cost per hour. For the LLM: calls, changes, latency, cost.

If people will watch it, make the decisions visible: the current agent's choice with its odds, a pulse each time
an agent gets a new decision, and a card when the LLM changes the plan with its reason. See `lessons.md`.

**Done when** the numbers are on screen or in a log, and someone watching for 30 seconds can say what each layer
is doing.

## Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Agents freeze, then jump | Requests only on a timer; long waits for the delay-critical agent | Add event triggers, speculative questions, and the carrier fallback |
| Stale rate above 15% | Too many requests in flight, or freshness rules too strict | Cap in flight at 2, trigger on the events that matter, check rules against the snapshot, not the present |
| Choices look random | Options too similar, or descriptions missing the deciding fact | Put the numbers that matter into each option's words; drop options code knows are bad |
| Same option every time | First-option bias, or argmax | Shuffle options; sample from the probabilities |
| Agents clump together | Every agent is offered the same target | Code ranks agents by distance and offers chase or press only to the nearest few (three in the demo); the rest get positional options |
| LLM changes the plan every review | No cooldown, no memory of the last change | Cooldown after a change; put the last change and its age in the report; tell it not to change without evidence |
| LLM never changes anything | Report too vague, or the prompt is too conservative | Add per-zone numbers and agent behaviour to the report; give explicit triggers for change |
| Cost climbs | Questions too long, or too many requests | One request per group; shared state once; compact option text; measure tokens per request |
