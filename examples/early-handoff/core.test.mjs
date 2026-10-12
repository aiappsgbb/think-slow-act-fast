import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHandoff, audioPlan, TurnGate, politeSpeechAt } from './core.mjs';

const response = {
  answers: {
    handoff: { type: 'choice', choice: 'human', probabilities: { human: .98, continue: .02 } },
    eligibility: { type: 'choice', choice: 'yes', probabilities: { yes: .97, no: .01, unclear: .02 } },
  },
};
test('one response must satisfy both conditions', () => {
  assert.equal(evaluateHandoff(response), 'human');
  const blocked = structuredClone(response);
  blocked.answers.eligibility.probabilities = { yes: .01, no: .97, unclear: .02 };
  blocked.answers.eligibility.choice = 'no';
  assert.equal(evaluateHandoff(blocked), null);
});
test('an uncertain route or policy condition does not authorize a handoff', () => {
  const uncertain = structuredClone(response);
  uncertain.answers.handoff.probabilities = { human: .94, continue: .06 };
  assert.equal(evaluateHandoff(uncertain), null);
  uncertain.answers.handoff.probabilities = { human: .98, continue: .02 };
  uncertain.answers.eligibility.probabilities = { yes: .94, no: .01, unclear: .05 };
  assert.equal(evaluateHandoff(uncertain), null);
});
test('malformed eligibility is an error rather than a fabricated decision', () => {
  const invalid = structuredClone(response);
  invalid.answers.eligibility.probabilities = { yes: 1 };
  assert.throws(() => evaluateHandoff(invalid));
});
test('invalid numbers and inconsistent choices are explicit errors', () => {
  for (const score of [NaN, Infinity, -1, 2]) {
    const invalid = structuredClone(response);
    invalid.answers.handoff.probabilities.human = score;
    assert.throws(() => evaluateHandoff(invalid));
  }
  const invalid = structuredClone(response);
  invalid.answers.handoff.choice = 'continue';
  assert.throws(() => evaluateHandoff(invalid));
});
test('a committed handoff suppresses final generation and duplicate transfers', async () => {
  const turn = new TurnGate();
  let transfers = 0;
  const transfer = async () => ({ accepted: true, requestId: `simulated-${++transfers}` });
  assert.equal(await turn.handoff(response, transfer), true);
  assert.equal(turn.claimFinalReply(), false);
  assert.equal(await turn.handoff(response, transfer), false);
  assert.equal(transfers, 1);
});
test('generation cannot race ahead while the transfer is being accepted', async () => {
  const turn = new TurnGate();
  let accept;
  const pending = turn.handoff(response, () => new Promise(resolve => { accept = resolve; }));
  assert.equal(turn.claimFinalReply(), false);
  accept({ accepted: true, requestId: 'simulated-1' });
  assert.equal(await pending, true);
});
test('a late decision does not interrupt an already started final reply', async () => {
  const turn = new TurnGate();
  assert.equal(turn.claimFinalReply(), true);
  assert.equal(await turn.handoff(response, () => { throw new Error('Must not be called'); }), false);
});
test('transfer failure is surfaced and leaves the normal response path available', async () => {
  const turn = new TurnGate();
  await assert.rejects(turn.handoff(response, async () => ({ accepted: false })), /not accepted/);
  assert.equal(turn.claimFinalReply(), true);
});
test('recording has only one voice at a time', () => {
  const plan = audioPlan({ callerDuration: 14, acknowledgementAt: 8, acknowledgementDuration: 3 });
  assert.deepEqual(plan, [
    { kind: 'caller', start: 0, end: 8 },
    { kind: 'acknowledgement', start: 8, end: 11 },
  ]);
});
test('invalid audio timings throw rather than producing a misleading replay', () => {
  assert.throws(() => audioPlan({ callerDuration: 14, acknowledgementAt: NaN, acknowledgementDuration: 3 }));
});
test('baseline silence is preserved rather than accelerating the recording', () => {
  assert.deepEqual(audioPlan({ callerDuration: 14, acknowledgementAt: 16, acknowledgementDuration: 3 }), [
    { kind: 'caller', start: 0, end: 14 },
    { kind: 'silence', start: 14, end: 16 },
    { kind: 'acknowledgement', start: 16, end: 19 },
  ]);
});
test('the decision can be ready before the agent waits for a natural pause', () => {
  assert.equal(politeSpeechAt([{ start: 9, end: 9.5 }], 8, 14), 9.2);
});
test('brief phonetic gaps do not authorize speech', () => {
  assert.equal(politeSpeechAt([{ start: 8.1, end: 8.15 }, { start: 10, end: 10.4 }], 8, 14), 10.2);
});
test('readiness during an established quiet window can speak without waiting for turn end', () => {
  assert.equal(politeSpeechAt([{ start: 9, end: 9.5 }], 9.3, 14), 9.3);
});
test('without a usable pause, the agent waits rather than cutting a word', () => {
  assert.equal(politeSpeechAt([], 8, 14), 14.2);
  assert.equal(politeSpeechAt([{ start: 1, end: 1.3 }], 16, 14), 16);
});
test('invalid pause measurements are explicit errors', () => {
  assert.throws(() => politeSpeechAt([{ start: 10, end: 9 }], 8, 14));
});
