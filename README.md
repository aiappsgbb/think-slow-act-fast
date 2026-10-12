# Think slow, act fast

A pattern for real-time AI with many agents: **the LLM plans, a fast decision model acts, and code keeps both
honest.**

An LLM takes seconds per call. A football match, a warehouse or a contact centre needs dozens of decisions a
second. So the LLM thinks slowly about the plan, about once a minute, and explains why. A decision model makes
in-the-moment choices from options code has checked, within the deployment's measured latency and quota. Code owns
the facts, the rules and the physics, and reports back to the LLM.

The architecture originated in a live 11 v 11 football match and carries over to the warehouse starter.
The recommended decision model is now **Microsoft-Decision-1 on Microsoft Foundry**. Previous demo throughput,
latency and cost measurements are not benchmarks for this model.

This repo contains:

- **A skill** your coding agent can follow, from "is this the right pattern?" to a working system, with the lessons
  from building it.
- **A runnable starter** (`starter/`): a warehouse of 12 robots where a decision model picks every robot's next job
  and a planner changes the fleet's plan when a surge hits. Copy it and replace the warehouse with your domain.
- **A second demonstration** ([early human handoff](examples/early-handoff/)): hear a recorded synthetic
  call through the normal turn-based path, then replay it with Microsoft-Decision-1 acting on partial speech.
  The browser example runs offline and simulates the transfer; the linked guide explains how to build it.

For a permitted early handoff, code can play an approved acknowledgement and skip the final LLM call.
This voice variant does not require a slow planner. It shows how code can prepare a permitted handoff
without waiting for a generated reply. The guide includes the measured latency, cost and false-handoff results.

## The stack we recommend

The pattern is model-agnostic; the starter is opinionated.

| Layer | Default |
| --- | --- |
| Decision model (fast loop) | **Microsoft-Decision-1 on Microsoft Foundry**, provider System One REST route, keyless Microsoft Entra auth |
| Fallback | A rule engine over the same options |
| Planner (slow loop) | A **GitHub Copilot SDK** agent, with a model deployed in **Microsoft Foundry**, keyless **Microsoft Entra** auth, typed plans (Zod) |
| Hosting | Azure Container Apps; the planner in-process, or as a Foundry hosted agent |
| Observability | OpenTelemetry from the Copilot SDK → Azure Monitor / Application Insights; fast-loop metrics |

## What's in the skill

| File | What it covers |
| --- | --- |
| [SKILL.md](skills/think-slow-act-fast/SKILL.md) | The stack and why, then the steps from the starter to your system, each with a "done when" check, and a troubleshooting table |
| [concepts.md](skills/think-slow-act-fast/concepts.md) | The three layers, why it works, the arithmetic, where it fits and where it doesn't |
| [decision-model.md](skills/think-slow-act-fast/decision-model.md) | Microsoft Decision deployment, exact REST contract, Entra auth, quota, question design |
| [planner.md](skills/think-slow-act-fast/planner.md) | The planner with the GitHub Copilot SDK on Foundry: setup, code, instructions, tools, telemetry, hosting, gotchas |
| [lessons.md](skills/think-slow-act-fast/lessons.md) | What we learned: the fast loop, the slow loop, and making it visible to an audience |
| [reference.md](skills/think-slow-act-fast/reference.md) | Interfaces, a real question and answer, the scheduler, the plan schema, the report, the metrics |
| [early-handoff.md](skills/think-slow-act-fast/early-handoff.md) | The second demo: partial speech, human escalation, skipped generation, latency clocks, cost and adverse evidence |
| [starter/](starter/) | The runnable starter and its README |
| [examples/early-handoff/](examples/early-handoff/) | Credential-free recorded call replay and tested execution/audio helpers |

## Use it

```bash
git clone https://github.com/aiappsgbb/think-slow-act-fast && cd think-slow-act-fast/starter
npm install && npm start            # rules baseline; see starter/README.md for Microsoft Foundry
```

To give the skill to your coding agent, copy `skills/think-slow-act-fast/` into its skills folder (for GitHub Copilot
CLI, `~/.copilot/skills/`) and ask: *"Help me build a think-slow-act-fast system for ..."*. The skill tells the agent
to check the fit with numbers first, start from the starter, keep auth keyless, and ask before creating anything in
Azure.

To run the second demo, from this repository's root run
`python3 -m http.server 8080 --bind 127.0.0.1`, then open
<http://localhost:8080/examples/early-handoff/>. The skill link remains <https://aka.ms/think-slow-act-fast>.

## Foundry capacity and governance

Decision calls use `POST https://<account>.services.ai.azure.com/providers/microsoft/v1/systemone`;
body `model` is the deployment name (for example `decision-1`). Entra scope:
`https://cognitiveservices.azure.com/.default`. See the [setup guide](skills/think-slow-act-fast/decision-model.md).

Two groups at 3 requests/s need **360 RPM**, before triggers. At **60 RPM**, the starter admits at most one
request/s across both zones and counts urgent rule fallbacks separately. It shares a paced wall-clock budget;
`DECISION_RPM` must reflect your allocated share. Model responses, errors and quota deferrals are not interchangeable.
Input price is $0.042/million tokens; output is free. Validate current price and tenant quota before deployment.

The Microsoft-hosted fast loop replaces the earlier local/third-party recommendation, without changing the
warehouse or planner architecture. Microsoft post-trained the model from Qwen3.5-9B; this is not an application
compliance certification. Review provenance, licenses, data boundaries and organizational controls independently.

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## License

[MIT](LICENSE). Built by the Microsoft GBB team.
