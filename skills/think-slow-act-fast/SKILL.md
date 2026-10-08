---
name: think-slow-act-fast
description: Use when building a system where many agents must act continuously in real time (games, simulations, robot or vehicle fleets, routing, live operations) and calling an LLM for every decision is too slow or too expensive. Builds the think-slow-act-fast pattern - a decision model (System One API, e.g. Laya locally or TypeSafe Jev hosted) acts for every agent several times a second, a GitHub Copilot SDK planner on a Microsoft Foundry model sets the plan, code keeps both honest - from the runnable starter in this repo. Also use when such a system is sluggish, erratic, stale or costly.
---

# Think slow, act fast

## The pattern

| Layer | Runs | Job | Our default |
| --- | --- | --- | --- |
| **Code** | every tick | State, rules, physics, safety. Builds each agent's valid options and the facts about them. Executes choices. | Your app (TypeScript starter in `starter/`) |
| **Decision model** (fast loop) | ~3× a second per agent, one request per group | Picks one of the options code offered and returns a probability for every option | A **System One** model: Laya locally, TypeSafe Jev hosted |
| **Planner** (slow loop) | about once a minute, plus on events | Reads a report code writes, decides whether to change the plan, explains why | A **GitHub Copilot SDK** agent on a **Microsoft Foundry** model |

The planner thinks slowly about the plan. The decision model acts fast, inside limits code has checked. The plan flows
into every agent's next question; results flow back in the next report.

## The stack we recommend, and why

These are opinions. Each one is swappable behind an interface in the starter, but start here.

| Choice | Default | Why | Swap for |
| --- | --- | --- | --- |
| Decision model API | **System One** (`POST /v1/systemone`): shared `state` + typed questions → a probability per option | One call answers a whole group; answers are always one of your options; probabilities give you sampling, hesitation and hand-off for free | Anything that returns a distribution over given options in a few hundred ms |
| Decision model, local | **Laya** (`pip install "laya[serve]"`, Apache-2.0) | Free, private, ~25–60 ms per question on a laptop GPU. Ideal for development, demos and on-device | |
| Decision model, hosted | **TypeSafe Jev** (`https://api.typesafe.ai`, model `jev-latest`) | ~235 ms for a batch of 11 questions, scales, no hardware. Same wire protocol as Laya, so it's a config change | |
| Fallback | **Rule engine** over the same options | Instant, deterministic; the baseline, the test oracle and what runs when the model is late or down | |
| Planner runtime | **GitHub Copilot SDK** (`@github/copilot-sdk`) | A real agent loop with tools, typed structured output, OpenTelemetry, sessions; the same runtime as Copilot CLI | Direct Responses API calls if you truly need no tools |
| Planner model | **Microsoft Foundry** deployment via Copilot SDK *bring your own key*, keyless **Entra** auth | Your tenant, your quota, your data boundary; managed identity in Azure, `az login` locally | GitHub Copilot models (signed-in user) for prototyping |
| Planner output | **Zod schema** with enums, passed to `sendAndWait` | The plan is always executable; no parsing code | |
| Hosting | App + fast loop in one container (**Azure Container Apps**). Planner in-process; move it to a **Foundry hosted agent** when it needs its own identity or channel | Fewest moving parts; the planner is not latency-critical | |
| Observability | Your metrics + Copilot SDK **OpenTelemetry** → an OpenTelemetry Collector → **Azure Monitor / Application Insights** connected to your Foundry project | One trace view for planner calls; numbers for the fast loop | |
| Evaluation | Seeded replays + **Foundry evaluations** on logged (report, plan, outcome) | Compare rules vs model, planner on vs off, model A vs B on the same seeds | |

| File | Read it when |
| --- | --- |
| `concepts.md` | The user asks what the pattern is, why it works, whether their use case fits |
| `decision-model.md` | Writing questions; setting up Laya or Jev; the System One contract and its limits |
| `planner.md` | Building the slow loop with the Copilot SDK on Foundry: setup, code, gotchas, telemetry, hosting |
| `lessons.md` | Before calling a design sound; when tuning |
| `reference.md` | Interfaces, real request/response examples, scheduler and planner pseudocode, metrics |
| `../../starter/` | The runnable starter: copy it and replace the warehouse domain with yours |

## Rules for the agent running this skill

1. **Start from the starter.** Copy `starter/`, run it as-is first (rules, then a decision model, then the planner),
   then replace the warehouse domain. Don't write the scheduler or planner loop from scratch.
2. **One step at a time.** Don't start a step until its **Done when** is true; show the user the evidence (the
   status line, a test run, a plan change with its reasoning).
3. **Code owns the facts.** Positions, distances, prices, odds, rules: code computes them and puts them into the
   question in words. Models never invent them, and never do maths (compare numbers in code).
4. **Rules first.** The rule engine is the baseline, the fallback and the test oracle. The system must run on rules
   alone before any model is added.
