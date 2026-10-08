# Think slow, act fast

A pattern for real-time AI with many agents: **the LLM plans, a fast decision model acts, and code keeps both
honest.**

An LLM takes seconds per call. A football match, a warehouse or a contact centre needs dozens of decisions a
second. So the LLM thinks slowly about the plan, about once a minute, and explains why. A decision model makes
every in-the-moment choice in a few hundred milliseconds, picking only from options code has checked. Code owns
the facts, the rules and the physics, and reports back to the LLM.

We built it into a live 11 v 11 football match: 22 players deciding about three times a second each, an LLM
manager per team changing the tactics, around 50 decisions a second, a median decision in about 235 ms, and a
whole 90-minute match for under 40 cents.

This repo has two parts:

- **A skill** your coding agent can follow, from "is this the right pattern?" to a working system, with the lessons
  from building it.
- **A runnable starter** (`starter/`): a warehouse of 12 robots where a decision model picks every robot's next job
  and a planner changes the fleet's plan when a surge hits. Copy it and replace the warehouse with your domain.

## The stack we recommend

The pattern is model-agnostic; the starter is opinionated.

| Layer | Default |
| --- | --- |
| Decision model (fast loop) | The **System One** API: **Laya** locally (open source, Apache-2.0) or **TypeSafe Jev** hosted. Same wire protocol, one config change |
| Fallback | A rule engine over the same options |
| Planner (slow loop) | A **GitHub Copilot SDK** agent, with a model deployed in **Microsoft Foundry**, keyless **Microsoft Entra** auth, typed plans (Zod) |
| Hosting | Azure Container Apps; the planner in-process, or as a Foundry hosted agent |
| Observability | OpenTelemetry from the Copilot SDK → Azure Monitor / Application Insights; fast-loop metrics |

## What's in the skill

| File | What it covers |
| --- | --- |
| [SKILL.md](skills/think-slow-act-fast/SKILL.md) | The stack and why, then the steps from the starter to your system, each with a "done when" check, and a troubleshooting table |
| [concepts.md](skills/think-slow-act-fast/concepts.md) | The three layers, why it works, the arithmetic, where it fits and where it doesn't |
| [decision-model.md](skills/think-slow-act-fast/decision-model.md) | The System One contract, Laya and Jev setup, writing questions that work, limits |
| [planner.md](skills/think-slow-act-fast/planner.md) | The planner with the GitHub Copilot SDK on Foundry: setup, code, instructions, tools, telemetry, hosting, gotchas |
| [lessons.md](skills/think-slow-act-fast/lessons.md) | What we learned: the fast loop, the slow loop, and making it visible to an audience |
| [reference.md](skills/think-slow-act-fast/reference.md) | Interfaces, a real question and answer, the scheduler, the plan schema, the report, the metrics |
| [starter/](starter/) | The runnable starter and its README |

## Use it

```bash
git clone https://github.com/aiappsgbb/think-slow-act-fast && cd think-slow-act-fast/starter
npm install && npm start            # runs on rules in seconds; see starter/README.md for Laya, Jev and Foundry
```

To give the skill to your coding agent, copy `skills/think-slow-act-fast/` into its skills folder (for GitHub Copilot
CLI, `~/.copilot/skills/`) and ask: *"Help me build a think-slow-act-fast system for ..."*. The skill tells the agent
to check the fit with numbers first, start from the starter, keep auth keyless, and ask before creating anything in
Azure.

Numbers were measured in October 2026 with `@github/copilot-sdk` 1.0.17, Laya and Jev.

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
