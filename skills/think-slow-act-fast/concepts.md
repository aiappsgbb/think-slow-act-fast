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

| | Microsoft Decision capacity planning |
| --- | --- |
| Agents | 22 (two teams of 11) |
| Target decisions per agent per second | 3; not guaranteed by the deployment |
| Target decisions per second | 66 |
| Required requests per second | 6 (one per team; batch all 11 questions), plus triggers |
| Required quota | 360 RPM before triggers |
| At 60 RPM | At most 1 request/s shared; about 2 seconds between requests per active group |
| Decision latency and achieved throughput | Measure this deployment; separate model and fallback decisions |
| LLM calls | About once a match minute per team, plus events and cooldown |
| Decision cost | Input tokens × $0.042/million; output free; planner cost separate |

For an illustrative LLM taking 2 seconds per call, sequential per-agent calls only allow one action every two
seconds. Grouped decision inference closes that gap **only if quota and measured latency support it**.
At low quota the system stays responsive through rules, not through fictitious model throughput.

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
