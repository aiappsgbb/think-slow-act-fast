# Early human handoff from partial speech

Use this variant when a voice assistant can take a bounded, permitted action before the caller finishes.
The [second demo](../../examples/early-handoff/) replays a fictional password-reset call using recorded
Microsoft-Decision-1 and GPT-6 Luna observations. It needs no Azure credentials and makes no real transfer.

The goal is earlier useful action, not better prose. A permitted human handoff can use prepared audio and
skip the final language-model call entirely. Ordinary requests still follow the normal conversation path.
An LLM planner is useful in other applications of this skill, but is not required for every handoff.

## Add Decision One to an existing voice agent

Keep your existing audio connection, streaming transcript, conversation model, playback and transfer
connector. This guide adds a bounded decision path alongside them; it does not replace the voice stack.
Use the native request and authentication in [decision-model.md](decision-model.md), with the two
questions below in **one request**.

1. **On changed partial text**, admit a request through the shared deployment budget. Send the current
   transcript and policy facts, retaining its turn identity and revision. Allow bounded in-flight work;
   keep only the latest waiting snapshot rather than queueing every transcript update.
2. **When the response returns**, validate the offered choices and distributions. Confirm the turn is
   still active and its evidence remains compatible with the latest transcript. A correction or negation
   can invalidate an earlier positive answer; ordinary appended context is not automatically a new turn.
3. **If the score gate passes**, let existing application code check permission and destination availability,
   commit the transfer once, and play the approved acknowledgement. A courteous interruption can start
   during speech; waiting for a pause is optional playback policy, not a Decision One requirement.
4. **At turn end**, retain normal generation if no handoff committed. Coordinate an in-flight transfer
   with that endpoint event so a rejected transfer still gets a response and an accepted one cannot race
   a second reply. Decision errors and quota deferrals must not disable the normal conversation.

The reusable boundary is the native two-question request, response validation, score gate and turn
coordination. Adapt those to your agent's event handlers; you do not need the warehouse starter or a
second planner. The [small execution helper](../../examples/early-handoff/core.mjs) illustrates the gate
and atomic handoff in JavaScript; the REST contract is independent of that language.

## Respect the caller's speaking turn

An early decision does not require waiting for the end of the caller's turn. Prepare the allowed handoff
immediately and use an approved, context-appropriate acknowledgement. A courteous interruption is one
possible playback policy; entering at a short natural pause is another, not a model requirement.
The demo uses distinct British Sonia HD (customer) and Ryan HD (agent) voices. The agent says:
"Excuse me, I'm sorry you've had to keep trying. Let me connect you to an adviser."

Code separates response readiness from playback. The replay observes 200 ms of quiet before speaking;
if there is no suitable gap it waits rather than cutting a word. Report any resulting playback delay
separately from model latency. This pause policy changes presentation, not the 50-case regression results.
It does not make the two model questions independent or guarantee consent.

The [87-second narrated draft](../../examples/early-handoff/narrated-draft-v5.mp4) demonstrates the
immediate-interruption policy instead. It reuses D001's original caller audio and actual qualifying
decision, starting the approved acknowledgement at the recorded 7.81-second readiness point, before
the 9.4-second utterance ends. The caller yielding and transfer are simulated. This staged presentation
does not change the recorded observations, earlier measured playback times, or 50-case evaluation.

The earlier 64-second narrated draft uses a separate D002 scripted take with a continuation after a short pause.
Actual Foundry inference permits the handoff at 7.37 seconds; the controller enters at 9.42 seconds before
the planned 16-second utterance finishes. The customer's yielding and contact-centre transfer are simulated.
The earlier D001 baseline excerpt is identified separately, so the edit does not present the two different
takes as a newly measured paired timing comparison. The 50-case evaluation remains unchanged.

In a real duplex call, keep listening while the agent speaks. Yield or stop agent audio when the caller
speaks again and honor a correction or cancellation before bridging. Do not assume a real caller's
microphone can be muted just because the demonstration's prerecorded caller yields the floor.
Only promise a connection when the contact-centre service accepts it; adviser availability is a code
and connector responsibility, not something a model probability establishes.

