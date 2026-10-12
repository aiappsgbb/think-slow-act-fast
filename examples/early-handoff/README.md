# Early human handoff

The second demonstration of **think slow, act fast**. Hear one fictional password-reset call through
the normal turn-based path, then replay the same caller audio with an early Microsoft-Decision-1 decision.
The customer uses British **Sonia HD**, and the agent uses distinct British **Ryan HD**.
The agent says: "Excuse me, I'm sorry you've had to keep trying. Let me connect you to an adviser."
The model prepares the handoff immediately, but the agent waits for a short natural pause before speaking.
One voice plays at a time; the local caller replay yields the floor without cutting an audible word.

This is an **offline replay of recorded model observations**, not a live model endpoint, production
contact-centre integration or real adviser connection. It requires no credentials or new dependencies.
The teaching guide is [early-handoff.md](../../skills/think-slow-act-fast/early-handoff.md).

The [87-second narrated draft v2](narrated-draft-v2.mp4) explains the intent and policy confidence checks,
plays the original turn-based call, then stages an immediate courteous interruption using the same caller
audio and recorded qualifying Decision One response. The early reply starts at the recorded readiness time
of 7.81 seconds, before the original 9.4-second utterance ends, without waiting for silence. This is a new
presentation of recorded decisions, not a newly measured playback benchmark or a real transfer.
The narrator retains British Ollie HD, with Sonia HD for the customer and Ryan HD for the agent. Speech
stays at its original speed, and narration never overlaps the call. The closing shows the proposed
integration architecture and skill link. Human auditory review remains pending.

The [earlier 64-second draft](narrated-draft.mp4) remains available for reference.

The new D002 take preserves the original customer PCM and adds a separately voiced continuation after a
scripted 250 ms pause. Its real Foundry decision is accepted at 7.37 seconds; the controller enters after
observing quiet at 9.42 seconds, before the planned 16-second utterance ends. The caller yielding and transfer
are simulated. The live response passes the same tested `TurnGate`, which suppresses final generation.
`barge-recording.json`, `caller-barge.wav` and the focused [promo view](promo.html) preserve this demonstration.
This is not a new paired benchmark, and it does not change the existing 50-case results.

The original [42-second comparison](demo-draft.mp4) remains as a reference. In that D001 take the decision
is ready at 7.8 seconds, but there is no suitable earlier pause: the agent speaks at 9.6 seconds, after the
caller finishes, versus 12.9 seconds on the normal path. D001 illustrates early preparation, not an early
spoken interruption. The narrated cut identifies its baseline excerpt as an earlier recording.

## Run

From the repository root:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# Open http://localhost:8080/examples/early-handoff/
```

Click **Play turn-based version**, then **Play early handoff**. A new selection stops the previous source.
Both routed paths play the same approved acknowledgement. The early path suppresses the final LLM reply.
The visual transcript follows recorded ASR arrival events rather than fabricated typing.
Long updates show their latest 28 words so the acknowledgement stays visible. The full updates remain
in `recording.json`. **See measured results** opens the study summary and recorded no-transfer control.

```bash
node --test examples/early-handoff/core.test.mjs
```

The tested helper validates offered probability keys, finite values and normalization; requires route and
policy conditions; prevents duplicate transfers and the final-generation race; and surfaces rejected
transfers. `audioPlan` creates sequential caller/silence/acknowledgement segments for recording.
The browser replays an observed decision; it does not exercise a real transfer connector.

## What was captured

`recording.json` contains whitelisted timings, partial transcripts, actual decision checks, the qualifying
route/policy scores and a waveform extracted from `customer-hd.wav`. The conversational caller and
empathetic `agent-hd.wav` use separate Azure Speech Dragon HD voices.

D001 is a separately authored conversational demo, not one of the 50 regression cases or a typical-call
benchmark. Its paired capture records a first-PCM delivery marker; displayed seconds start there.
Caller audio contains only samples delivered before the actual endpoint, not later unspoken requests.

The baseline uses a real 700 ms silence endpoint, final Azure Speech recognition, then one GPT-6 Luna call
with reasoning disabled. Both routed branches use the same cached acknowledgement. Microsoft-Decision-1
checks partial speech with the route and eligibility questions in one request; qualified handoff suppresses
final generation. No artificial TTS penalty or extra wait was imposed on the baseline.

Decision/audio readiness and speaking time are deliberately separate. `politeSpeechAt` waits until at
least 200 ms of quiet has been observed at RMS <= 0.004, then lets the prerecorded customer yield the floor.
Without a suitable gap it waits for speech to end. This is a transparent local playback policy, not measured
adviser pickup or proof a production caller will stop talking. A real duplex system must keep listening,
stop agent audio if the caller speaks again, and honor corrections or cancellation before bridging.

`evidence.csv` contains the 50 observations from the earlier regression replay, not this extra capture.
Its run clocks include recognizer setup; do not align those seconds directly to the caller WAV.
`accepted_snapshot_to_ready_ms` exists only for committed early handoffs. The illustrative control uses
H014's actual recorded continue/no decision: an old complaint does not authorize a new transfer.

## Claims and limits

The 50 synthetic turns included 25 handoff cases and 25 controls. Both systems handled all 50 correctly;
21/25 handoffs committed early and none of these 25 controls falsely transferred. Accepted snapshot to
audio-ready was 281 ms median and 417 ms p95. The mean lead on requested-handoff cases was 6.64 seconds.

This is a same-recording regression replay with AI-authored/reviewed labels, not a production validation
or fresh holdout. Audio-ready is not actual loudspeaker playback or adviser pickup. The trigger snapshot
is model-qualified evidence, not independently annotated earliest actionable speech.

Continuous monitoring **cost more overall** in this mix: about $0.000076 additional estimated inference
per turn. CSV estimates use full input tokens at $0.042/million for Microsoft Decision and
$0.10/million input plus $0.50/million output for GPT-6 Luna; they assume no cache discount and exclude
speech, infrastructure, contracts and regional pricing. They are not verified Azure bills.

A broader 200-turn routing study had one false handoff caused by corrupted partial ASR and was not
more accurate or cheaper overall. See the guide for that adverse result and the boundaries of this pattern.
Replace the fictional policy, add a real permission/availability/idempotency-checked connector and evaluate
independently before using it with callers.
