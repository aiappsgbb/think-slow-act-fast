# Starter: think slow, act fast

A small, complete system you can run in a minute and then make your own. Twelve warehouse robots in two zones pick
orders and recharge. Every robot's next job is decided by a **decision model** several times a second; a **planner**
(a GitHub Copilot SDK agent on a Microsoft Foundry model) sets the fleet's priorities, charging policy and zone rules;
**code** owns the warehouse, the options and the safety rules.

```
src/core/            the pattern, domain-free (reuse as-is)
  types.ts           Option, AgentQuestion, Snapshot, Decision, DecisionEngine
  systemone.ts       decision model over the System One API (Laya locally, TypeSafe Jev hosted)
  rules.ts           rule engine: baseline, fallback, test oracle
  scheduler.ts       fast loop: cadence + triggers, in-flight cap, freshness, fallbacks, metrics
  planner.ts         slow loop: interval, event triggers, cooldown, never blocks
  copilot-planner.ts planner backend: GitHub Copilot SDK + Foundry (keyless Entra), typed plan
  rng.ts             seeded randomness
src/warehouse/       the example domain (replace with yours)
  world.ts           state, step(), execution, safety
  domain.ts          questions, rule scores, freshness, report, plan schema, planner instructions
  run.ts             headless runner with a live status line
test/core.test.ts    scheduler and rule-engine tests
```

## Run it

Node 20.19+ or 22.12+.

```bash
npm install
npm test
npm start                                        # rules only: no network, the baseline
```

Decision model, local (Laya, free) or hosted (Jev):

```bash
pip install "laya[serve]" && LAYA_HOST=127.0.0.1 LAYA_MODELS=english laya-serve   # other terminal, port 8000
DECISION_MODEL=laya npm start

DECISION_MODEL=jev TYPESAFE_API_KEY=... npm start
```

Planner on your Foundry deployment (you need Cognitive Services OpenAI User on the resource, and `az login`):

```bash
PLANNER=foundry FOUNDRY_ENDPOINT=https://<resource>.cognitiveservices.azure.com FOUNDRY_MODEL=<deployment> \
DECISION_MODEL=laya npm start
```

Or on your GitHub Copilot models, for a quick try: `PLANNER=copilot COPILOT_MODEL=gpt-5 npm start`.

Options: `DURATION` (seconds, default 120), `SEED` (default 7), `LAYA_URL` (default `http://127.0.0.1:8000`).

## What you'll see

```
t= 70s  open  5  done  11  late  0  | 28.0 dec/s  p50 84 ms  stale 3%  fallbacks 0  errors 0  | planner reviewing, 0 changes

  PLAN CHANGE at 71 s (gpt-5.6-luna (Foundry)): North has 4 idle robots while south has 1 open order and 0 idle
  robots, so allowing temporary cross-zone help should reduce the 26-second average wait without affecting the
  0% late rate.
  -> {"priority":"throughput","charge_below":20,"zones":"help_anywhere","instructions":[{"robot":"N2", ...}]}
...
Done in 121 s: 16 orders shipped, 0 late, 8 open, 0 forced recharges. 2455 decisions applied (20.3/s),
planner: 7 reviews, 2 changes.
```

From 40 s to 100 s orders surge in the south zone. On `own_zone_only` the south gets busy while the north idles;
the planner notices from the report and lets robots help across zones, then moves to due-date priority when an order
goes overdue. (Laya locally, Foundry `gpt-5.6-luna` planner, seed 7.)

## Make it yours

1. Copy `src/warehouse/` to `src/<your-domain>/`.
2. `world.ts`: your state, a fixed-step `step(dt)`, execution with its odds, hard safety rules.
3. `domain.ts`: implement `Domain` (snapshot, triggerKey, isFresh, apply, urgent), a `ruleScore`, your `PlanSchema`,
   the planner instructions and `report()`.
4. `run.ts`: one `Scheduler` per group, one `PlannerLoop`, your event triggers.
5. Run on rules, then a decision model, then the planner. Keep `npm test` green.

The skill in `../skills/think-slow-act-fast/` walks through each step and what "done" looks like.
