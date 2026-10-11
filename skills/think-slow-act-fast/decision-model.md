# Microsoft Decision on Foundry

The recommended fast loop is **Microsoft-Decision-1**, hosted in **Microsoft Foundry**.
Code supplies valid options; the model returns a typed choice, confidence and probabilities.
The starter uses native `fetch` and Microsoft Entra authentication; no third-party decision SDK or local model server.

## Deploy deliberately

Ask before creating resources or deployments. Use an existing Foundry account and check its available quota.
The catalog model is `Microsoft-Decision-1`, version `1`; use `decision-1` as the deployment name.
Do **not** name the deployment `microsoft-decision-1`: it is a reserved name.

```bash
az login
az cognitiveservices account deployment create \
  --name <account> --resource-group <resource-group> \
  --deployment-name decision-1 \
  --model-name Microsoft-Decision-1 --model-format Microsoft --model-version 1 \
  --sku-name DataZoneStandard --sku-capacity 60
```

Capacity is literal **requests per minute**, not thousands of tokens or requests.
EU Data Zone deployments are supported in West Europe; global deployments are supported in UK South.
Check current regional availability, SKU and tenant quota before deploying; a tenant may only permit 60 RPM.
Input costs **$0.042 per million tokens**; output is free. Confirm current pricing before incurring costs.
Planner inference is billed separately.

## Connect keylessly

Use the account endpoint, not a project URL, inference/chat route or deployment URL:

- POST `https://<account>.services.ai.azure.com/providers/microsoft/v1/systemone`
- Entra OAuth scope: `https://cognitiveservices.azure.com/.default`
- Header: `Authorization: Bearer <access-token>`
- Request body `model`: **your deployment name**, such as `decision-1`.

Grant the calling identity the account's model-inference data-plane permissions (for example Cognitive Services User,
subject to your account's RBAC policy). `DefaultAzureCredential` uses `az login` locally or managed identity in Azure.
The planner's Azure OpenAI role and deployment are separate; see `planner.md`.

```bash
DECISION_MODEL=microsoft \
DECISION_ENDPOINT=https://<account>.services.ai.azure.com \
DECISION_DEPLOYMENT=decision-1 DECISION_RPM=60 npm start
```

If keyless auth is unavailable, `DECISION_API_KEY` explicitly opts into the `api-key` header.
Keep keys in environment/Key Vault, never in code or recordings.

## Choice contract

Shared `state` and `instructions` may be text or JSON. Each question has stable option keys.
The example is illustrative, not a measured response.

```json
{
  "model": "decision-1",
  "state": { "goal": "ship orders before they are due", "plan": "help across zones when idle" },
  "questions": {
    "N3": {
      "type": "choice",
      "instructions": {
        "you": "robot N3, a fast picker",
        "what_you_see": { "battery": "above the charging threshold", "backlog": "two nearby orders" },
        "instruction_from_the_plan": "Help the south zone when idle",
        "question": "Following the plan, what do you do next?"
      },
      "criteria": {
        "pick_order_17": "pick order 17: nearest order, due soon",
        "go_charge": "charge now: battery still above the threshold",
        "wait": "wait here for a better order"
      }
    }
  }
}
```

```json
{
  "model": "microsoft-decision-1",
  "answers": {
    "N3": {
      "type": "choice", "choice": "pick_order_17", "confidence": 0.8,
      "probabilities": { "pick_order_17": 0.8, "go_charge": 0.15, "wait": 0.05 }
    }
  },
  "usage": { "input_tokens": 200, "output_tokens": 0 }
}
```

The response model ID need not equal the deployment name. This starter implements `choice` only.
It validates answer type, offered keys, confidence, probability range/normalization and usage.
Missing or malformed answers, HTTP errors, timeout and network errors **throw**: they are not converted to
success-shaped model decisions. Only an agent with exactly one valid option is resolved locally without inference.
Rules are applied by the scheduler as explicitly counted fallback decisions.

## Quota changes the cadence

Two groups at 3 requests/s each require **360 RPM**, before event triggers. A **60 RPM** deployment
admits at most one request/s across both groups: approximately **2 seconds per group** when both are active.
Question batching reduces requests, but does not turn a 60 RPM deployment into a 360 RPM deployment.

The warehouse shares one wall-clock `RequestBudget` across both schedulers, takes turns between waiting groups,
caps in-flight calls at one per group and never queues old snapshots. Triggers cannot bypass the budget.
The 1/3-second cadence is an application attempt cadence, **not** the achieved Foundry request rate.
Urgent robots waiting one second get a rule **fallback**; three consecutive model failures enable group fallback.
Expect fallback at low quota, even when Foundry is healthy. Admission deferrals, HTTP errors, model responses,
model decisions, fallback decisions and p50 latency are reported separately. Deferrals count scheduling attempts,
not HTTP 429s. A process-local budget cannot account for other apps sharing the deployment: reserve headroom or
use a coordinated deployment-wide limiter. Errors consume admission slots; there are no hidden retries.

Set `DECISION_RPM` no higher than your allocated share. Request more quota or combine compatible group state
before claiming a higher model-only cadence. Measure p50/p95, stale rate and outcomes on the actual deployment;
legacy local/third-party latency and cost figures are **not Microsoft Decision benchmarks**.

## Write useful questions

1. Give each agent a concise identity and describe what it sees in words.
2. Put the deciding facts in each option. Compute distances, comparisons, safety and odds in code.
3. Filter invalid and pointless options in code; keep a compact shortlist (the starter uses eight).
4. Send shared goals and the current plan once; per-agent instructions belong in that agent's question.
5. Shuffle options (the engine does this) and keep stable executor keys.
6. Sample probabilities for variety or set `sample: false` for argmax. Low confidence can trigger visible hesitation.
7. Apply freshness checks after inference and validate again at execution time.

The eight-option cap is application policy, not a published model token limit. Evaluate model accuracy and
language support for your workload rather than importing limits from other models.

## Microsoft-hosted is not a compliance certificate

Microsoft post-trained this model from **Qwen3.5-9B**. Using Microsoft-hosted decision and planner deployments
does not certify the application as “100% compliant.” Review model provenance, licenses, data boundaries,
identity, networking, retention, telemetry and your organization's controls separately.

Sources:
- [Microsoft Learn: use Microsoft Decision](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
- [Microsoft Decision 1 on Foundry](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/)
