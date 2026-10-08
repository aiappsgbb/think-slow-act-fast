# The planner: GitHub Copilot SDK on Microsoft Foundry

The slow loop is an agent: it reads a report, may call a tool or two, decides whether to change the plan, and says
why. We run it with the **GitHub Copilot SDK** (the runtime behind Copilot CLI) and a model deployed in **Microsoft
Foundry**, connected with the SDK's *bring your own key* provider and keyless **Microsoft Entra** auth.

Checked with `@github/copilot-sdk` 1.0.17 and a Foundry `gpt-5.6-luna` deployment, October 2026. The starter's
`src/core/copilot-planner.ts` is the working version of everything below.

## Set up Foundry (once)

1. A Foundry resource and project in a region with your model. Deploy a current reasoning model with low latency
   (we used `gpt-5.6-luna`, GlobalStandard; a review took about 2–6 s including tools).
2. Give the identity that runs the planner **Cognitive Services OpenAI User** on the Foundry resource: yourself for
   local runs (`az login`), the app's managed identity in Azure.
3. Note the endpoint host, e.g. `https://<resource>.cognitiveservices.azure.com` (host only, no path), and the
   deployment name.

No keys: `DefaultAzureCredential` picks up `az login` locally and the managed identity in Azure.

## The planner, in code

```ts
import { DefaultAzureCredential } from '@azure/identity';
import { approveAll, CopilotClient, defineTool, ToolSet } from '@github/copilot-sdk';
import { z } from 'zod';

const Plan = z.object({
  priority: z.enum(['throughput', 'due_dates', 'battery_safety']),
  charge_below: z.number(),                // no .int()/.min()/.max(): some providers reject numeric bounds; clamp in code
  zones: z.enum(['own_zone_only', 'help_anywhere']),
  instructions: z.array(z.object({ robot: z.string(), instruction: z.string() })),   // no .max(): clamp to 2 in code
});
const Answer = z.object({ change: z.boolean(), plan: Plan, reasoning: z.string() });

const client = new CopilotClient({ mode: 'empty', baseDirectory: '.copilot-home', logLevel: 'error' });
await client.start();                                     // once per process
const credential = new DefaultAzureCredential();

async function review(report: object, currentPlan: z.infer<typeof Plan>, trigger: string) {
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  const session = await client.createSession({          // one fresh session per review
    model: process.env.FOUNDRY_MODEL!,                    // the deployment name
    provider: {
      type: 'azure',                                      // 'azure' for Foundry/Azure OpenAI hosts
      baseUrl: process.env.FOUNDRY_ENDPOINT!,             // host only
      wireApi: 'responses',                               // needed for tools with reasoning models
      bearerToken: token.token,                           // Entra token, refreshed per review
    },
    availableTools: new ToolSet().addCustom('*'),         // only our tools: no shell, no files
    tools: [defineTool('get_report', {
      description: 'The latest report on how the plan is working, built by code from live data.',
      parameters: z.object({}),
      handler: () => report,
    })],
    systemMessage: { mode: 'replace', content: PLANNER_INSTRUCTIONS },
    onPermissionRequest: approveAll,                      // safe: the only tools are our read-only ones
  });
  try {
    const prompt = `Why you are asked now: ${trigger}. Current plan: ${JSON.stringify(currentPlan)}. ` +
      'Call get_report, then decide. Set change=false and return the current plan unless the numbers show a clear problem or opportunity.';
    return await session.sendAndWait({ prompt }, Answer, 60_000);   // typed, validated result
  } finally {
    await session.disconnect();
  }
}
```

What the starter wraps around this (`src/core/planner.ts`, `PlannerLoop`):

- **Never blocks.** Reviews run in the background; the simulation keeps ticking; the plan swaps in when the answer
  arrives. One review in flight at a time.
- **Interval, triggers, cooldown.** Regular review every `intervalS`; `trigger(reason)` for events (overdue work, an
  alarm, a goal); after a change, `cooldownS` before the next regular review. The next-review time only ever moves
  later, so an event can't cancel a cooldown.