5. **Keyless.** Foundry via Entra (`DefaultAzureCredential`): `az login` locally, managed identity in Azure. Never
   hard-code or print keys. A hosted decision model key comes from the environment or Key Vault.
6. **Ask before you create** Azure resources or model deployments; say what they cost. Use the user's subscription.
7. **Measure, don't assume.** Latency, decisions per second, stale %, fallbacks and cost come from the running system.
8. **If a check fails twice, stop** and report what you ran, what you saw and the matching row in Common problems.

## Step 0: confirm the fit

Get or estimate: agents, decisions per agent per second, the latency budget for one decision, how often the plan
should change, and what one LLM call costs and takes. Do the arithmetic in `concepts.md`.

**Done when** you can say, with numbers, why one LLM call per decision won't do, and what the slow loop's cadence
will be. If one LLM call per decision is fine, say so and stop.

## Step 1: run the starter as-is

```bash
cp -r starter my-system && cd my-system && npm install
npm start                                   # rules only: the baseline, no network
npm test                                    # scheduler freshness, fallbacks, rules
```

Then add a decision model (see `decision-model.md` for setup):

```bash
pip install "laya[serve]" && LAYA_HOST=127.0.0.1 LAYA_MODELS=english laya-serve     # in another terminal
DECISION_MODEL=laya npm start
# or hosted:  DECISION_MODEL=jev TYPESAFE_API_KEY=... npm start
```

Then the planner (see `planner.md`): deploy a model in a Foundry project, give yourself **Cognitive Services
OpenAI User** on the resource, `az login`, and:

```bash
PLANNER=foundry FOUNDRY_ENDPOINT=https://<resource>.cognitiveservices.azure.com FOUNDRY_MODEL=<deployment> \
DECISION_MODEL=laya npm start
```

**Done when** the status line shows decisions per second, a median latency, a stale rate under 10%, zero errors, and
at least one `PLAN CHANGE` whose reasoning cites numbers from the report. In our run: about 15–30 decisions a
second for 12 robots (2,455 in two minutes), Laya at 85–235 ms per group of six after a ~500 ms first call, stale
3–8%, no fallbacks or errors, and the planner switching to `help_anywhere` when the north idled during a south surge.

## Step 2: model your domain

Replace `src/warehouse/` with your domain. You write four things; the core does the rest.

1. **World** (`world.ts`): state, a fixed-step `step(dt)`, execution of chosen actions with their odds, and hard
   safety rules (in the starter, a robot below 8% battery goes to charge whatever anyone decided).
2. **Domain adapter** (`domain.ts`, implements `Domain<W, C>`):
   - `snapshot(w, group)`: the group's questions. Only agents that can act now; only valid options, filtered by
     context and by the plan; each option's text carries the deciding facts in words.
   - `triggerKey(w, group)`: a signature of what matters; when it changes, the scheduler asks immediately.
   - `isFresh(w, snap, decision)`: is this answer still valid now? (task still open, agent still free...)
   - `apply(w, decision)`: act, with a short visible hesitation when confidence < 0.5.
   - `urgent(w, group)`: delay-critical agents and since when they've waited (they get a rule decision after 1 s).
3. **Rule score** (`ruleScore`): a few weights per option type. Keep it simple; it only needs to be sensible.
4. **Plan schema, instructions and report** (`PlanSchema`, `PLANNER_INSTRUCTIONS`, `report()`): see Step 5.

**Done when** `npm start` runs your domain on rules, `npm test` passes, and printing one snapshot reads like a clear
brief to a human operator.

## Step 3: write the questions well

The fast loop is only as good as its questions. See `decision-model.md` for the full guide. The essentials:

- **Shared state once per request**: the goal, the current plan in words, the situation. Short.
- **Per agent**: identity (role and style: "a fast picker with a small battery"), what it sees *in words*, the
  planner's instruction for it if any, the question, and 3–8 options.
- **Each option says why it might be good or bad**: "pick order 17: 6 m away, 3 items, due in 22 s, other zone".
- **Filter by context in code.** Never offer an option code knows is invalid or pointless.
- **Fit the model's limits.** Laya reads about 512 tokens per question including state, and about 190 tokens of
  option text; it is English-only and can't compare numbers. Put key facts first; do comparisons in code.

**Done when** a model run's choices look purposeful (watch the log, not just the totals) and invalid answers are 0.

## Step 4: tune the fast loop

Defaults in `SchedulerOptions` came from a live 11 v 11 football match and held in the warehouse:

| Setting | Default | Notes |
| --- | --- | --- |
| `intervalS` | 1/3 s | Plus immediate requests on `triggerKey` changes |
| `maxInFlight` | 2 (Laya: 1) | Laya serves one call at a time; more in flight just queues and goes stale |
| `deadlineS` | 1 s | Urgent agent with no fresh decision gets a rule decision |
| `outageErrors` | 3 | Then rules drive the group until the model answers |
| Sampling | on | `sample: false` for argmax when you need determinism |
| Hesitation | confidence < 0.5 | Delay 0.2–0.5 s, and show it |