## Make the policy explicit

This experiment allowed a handoff for either:

- An expressed current request to speak to a person.
- A clear refusal of further automated handling after repeated failures of the current issue, with a
  request for someone to take ownership.

Anger, profanity or the word "human" is not enough. A quoted, hypothetical, historical or negated request
does not authorize a present transfer. Neither does "human patience", humane wording or willingness to
continue with the assistant. This is the demo's fictional policy; replace it with an approved policy.

Start listening immediately. "Only activate when escalation is plausible" is circular unless another
component has already interpreted the speech. Continuous monitoring has a small but real cost on calls
that never escalate.

## Send two questions in one native request

Use the endpoint, Entra authentication and response validation in [decision-model.md](decision-model.md).
The body `model` is your deployment name. Do not expose tokens in a browser.

```json
{
  "model": "decision-1",
  "state": {
    "customer_transcript": "After three failed password resets I refuse another automated attempt and need someone to take ownership of this login problem",
    "partial": true,
    "permitted_destinations_available": true
  },
  "questions": {
    "handoff": {
      "type": "choice",
      "instructions": "Does the current caller express a human handoff request or clearly refuse further automated handling after repeated failures of the current issue while seeking ownership? Incomplete grammar alone is not a reason to wait once the routing evidence is sufficient. Do not guess unspoken intent.",
      "criteria": {
        "human": "A current request for a person, or the defined refusal of repeated failed automated handling while seeking ownership.",
        "continue": "No qualifying current intent, insufficient evidence, negation, history, quotation, hypothetical request or willingness to continue."
      }
    },
    "eligibility": {
      "type": "choice",
      "instructions": "Assess the policy condition rather than copying the other question. Is sufficient current intent or the defined refusal expressed now?",
      "criteria": {
        "yes": "The current words explicitly establish a request for a person or the defined qualifying refusal. Do not infer this from anger, history or the word human.",
        "no": "No qualifying current request or refusal is expressed.",
        "unclear": "Incomplete, contradictory or corrupted words do not establish present eligibility."
      }
    }
  }
}
```

This compact example teaches the request shape, not a drop-in reproduction of the evaluation prompts.
Validate a changed policy or prompt against your own held-out cases.
The two answers share one model and input. They are two conditions, **not independent votes**.

The measured revision accepted a handoff when `human >= 0.95`, `human - continue >= 0.8`, and
`eligibility.yes >= 0.95`. It did not wait for a second transcript update. Model probabilities are not a
calibrated promise of 95% production accuracy.

Here, `human` means `response.answers.handoff.probabilities.human`, `continue` means the other option
in that same distribution, and `eligibility.yes` means
`response.answers.eligibility.probabilities.yes`. These are **not** the answer's separate `confidence`
field. Do not substitute one for the other or count the two questions as independent confirmation.
The thresholds are application choices from this experiment, not Decision One defaults; validate them
against your own policy, false-handoff tolerance and speech conditions.

## Code owns the side effect

The example's tested [core.mjs](../../examples/early-handoff/core.mjs) validates the two distributions and
provides a small `TurnGate`. It prevents duplicate handoffs and end-of-turn generation racing a transfer.

```js
import { TurnGate } from './core.mjs';

const turn = new TurnGate(); // One instance per customer turn.
// Application integration: validate freshness and actual permission before calling this.
const accepted = await turn.handoff(response, async () => {
  // This connector must re-check permission, destination availability and idempotency.
  return contactCentre.requestTransfer({ turnId, destination: 'human', idempotencyKey: turnId });
});
if (accepted) await playApprovedAcknowledgement();

// At the real speech endpoint, not after an artificial benchmark delay:
if (turn.claimFinalReply()) await generateNormalReply();
```

`response`, `contactCentre`, playback and generation are application adapters, not services implemented
by the offline replay. A transfer receipt must contain `accepted: true` and a nonempty `requestId`.
Catch and log connector errors at the application boundary and tell the caller what failed. Never play
"I'm connecting you" if the transfer was refused. Restore an explicit fallback or retry path.
If the speech endpoint arrives while a transfer is pending, defer that event and revisit generation
after the receipt or failure; do not silently discard it when `claimFinalReply()` returns false.