- **Memory through the report, not the session.** Each review is a fresh session. The prompt carries the current
  plan, the trigger and the last change with its age; the report carries the numbers. This keeps context small,
  cost flat and behaviour reproducible.

## The instructions that worked

```text
You are the shift planner for a warehouse robot fleet in two zones, north and south.
Each robot decides its own next job several times a second with a fast decision model. You set the plan they follow.
You control: priority (throughput, due_dates, battery_safety), charge_below (15-50), zones (own_zone_only or
help_anywhere), and at most two instructions for named robots.
Change the plan only when the report shows a clear problem or opportunity, and give a change time to work.
reasoning: one sentence for the operations team, citing numbers from the report.
```

A real answer from the starter, 71 s into a shift with a surge of orders in the south zone:

> North has 4 idle robots while south has 1 open order and 0 idle robots, so allowing temporary cross-zone help
> should reduce the 26-second average wait without affecting the 0% late rate.
> `{"priority":"throughput","charge_below":20,"zones":"help_anywhere","instructions":[{"robot":"N2","instruction":"For the next 5 minutes, take the next suitable south-zone order before waiting."}]}`

## Tools: when to give the planner more than the report

Start with one tool, `get_report`. Add read-only tools when the planner needs to look something up rather than
read everything: `get_history` (past plans and their outcomes), `get_forecast` (expected demand), `get_agent`
(one agent's recent decisions). Keep every tool read-only; the only way the planner changes the world is by
returning a plan, which code validates and applies.

If the planner must act outside the system (page someone, open a ticket), put the Agent Governance Toolkit in front of
those tools, as in the [foundry-autopilots](https://github.com/aiappsgbb/foundry-autopilots) skill.

## Telemetry

```ts
const client = new CopilotClient({ mode: 'empty', baseDirectory: '.copilot-home',
  telemetry: { otlpEndpoint: 'http://localhost:4318' } });       // an OpenTelemetry Collector
```

The runtime emits spans for every session, model call and tool call. Export them from the collector to Azure Monitor
(Application Insights) connected to your Foundry project, next to your app's spans and the fast loop's metrics.
Log every review as a record: trigger, report, plan before and after, reasoning, latency, and the outcome over the
next window. That log is your evaluation set.

## Hosting

- **In-process (default).** The planner runs inside the app container with the fast loop. The Copilot SDK ships
  its runtime as a platform package, so no separate install. Give the container's managed identity the Foundry role.
- **As a Foundry hosted agent.** When the planner needs its own identity, its own channel (Teams, email) or
  independent scaling, host it as a Foundry hosted agent and call it from the app with the report. The
  [foundry-autopilots](https://github.com/aiappsgbb/foundry-autopilots) skill covers hosting the Copilot SDK in Foundry.

## Gotchas we hit

| Error | Fix |
| --- | --- |
| `CopilotClient was created with mode: 'empty' but neither 'baseDirectory' nor 'sessionFs' was set` | `mode: 'empty'` is the server mode; give it a `baseDirectory` |
| `400 Function tools with reasoning_effort are not supported for <model> in /v1/chat/completions` | `wireApi: 'responses'` |
| `401`/`403` from Foundry | Token scope `https://cognitiveservices.azure.com/.default`; role Cognitive Services OpenAI User; `type: 'azure'`; `baseUrl` is the host only |
| Token expired mid-run | Get a token per review (the credential caches and refreshes); don't keep one session for hours |
| The planner calls tools you didn't expect | Set `availableTools: new ToolSet().addCustom('*')` so built-in tools (shell, files) are off |
| `400 output_config.format.schema: ... 'minimum'/'maximum'/'maxItems' not supported` | Some providers reject numeric and array bounds in structured output (and Zod's `.int()` adds bounds). Use plain `z.number()` and `z.array()`, then round and clamp in code |
| Plan JSON doesn't parse | Use `sendAndWait(options, zodSchema)`; with Foundry use a model that supports structured output |
