function probabilities(answer, keys) {
  if (!answer || answer.type !== 'choice' || !keys.includes(answer.choice)) {
    throw new Error('Missing or invalid choice answer');
  }
  const values = answer.probabilities;
  if (!values || Object.keys(values).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('Probability keys do not match the offered options');
  }
  const scores = Object.values(values);
  if (scores.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) ||
      Math.abs(scores.reduce((sum, value) => sum + value, 0) - 1) > .015) {
    throw new Error('Invalid probability distribution');
  }
  if (values[answer.choice] !== Math.max(...scores)) throw new Error('Choice disagrees with its probabilities');
  return values;
}

export function evaluateHandoff(response) {
  const route = probabilities(response?.answers?.handoff, ['human', 'continue']);
  const eligibility = probabilities(response?.answers?.eligibility, ['yes', 'no', 'unclear']);
  return route.human >= .95 && route.human - route.continue >= .8 && eligibility.yes >= .95
    ? 'human' : null;
}

export class TurnGate {
  status = 'listening';

  claimFinalReply() {
    if (this.status !== 'listening') return false;
    this.status = 'generating';
    return true;
  }

  async handoff(response, startTransfer) {
    if (this.status !== 'listening' || evaluateHandoff(response) !== 'human') return false;
    this.status = 'committing';
    try {
      const receipt = await startTransfer();
      if (receipt?.accepted !== true || typeof receipt.requestId !== 'string' || !receipt.requestId) {
        throw new Error('Transfer was not accepted');
      }
      this.status = 'handed-off';
      return true;
    } catch (error) {
      this.status = 'listening';
      throw error;
    }
  }
}

export function audioPlan({ callerDuration, acknowledgementAt, acknowledgementDuration }) {
  if ([callerDuration, acknowledgementAt, acknowledgementDuration]
    .some(value => !Number.isFinite(value) || value < 0) || !callerDuration || !acknowledgementDuration) {
    throw new Error('Invalid audio timing');
  }
  const callerEnd = Math.min(callerDuration, acknowledgementAt);
  const segments = [];
  if (callerEnd > 0) segments.push({ kind: 'caller', start: 0, end: callerEnd });
  if (acknowledgementAt > callerEnd) segments.push({ kind: 'silence', start: callerEnd, end: acknowledgementAt });
  segments.push({ kind: 'acknowledgement', start: acknowledgementAt, end: acknowledgementAt + acknowledgementDuration });
  return segments;
}

export function politeSpeechAt(quietWindows, readyAt, callerDuration) {
  if (!Number.isFinite(readyAt) || readyAt < 0 || !Number.isFinite(callerDuration) || callerDuration <= 0) {
    throw new Error('Invalid speech-ready timing');
  }
  let previousEnd = 0;
  for (const { start, end } of quietWindows) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end < start || end > callerDuration) {
      throw new Error('Invalid quiet window');
    }
    previousEnd = end;
  }
  for (const { start, end } of quietWindows) {
    const at = Math.max(readyAt, start + .2);
    if (at <= end) return at;
  }
  return Math.max(readyAt, callerDuration + .2);
}