On a committed handoff, stop decision checks, cancel queued normal generation and prevent the final
reply from starting. A decision arriving after generation has started must not claim it saved that call.
Keep reversible prewarming separate from an authorized transfer. Prepared audio means the acknowledgement
does not need a fresh generation or synthesis call; it does not mean a person has answered.

Use the latest compatible transcript snapshot and discard responses for ended turns. Do not apply old
evidence after a correction or negation. Test ASR revisions and race conditions, not just clean completed
sentences. Cache only approved messages that remain true when played.

## Pace requests without queueing old speech

The experiment admitted at most one request every 1.8 seconds on changed partial transcripts. A faster
native response does not change the deployment's RPM budget. Share that budget across calls, leave headroom
and allow only bounded in-flight work. Drop superseded snapshots instead of accumulating a queue.
Count quota deferrals, HTTP 429s, timeouts and malformed answers separately.

Do not let a decision outage break the normal conversation. Preserve the actual silence endpoint and
final speech recognition. If no handoff commits, make the normal final LLM call and synthesize its reply.
Compare with the same approved cached acknowledgement on both routed branches; do not artificially
charge only the baseline for TTS.

## What the experiments actually showed

| Evidence | Observation |
| --- | --- |
| Broad synthetic routing study, 200 turns | Early architecture 199/200 correct, baseline 200/200; one false human handoff; estimated inference spend 41.9% higher overall |
| Narrow escalation study, 50 turns | 25 handoff cases and 25 controls; both paths handled all 50 correctly |
| Same 50 recordings after the latency revision | 21/25 handoffs committed early; no false handoffs on these 25 controls |
| Accepted trigger snapshot to audio-ready, early handoffs | Median 281 ms; p95 417 ms |
| Requested-handoff cases, revised run | Mean acknowledgement lead 6.64 seconds over the end-of-turn baseline |
| Estimated additional inference spend, all 50 revised turns | About $0.000076 per turn, or $0.076 per 1,000 turns at this observed mix |

The revised 50-case run is a regression replay, not fresh holdout or production validation. The scripts
and voices are synthetic, authored and reviewed with AI. These samples do not establish a population
false-transfer rate or superiority across accents, languages and speech conditions.

The earlier false transfer involved ASR changing "human patience" into "human patients". The new gate
blocked that corrupted snippet in one separate diagnostic; that is not proof the failure class is solved.
Do not promise that this is cheaper or more accurate overall. The benefit demonstrated here is earlier
acknowledgement on a narrow permitted action.

Costs use measured tokens and list rates, not verified Azure billing. They exclude speech, infrastructure,
contract discounts and regional premiums. Current tenant pricing and call mix can change the result.
The broad 200-turn study and the narrow regression study used different policies and must not be pooled.

## Measure the right clock

Record first input-PCM delivery, partial transcript arrival, admission, response, policy commitment,
audio-ready, playback start, final-generation invocation, transfer receipt and actual adviser pickup.
Report them separately.

"Snapshot to audio-ready" starts at the transcript that passed the model gate, not the earliest word a
human annotator might consider actionable. Audio-ready is not physical playback or adviser connection.
Earlier evaluation run clocks included Speech SDK setup; the demo capture adds an explicit first-input
marker. The caller waveform plays at its original speed.

Use a paired baseline with real endpointing, the same utterance and cached response, and an economical
end-of-turn model configuration. Report false handoffs and controls alongside latency and the total cost
of continuous monitoring. Add independent human annotation before making production claims.

## Extend the pattern to routing

Replace the bounded destination options and eligibility conditions, not the code's authority. Technical
versus billing routing needs enough expressed intent and an allowed destination. Document prefetch can
start reversible work, but must preserve access checks. A callback needs consent and an available slot.
These are possible adaptations, **not workflows measured by this handoff study**.

Keep one plain-language policy, one atomic action boundary and one truthful fallback. Measure each new
workflow before claiming that speed, accuracy or cost improvements carry over.
