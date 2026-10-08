import { DefaultAzureCredential } from '@azure/identity';
import { approveAll, CopilotClient, defineTool, ToolSet } from '@github/copilot-sdk';
import { z } from 'zod';
import type { PlanChange, PlannerBackend, ReviewInput } from './planner.js';

/**
 * The planner as a GitHub Copilot SDK agent.
 *
 * Model: a Microsoft Foundry deployment (bring your own key), with keyless Microsoft Entra auth through
 * DefaultAzureCredential (az login locally, managed identity in Azure). Without FOUNDRY_ENDPOINT it falls back
 * to the signed-in GitHub Copilot user's models.
 *
 * The agent gets only our tools (no shell, no file access), one fresh session per review (the report carries
 * the memory it needs), and must answer in the plan's JSON schema.
 */
export interface CopilotPlannerOptions<S extends z.ZodTypeAny> {
  /** Zod schema of the plan. Use enums for every field your code acts on. */
  planSchema: S;
  /** Who the planner is, what it controls, and how cautious to be. */
  instructions: string;
  /** Foundry resource endpoint host, e.g. https://my-foundry.cognitiveservices.azure.com (no path). */
  foundryEndpoint?: string;
  /** Deployment name, e.g. gpt-5.6-luna. */
  model: string;
  /** Extra read-only tools the planner may call (metrics, history, forecasts). */
  tools?: ReturnType<typeof defineTool>[];
  /** Folder for the Copilot runtime's session data. */
  homeDir?: string;
  timeoutMs?: number;
}

export class CopilotPlanner<S extends z.ZodTypeAny> implements PlannerBackend<z.infer<S>> {
  readonly name: string;
  private client: CopilotClient | null = null;
  private readonly credential = new DefaultAzureCredential();

  constructor(private readonly o: CopilotPlannerOptions<S>) {
    this.name = `${o.model}${o.foundryEndpoint ? ' (Foundry)' : ' (GitHub Copilot)'}`;
  }

  private async started(): Promise<CopilotClient> {
    if (!this.client) {
      this.client = new CopilotClient({ mode: 'empty', baseDirectory: this.o.homeDir ?? '.copilot-home', logLevel: 'error' });
      await this.client.start();
    }
    return this.client;
  }

  async review(input: ReviewInput<z.infer<S>>): Promise<PlanChange<z.infer<S>>> {
    const client = await this.started();
    const provider = this.o.foundryEndpoint
      ? {
          type: 'azure' as const,
          baseUrl: this.o.foundryEndpoint,
          // Responses API: needed for tools with reasoning models on Foundry.
          wireApi: 'responses' as const,
          bearerToken: (await this.credential.getToken('https://cognitiveservices.azure.com/.default')).token,
        }
      : undefined;
    const answer = z.object({ change: z.boolean(), plan: this.o.planSchema, reasoning: z.string() });
    const session = await client.createSession({
      model: this.o.model,
      ...(provider ? { provider } : {}),
      availableTools: new ToolSet().addCustom('*'),
      tools: [
        defineTool('get_report', {
          description: 'The latest report on how the plan is working, built by code from live data.',
          parameters: z.object({}),
          handler: () => input.report,
        }),
        ...(this.o.tools ?? []),
      ],
      systemMessage: { mode: 'replace', content: this.o.instructions },
      onPermissionRequest: approveAll,
    });
    try {
      const prompt = [
        `Why you are asked now: ${input.trigger}.`,
        `Current plan: ${JSON.stringify(input.currentPlan)}.`,
        input.lastChange
          ? `Your last change was ${input.lastChange.secondsAgo} s ago, because: ${input.lastChange.reasoning}`
          : 'You have not changed the plan yet.',
        'Call get_report, then decide. Set change=false and return the current plan unless the numbers show a clear problem or opportunity.',
      ].join('\n');
      return (await session.sendAndWait({ prompt }, answer, this.o.timeoutMs ?? 60_000)) as PlanChange<z.infer<S>>;
    } finally {
      await session.disconnect();
    }
  }

  async stop(): Promise<void> {
    await this.client?.stop();
    this.client = null;
  }
}
