# AI teammate for a human player

Lessons from **Come Bye** (<https://aka.ms/comebye>): a browser herding game. The player steers one sheepdog with
the pointer; Microsoft-Decision-1 picks the other dog's manoeuvre from five options (flank clockwise, flank
anticlockwise, lie down, drive from behind, cover a breakaway) about every 3 seconds; five sheep run on local
physics. One `decision-1` deployment at 60 RPM, one player at a time. This is the fast loop only; no planner.

## Choose the one character worth a model

1. **Give the model the character the player watches.** The first version asked the model about every sheep and
   both dogs. At 60 RPM that meant seconds between decisions per actor and sheep that felt frozen. Sheep moved to
   local flocking rules; only the companion uses the model.
2. **A human in the loop changes the job.** Two model-driven dogs with no human rarely penned the flock in live
   runs. As a teammate, the model only has to make useful supporting choices; the player supplies the rest.

## The executor decides how smart it looks

1. **Debug execution before the prompt.** Each time the companion looked dumb, the cause was usually code: "drive"
   chosen while the dog stood ahead of the flock pushed sheep backwards until the executor first circled behind;
   a doubled heading filter made a 90° turn take 1.57 s (0.16 s after the fix). Script the choices, watch the
   executor, fix it, and only then change instructions.
2. **Decisive execution reads as intelligence.** Faster flanks, quicker covers and shorter low-confidence
   hesitation changed how helpful the companion felt more than any wording change.
3. **Don't balance the world around the model.** We tuned the game until the model won every time: wider pen,
   calmer sheep, stickier flock. It became a slow procession and the player called it boring. Keep the game
   hard, improve the options and the executor, and record honest losses.

## State that prevents repetition

1. **Describe the human as facts.** Speed band, which side of the flock, how many sheep they are pressuring,
   whether they are steering. Never guess their intent.
2. **Commands are context with an age.** A whistle and mark from the player go into state as "come bye, mark
   north-east, 2 s ago (fresh)". Code does not force the choice. A followed command guides execution for six
   seconds, then normal support resumes; state says when it has expired.
3. **The model settles on one safe option.** In one winning run, 14 of 15 choices were "drive". Earlier builds
   repeated a flank that had already finished. Add factual readouts of the current action: how long it has run,
   progress since it started (metres toward the goal, sheep through the gate), seconds blocked, and whether the
   dog is in a useful working position. A same-choice refresh keeps the action clock; a new choice resets it.
   Readouts, never hints such as "you should now…".
4. **Obstacles in words.** "Pond east 8 m, gorse north-west 5 m (mud slows, rest solid)". Our longest state
   across 200 random maps was 732 characters, inside the 1,000 we allow.

## Make the help visible

Players could not tell the companion was helping until it was drawn: a dashed path to where it is going, a
pulsing ring on the sheep it is chasing, a small icon for its current manoeuvre and a bark when it commits to a new
one. A text bubble with the choice was noise. In the trailer, a tag shows each real choice the moment it lands.

## Measure against a scripted teammate

We did not, and it is the main gap. A scripted player with a scripted companion (always drive, or cover any
breakaway) won 55 of 60 random maps in engine tests. Without a seeded comparison on identical maps, claim
"choices made live by Microsoft-Decision-1", not "smarter than rules". Run the comparison offline; don't build an
on-screen mode for it.

## Honest footage

Real-time screen capture stutters and inference time varies. Pause the simulation while the model answers, log
each answer with the simulation step where it was applied, then replay deterministically and render every frame.
The video shows only real choices, at the moments they took effect. Label any scripted stand-in for the human.
