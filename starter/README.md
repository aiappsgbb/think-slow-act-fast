# Starter: think slow, act fast

Twelve warehouse robots in two zones pick orders and recharge. **Microsoft-Decision-1 on Microsoft Foundry**
chooses valid jobs; a **GitHub Copilot SDK planner on Foundry** sets priorities, charging policy and zone rules.
Code owns the world, valid options, execution, freshness and safety. Rules remain the offline baseline and fallback.

```
src/core/
  types.ts           options, snapshots, decisions, engine interface
  systemone.ts       Microsoft Decision REST transport, Entra auth, answer validation
  rules.ts           seeded rules: baseline, fallback, test oracle
  scheduler.ts       cadence, triggers, shared RequestBudget, freshness, fallbacks, metrics
  planner.ts         slow loop: interval, triggers, cooldown, never blocks
  copilot-planner.ts Copilot SDK + Foundry (Entra), typed plans
  rng.ts             seeded randomness
src/warehouse/
  world.ts           state, step, execution, hard safety
  domain.ts          questions, rules, freshness, report, plan schema/instructions
  run.ts             headless runner with live status
test/                transport, scheduler, rules, configuration and reference tests
```

## Run the baseline

Node 20.19+ or 22.12+:

```bash
npm install
npm test
npm run typecheck
npm start                 # rules only; no network
```

## Microsoft Decision

Follow [deployment and permissions](../skills/think-slow-act-fast/decision-model.md) before connecting.
Use `az login` locally; managed identity in Azure. The decision deployment is **not** the planner deployment.

```bash
DECISION_MODEL=microsoft \
DECISION_ENDPOINT=https://<account>.services.ai.azure.com \
DECISION_DEPLOYMENT=decision-1 DECISION_RPM=60 npm start
```

Transport: POST `/providers/microsoft/v1/systemone` on the account host.
Entra scope: `https://cognitiveservices.azure.com/.default`.
Body `model` is the deployment name, not the catalog ID. `DECISION_API_KEY` optionally selects the `api-key`
header instead of Entra. Never put keys in code, logs or videos.

Two groups at 3 requests/s need **360 RPM** before triggers. At **60 RPM**, the shared wall-clock budget admits
at most one request/s total, approximately two seconds per active group. Urgent robots get explicit rule fallback
after one second. The runner keeps one request in flight per group and never queues old snapshots.
Set `DECISION_RPM` no higher than your allocated deployment share; other apps may consume the same quota.
The 1/3-second scheduler cadence does not guarantee a 3 Hz model rate.

## Add the planner

With a separately deployed planner model and the planner's Cognitive Services OpenAI User role:

```bash
PLANNER=foundry \
FOUNDRY_ENDPOINT=https://<resource>.cognitiveservices.azure.com FOUNDRY_MODEL=<planner-deployment> \
DECISION_MODEL=microsoft \
DECISION_ENDPOINT=https://<account>.services.ai.azure.com DECISION_DEPLOYMENT=decision-1 DECISION_RPM=60 \
npm start
```

The planner uses the Responses API, not the decision endpoint. Optional Copilot-prototyping path:
`PLANNER=copilot COPILOT_MODEL=gpt-5 npm start`; use `PLANNER=foundry` for the Microsoft-hosted model path.
Default planner is `off`; default decision engine is `rules`. Unknown decision providers fail explicitly.
Options: `DURATION` (seconds, default 120), `SEED` (default 7).

## What to observe

From 40 to 100 seconds orders surge in the south. Under `own_zone_only`, the north can idle while the south backs
up; the planner's report lets it consider `help_anywhere` and due-date priority. Keep this scenario when adapting.

The status line reports open/done/late orders, **model or rule** decisions/s, measured p50 (`n/a` without inference),
stale %, fallback decisions, errors, requests, validated responses, quota-deferred scheduling attempts and input cost.
Malformed/missing answers, HTTP errors and network failures propagate to the scheduler, never masquerade as
successful model decisions. No hidden retries. Tokens cost $0.042/million input; output is free; planner billed separately.
No previous provider's latency or outcome numbers are presented as Microsoft Decision results.

## Make it yours

1. Replace `src/warehouse/`: state, fixed-step execution and hard safety in `world.ts`.
2. Implement `Domain`: snapshot, triggerKey, isFresh, apply, urgent; rule scores and typed plan/report in `domain.ts`.
3. Keep one scheduler per group, **one shared RequestBudget per decision deployment**, and the planner loop.
4. Run rules, then Microsoft Decision, then Foundry planner. Evaluate the same seeds and keep tests green.
5. Review model provenance (Microsoft post-trained from Qwen3.5-9B), licensing and organizational controls:
   Microsoft hosting is not a compliance certificate.

The [skill](../skills/think-slow-act-fast/SKILL.md) walks through the full pattern.
