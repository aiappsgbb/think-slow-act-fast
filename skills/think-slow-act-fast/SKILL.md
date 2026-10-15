---
name: think-slow-act-fast
description: Use when many agents must act continuously in games, simulations, robot fleets, routing or live operations, for an AI teammate or companion supporting a human player, for early human handoff from partial speech, when per-decision LLM calls are too slow or costly, or when a Microsoft Foundry decision loop is sluggish, stale, quota-limited or erratic.
---

# Think slow, act fast

Code owns facts and safety. **Microsoft-Decision-1 on Microsoft Foundry** chooses among valid options.
A **GitHub Copilot SDK planner on Foundry** sets strategy on a slower clock.
Start from the runnable twelve-robot warehouse in `../../starter/`; replace its domain, not the architecture.
For voice escalation or early routing, start with `early-handoff.md` and `../../examples/early-handoff/`.
That variant can suppress final LLM generation once a permitted handoff commits; it need not add a planner.
It assumes an existing voice agent and transcript stream; add the decision path, not a replacement voice stack.
For one model-driven teammate beside a human player, read `companion.md` first.

## Quick reference

| Layer | Default | Responsibility |
| --- | --- | --- |
| Code | TypeScript, seeded rules | State, valid options, execution, safety, freshness |
| Fast loop | Microsoft-Decision-1 on Foundry | Typed choices and probabilities |
| Slow loop | Copilot SDK + Foundry, Entra, Zod | Report-driven plans, event triggers, cooldown |
| Auth/hosting | Entra; Azure Container Apps | `az login` locally, managed identity in Azure |
| Observability | Metrics; OpenTelemetry → Azure Monitor | Separate model, fallback, quota and planner activity |

| Reference | Read when |
| --- | --- |
| `concepts.md` | Checking fit and capacity arithmetic |
| `decision-model.md` | Deployment, exact REST contract, auth, quotas, question design |
| `planner.md` | Planner setup, schema, SDK tools, telemetry, hosting |
| `reference.md` | Interfaces, request examples, scheduler, reports |
| `lessons.md` | Tuning, domain adaptation and visible demos |
| `early-handoff.md` | Partial-speech escalation, atomic handoff, skipped generation, measured benefits and risks |
| `companion.md` | An AI teammate for a human player: which character gets the model, executor-first debugging, state against repetition, visible help, honest footage |

## Workflow and evidence

1. **Check fit with numbers.** Estimate agents, decisions/s, latency and review cadence. Two groups at
   3 requests/s require 360 RPM; 60 RPM means roughly one request/s total, two seconds per active group.
   Do not promise the old demo cadence without quota and deployment measurements.
2. **Run rules first.** In `starter/`: `npm install`, `npm test`, `npm start`.
   Done when the warehouse runs without network and tests pass.
3. **Connect Microsoft Decision.** Follow `decision-model.md`; ask before Azure deployment and explain cost.
   Use account host `https://<account>.services.ai.azure.com`, deployment `decision-1`,
   route `/providers/microsoft/v1/systemone`, scope `https://cognitiveservices.azure.com/.default`.
   ```bash
   DECISION_MODEL=microsoft DECISION_ENDPOINT=https://<account>.services.ai.azure.com \
   DECISION_DEPLOYMENT=decision-1 DECISION_RPM=60 npm start
   ```
   Done when real responses and tokens are recorded, with fallback and deferrals explicitly distinguished.
4. **Add the planner.** Set `PLANNER=foundry`, `FOUNDRY_ENDPOINT` and `FOUNDRY_MODEL` (a separate planner
   deployment), keeping the decision variables above. Use Entra; never hard-code or print tokens.
   Done when a plan change cites report numbers and reaches subsequent agent questions.
5. **Adapt the warehouse.** Implement world state/step/safety; `Domain` snapshot/triggerKey/isFresh/apply/urgent;
   rule scores; and Zod plan schema, instructions/report. Code computes comparisons and supplies compact options.
   Done when rules work, snapshots read clearly and tests stay green.
6. **Tune and verify.** Share one `RequestBudget` across groups, never bypass it for triggers, never queue stale
   snapshots. Start at one in-flight call per group; deadline fallback after one second; group fallback after three
   errors. Test malformed answers, outages, ordering and quota. Done when measured outcomes justify the model.
7. **Ship visibly.** Show current choice/probabilities, planner status/reasoning, measured model latency, fallback
   count, quota deferrals and cost. Use seeded replay comparisons and managed identity. Preserve safety in code.

## Common mistakes

- **Calling fallback “model success.”** Missing/invalid answers throw; rules are explicitly counted.
- **Claiming 3 Hz at 60 RPM.** The 1/3-second scheduler cadence is an attempt cadence, not admission throughput.
- **Confusing deployment and catalog IDs.** Body `model` is `decision-1`; catalog is `Microsoft-Decision-1`.
- **Wrong Foundry route/scope.** Decision inference is not OpenAI chat; use the provider route above.
- **Borrowing legacy benchmarks or model limits.** Measure Microsoft Decision; the eight-option cap is app policy.
- **Claiming compliance certification.** Microsoft-hosted is not certification; the model is post-trained from
  Qwen3.5-9B. Review provenance, licensing, identity and data controls separately.