**Done when** stale is under 10%, fallbacks are rare and explained, and killing the decision model mid-run (stop
laya-serve) visibly switches to rules and recovers by itself.

## Step 5: build the planner

See `planner.md` for the code and the gotchas. In short:

- **Plan schema in Zod**, every field an enum or a number that code clamps, plus up to two instructions for named
  agents (no `.min()/.max()/.int()` on numbers or arrays: some providers reject bounds; clamp in code). The planner returns `{ change, plan, reasoning }`.
- **Report built by code**: numbers for a window (since the last change, at least ~30 s or a few minutes), by
  zone or group; what agents chose and how often they hesitated; the current plan; the last change and its age.
- **Triggers and cooldown**: a regular interval, event triggers (overdue work, an alarm, a goal), and a cooldown
  after a change. Never let an event shorten a cooldown accidentally (take the later time).
- **Copilot SDK session per review**, Foundry model via bring-your-own-key, only your tools (`availableTools`),
  typed result with `sendAndWait(prompt, schema)`.
- **The plan reaches the agents**: it's in the shared state of every question and filters the options code offers.

**Done when** the planner changes the plan a handful of times per run, each change cites numbers, the agents'
choices visibly shift afterwards, and it does not flip-flop.

## Step 6: observe, evaluate, ship

- **Metrics** per group (the starter prints them): p50/p95, decisions/s, stale %, invalid, fallbacks, errors,
  tokens per request, cost. Planner: reviews, changes, latency, errors.
- **Traces**: pass `telemetry: { otlpEndpoint }` to `CopilotClient`, pointing at an OpenTelemetry Collector that
  exports to Azure Monitor (Application Insights) connected to your Foundry project, so planner sessions and tool calls
  show up alongside your app's spans.
- **Evaluate on replays**: same seeds, compare rules vs decision model, planner off vs on, model A vs B. Log every
  (report, plan, reasoning, outcome) and score the planner's reasoning with Foundry evaluations.
- **Ship**: one container for app + fast loop on Azure Container Apps with a managed identity that has Cognitive
  Services OpenAI User on the Foundry resource. Laya runs as a sidecar container; Jev needs only the key in Key Vault.

**Done when** you have a dashboard or log with the metrics above, and a replay comparison that shows the model and
the planner each earn their place.

## Step 7: make it visible (demos)

If people will watch it, show both speeds working: the current agent's choice with its odds, a pulse each time an
agent gets a new decision, the planner's status ("reviewing"), a card when it changes the plan with its reasoning,
and live numbers (decisions/s, median decision time, cost). See `lessons.md`.

## Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Agents freeze, then jump | Requests only on a timer | Add `triggerKey` signals for the events that matter; check `deadlineS` |
| Stale rate above 15% | Too many in flight, or freshness too strict | `maxInFlight` 1–2; compare against the snapshot's context, not unrelated state |
| Choices look random | Options too similar, deciding fact missing from the text | Put the numbers that matter into each option's words; drop options code knows are bad |
| Same option every time | Position bias or argmax | Options are shuffled in `SystemOneEngine`; keep `sample` on |
| Two agents chase the same task | Reservation happens too late | Reserve in `apply` (the starter assigns the order at decision time) |
| Laya answers look arbitrary | Over its limits: long state, too many options, non-English, numeric comparisons | Shorten; ≤ 8 options; English; compare in code and say "closer than the others" |
| `systemone 422` | Malformed question | The message names the question and field; usually criteria too long or empty |
| `CopilotClient was created with mode: 'empty' but neither 'baseDirectory'...` | Server mode needs a session store | Pass `baseDirectory` (the starter uses `.copilot-home`) |
| `400 Function tools with reasoning_effort are not supported ... /v1/chat/completions` | Reasoning model on the chat route | `wireApi: 'responses'` in the provider config |
| `401` from Foundry | Wrong token scope or role | Scope `https://cognitiveservices.azure.com/.default`; role Cognitive Services OpenAI User; `type: 'azure'`, host-only `baseUrl` |
| `400 output_config.format.schema: ... 'minimum'/'maximum'/'maxItems' not supported` | Some providers reject numeric and array bounds in structured output (and Zod's `.int()` adds bounds). Use plain `z.number()` and `z.array()`, then round and clamp in code |
| Planner changes the plan every review | No cooldown, no memory | Cooldown after a change; last change and its age in the prompt; "change only on evidence" |
| Planner never changes anything | Report too vague | Per-zone numbers, overdue counts, agent behaviour; explicit event triggers |
| Cost climbs | Long questions or too many requests | One request per group; short shared state; compact option text; measure tokens per request |
