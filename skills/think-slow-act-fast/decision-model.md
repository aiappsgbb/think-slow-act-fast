# The decision model

The fast loop needs a model that, given a situation and a list of options, returns a probability for every option,
quickly, for many agents in one call. We build on the **System One** API because two interchangeable models speak it:

| | Laya | TypeSafe Jev |
| --- | --- | --- |
| Where | Your machine or container | Hosted API |
| Licence / access | Open source, Apache-2.0 (`NandhaKishorM/laya`, weights `convaiinnovations/laya`) | API key from TypeSafe |
| Endpoint | `http://127.0.0.1:8000/v1/systemone` (`laya-serve`) | `https://api.typesafe.ai/v1/systemone`, model `jev-latest` |
| Speed we measured | ~25–60 ms for 1–3 questions on an Apple-silicon GPU; 90–300 ms for a group of 6 robots | p50 ~235 ms, p95 ~285 ms for a team of 11 (about 2,700 input tokens) |
| Concurrency | One call at a time: `maxInFlight: 1` | `maxInFlight: 2` per group worked |
| Cost | Free | Per input token (about $0.23 of decisions for a 90-minute football match, ~21,000 decisions) |
| Best for | Development, demos, on-device, private data | Scale, no hardware, larger questions |

Both return the same shape, so switching is a base URL and a key. The starter's `SystemOneEngine` handles either.

## Set up

**Laya (local).** Python 3.10+:

```bash
python -m venv .venv && .venv/bin/python -m pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_MODELS=english .venv/bin/laya-serve      # listens on :8000; first start downloads weights
curl -s localhost:8000/v1/systemone -H 'content-type: application/json' -d '{
  "state": {"note": "billed twice"},
  "questions": {"team": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "refunds", "tech": "bugs"}}}}'
```

In Azure, run it as a sidecar container next to your app (the Laya repo documents a container image) and keep it
on localhost.

**Jev (hosted).** Put the key in the environment (Key Vault in Azure), never in code:

```bash
export TYPESAFE_API_KEY=...
DECISION_MODEL=jev npm start
```

## The contract

Request: one shared `state` and a map of questions. Ask every question about the same state in one call. (Values below
are illustrative; `model` is for Jev; leave it out for Laya.)

```json
{
  "state": { "goal": "ship every order before it is due", "plan": "priority throughput; stay in your own zone" },
  "questions": {
    "N3": {
      "type": "choice",
      "instructions": {
        "you": "robot N3, a fast picker with a small battery",
        "what_you_see": { "battery": "34%", "where": "north zone, 18 m from the pack station", "backlog": "9 open orders, 2 in your zone" },
        "instruction_from_the_plan": "Take south-zone orders when idle for the next minute",
        "question": "You are free. Following the plan, what do you do next?"
      },
      "criteria": {
        "pick_order_17": "pick order 17: 6 m away, 3 items, due in 22 s",
        "pick_order_21": "pick order 21: 19 m away, 1 item, due in 48 s, other zone",
        "go_charge": "go and charge: battery 34%, charger 30 m away, 1 robot charging",
        "wait": "wait here for a better order"
      }
    }
  },
  "model": "jev-latest"
}
```

Response:

```json
{ "answers": { "N3": { "type": "choice", "choice": "pick_order_17", "confidence": 0.41,
                       "probabilities": { "pick_order_17": 0.58, "pick_order_21": 0.17, "go_charge": 0.21, "wait": 0.04 } } },
  "usage": { "input_tokens": 412, "output_tokens": 0 } }
```

Question types: `choice` (one of a set; the one you'll use most), `noul` (probability a statement is true, for
guards like "is this agent stuck?") and `score` (position on an ordered rubric, e.g. urgency 0–3).

## Writing questions that work

1. **Identity.** Role and style in a few words. Different identities make different, believable choices.
2. **Seeing, in words.** Zones, distance bands, pressure, status. Not coordinates. "Below the charge level", not
   "battery 18 < 20".
3. **Options say why.** Each option text carries the facts that decide it: distance, due time, risk, side effects.
   Same facts as numbers in `facts` for the rule engine and logs.
4. **Filter in code.** Only valid options, only sensible ones, filtered by the current plan (the starter drops
   other-zone orders when the plan says `own_zone_only`). Rank and keep the best 3–8.
5. **Keep a stable key** per option (`pick_order_17`) that your executor understands. The scheduler rejects keys
   that weren't offered.
6. **Shuffle** option order every call (done in `SystemOneEngine`).
7. **Shared state is short**: the goal, the plan in words, the time. Not the whole world.
8. **Plan instructions are per agent**: the planner can single out up to two agents; their instruction goes only
   into their question.

## Limits to design around (Laya, checked)

- About **512 tokens per question including state**; longer state is cut from the end. Key facts first.
- About **190 tokens for instructions plus all option texts**; longer ones are shortened. Keep to ~15 short options;
  we use at most 8.
- **English** for the English checkpoint (`LAYA_MODELS=english`). A multilingual checkpoint exists.
- **No maths.** Comparing two numbers is a coin flip. Compare in code; say "closer than the other orders".
- **Soft probabilities.** Correct answers often score 0.5–0.8. Gate on the gap between the top two when you need
  certainty, and hand unclear cases to rules or the planner.

## Using the answer

- **Sample** from the probabilities for variety; take `choice` (argmax) when you need determinism.
- **Confidence** below ~0.5: hesitate briefly and visibly, or hand off.
- **Freshness**: the world moved while you waited. The scheduler drops answers that are out of order or no longer
  valid (`isFresh`); aim for under 10% stale.
- **Never trust the key blindly**: the scheduler only applies keys that were offered; your executor validates again.
