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

This repo is one skill that takes you, or your coding agent, from "is this the right pattern?" to a working
system, with the lessons from building it.

## What's in the skill

| File | What it covers |
| --- | --- |
| [SKILL.md](skills/think-slow-act-fast/SKILL.md) | The steps, each with a "done when" check, rules for the agent running it, and a troubleshooting table |
| [concepts.md](skills/think-slow-act-fast/concepts.md) | The three layers, why it works, the arithmetic, where it fits and where it doesn't |
| [lessons.md](skills/think-slow-act-fast/lessons.md) | What we learned: the fast loop, the slow loop, and making it visible to an audience |
| [reference.md](skills/think-slow-act-fast/reference.md) | Interfaces, a real question and answer, the scheduler, the plan schema, the report, the metrics |

## Use it

Copy `skills/think-slow-act-fast/` into your agent's skills folder (for GitHub Copilot CLI,
`~/.copilot/skills/`) and ask: *"Help me design a think-slow-act-fast system for ..."*. The skill tells the agent
to check the fit with numbers first, build a rule baseline, and ask before creating anything in the cloud. You
can also just read it.

The pattern is model-neutral: use any decision model and any LLM that meet your latency, quality and price.
Numbers were measured in October 2026.

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
