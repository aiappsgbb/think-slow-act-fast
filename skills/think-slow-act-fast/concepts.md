# Concepts

## The idea in one paragraph

An LLM is good at reading a situation, weighing a strategy and explaining itself. It is slow (seconds) and
priced per token. Many real systems need lots of small decisions, continuously: which pass, which aisle, which
queue, which lane, which robot goes first. Asking an LLM each time makes the system sluggish and expensive. So
let the LLM **think slowly** about the plan, let a fast decision model **act** on every small choice, and let
code supply the facts and the limits for both.

## The three layers

**Code** is the ground truth. It owns state, rules and physics, and it works out what is possible. For each
agent it builds the list of valid options and the facts about each one: distance, risk, success odds, who is free.
Models never invent these.

**The decision model** chooses. It gets one short question per agent (who you are, what you can see, what the
plan says, your options) and returns a probability for each option, in a few hundred milliseconds, for a whole
group of agents in one request. Any model or service that does this quickly and reliably will do: a hosted
decision model, a small local model, a fine-tuned classifier, a small LLM with structured output. Measure it.

**The LLM** plans. It reads a compact report that code writes (numbers, not raw logs), decides whether to change
the plan, and explains why in a sentence. It runs about once a minute, plus when something big happens. Its plan
is a small structured object, and its fields show up in every agent's next question.

The loop closes when the next report shows what the agents did under the new plan.

## Why it works

- **Latency matches the job.** Agents need answers in a fraction of a second. Plans can take seconds.
- **Cost matches the value.** Thousands of cheap, short decisions; a few dozen expensive, thoughtful ones.
- **Safety by construction.** The decision model can only pick options code has validated, so it can't do
  something impossible or forbidden.
- **Explainable.** The LLM says why the plan changed; every decision has odds you can show.
- **Graceful degradation.** If the decision model is slow or down, rules take over. If the LLM is down, the
  current plan stands.

## The arithmetic

Do this for the user's case before building anything.

| | Football demo |
| --- | --- |
| Agents | 22 (two teams of 11) |
| Decisions per agent per second | about 3 (a request every 333 ms, plus event triggers) |
| Decisions per second | about 50 to 66 |
| Requests per second | about 6 (one per team per tick, all 11 questions together) |
| Decision latency, measured | p50 about 235 ms, p95 about 285 ms |
| LLM latency, measured | about 2 s per call |
| LLM calls | about once a match minute per team |
| Whole 90-minute match (about 6.6 real minutes) | about 21,000 decisions applied; $0.39 total ($0.23 decisions, $0.16 LLM) |

At 2 s per call, an LLM per decision would let each agent act at most once every 2 seconds, six times less often
than the demo, with 22 calls in flight at all times. That is the gap this pattern closes.

## Where it fits

- **Games and simulations:** NPCs, sports, crowds, training simulators.
- **Fleets:** warehouse robots, delivery vehicles, drones choosing the next task or route segment.
- **Routing:** contact-centre calls, tickets, alerts to the next best queue or person.
- **Live operations:** network, grid or plant adjustments within limits set by a planner.
- **Trading and pricing within guardrails:** many small adjustments, a slow strategic policy.

The test: many agents, many small decisions per second, a plan that changes on a slower clock, and options code
can enumerate and check.

## Where it doesn't

- One agent making a few decisions: just call the LLM.
- Decisions that can't be reduced to a list of options code can check.
- Decisions with serious consequences that need a human in the loop (moving money, granting access, medical
  calls). The pattern can propose; a person decides.
- When you can't measure the outcome. Without the report, the slow loop is guessing.
