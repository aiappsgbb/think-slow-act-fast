import { audioPlan, politeSpeechAt } from './core.mjs';

const $ = id => document.getElementById(id);
const caller = new Audio();
const acknowledgement = new Audio();
let data, mode = 'standard', started = 0, frame = 0, playing = false, acknowledgementStarted = false;
let currentSeconds = 0, duration = 0, plan = [], playbackVersion = 0;

function report(error) {
  stop();
  $('error').hidden = false;
  $('error').textContent = `Replay failed: ${error.message}. Reload the page and try again.`;
}

function stop() {
  playbackVersion++;
  playing = false;
  cancelAnimationFrame(frame);
  caller.pause();
  acknowledgement.pause();
  document.body.dataset.playing = 'false';
  $('stop').disabled = true;
}

function waveform(time) {
  const canvas = $('waveform'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  data.waveform.forEach((amplitude, index) => {
    ctx.fillStyle = index / data.waveform.length <= time / data.callerDuration ? '#0b1222' : '#cdd3df';
    const height = Math.max(3, amplitude * 85);
    ctx.fillRect(index * canvas.width / data.waveform.length, (canvas.height - height) / 2, 3, height);
  });
}

function paint(seconds) {
  currentSeconds = seconds;
  const branch = data[mode], ack = seconds >= branch.playbackAt;
  const qualified = mode === 'early' && seconds >= data.early.audioReadyAt;
  const endpoint = seconds >= data.endpointAt;
  const llmStarted = seconds >= data.standard.generationStartedAt;
  const callerEnd = Math.min(data.callerDuration, branch.playbackAt);
  const fullRecordingHeard = callerEnd === data.callerDuration;
  const transcript = data.transcripts.filter(event => event.at <= seconds &&
    (fullRecordingHeard || event.audioEndS <= callerEnd)).at(-1);
  $('clock').textContent = `00:${seconds.toFixed(1).padStart(4, '0')}`;
  const words = transcript?.text.split(/\s+/) || [];
  const excerpt = words.length > 28 ? `… ${words.slice(-28).join(' ')}` : transcript?.text;
  $('transcript').textContent = excerpt ? `“${excerpt}”` : 'The caller’s words appear here when the recording starts.';
  $('acknowledgement').hidden = !ack;
  $('speaker').textContent = ack ? `AI agent · ${data.voices.agent}` : seconds === 0 && !playing ? `Customer · ${data.voices.customer} · recording ready` : seconds < callerEnd ? `Customer · ${data.voices.customer} · speaking` : 'Waiting for the response';
  $('mode-title').textContent = mode === 'early' ? 'The early handoff path' : 'The usual turn-based path';
  $('listen-detail').textContent = mode === 'early' ? 'Microsoft Decision One checks the transcript as the words arrive.' : 'The assistant waits for the caller to finish.';
  $('route-title').textContent = mode === 'early' ? 'Prepare a permitted handoff' : 'Generate the final reply';
  const submitted = data.early.requests.filter(request => request.snapshotAt <= seconds);
  const latest = submitted.at(-1);
  $('route-detail').textContent = mode === 'early'
    ? qualified ? 'The current request meets the handoff conditions.'
      : latest && latest.receivedAt > seconds ? 'The latest transcript is being checked.'
      : 'The model checks whether a human handoff is appropriate.'
    : 'GPT-6 Luna runs after speech completes.';
  $('pause-step').hidden = mode !== 'early';
  const step = ack ? 'ack' : qualified ? 'pause' : mode === 'early' && latest ? 'route' : endpoint && mode === 'standard' ? 'route' : 'listen';
  for (const item of $('steps').children) {
    item.classList.toggle('active', item.dataset.step === step);
    item.classList.toggle('done', ack && item.dataset.step !== 'ack' ||
      qualified && ['listen', 'route'].includes(item.dataset.step) ||
      endpoint && mode === 'standard' && item.dataset.step === 'listen');
  }
  $('route-proof').hidden = !qualified;
  $('probabilities').textContent = `Human route ${(data.early.routeProbability * 100).toFixed(1)}% · Eligibility yes ${(data.early.eligibilityProbability * 100).toFixed(1)}%`;
  $('generation').textContent = mode === 'early'
    ? qualified ? 'The assistant skips the final LLM call.' : 'The final LLM call has not started.'
    : llmStarted ? 'The assistant has started the final LLM call.'
      : endpoint ? 'The assistant waits for final speech recognition.'
      : 'The assistant will call the LLM after the turn ends.';
  $('comparison').textContent = ack
    ? mode === 'early' ? `In this replay, the agent speaks ${data.politeLeadSeconds.toFixed(1)} seconds earlier.` : `The response is ready ${branch.audioReadyAt.toFixed(1)} seconds after the call audio starts.`
    : qualified ? `The handoff is prepared at ${data.early.audioReadyAt.toFixed(1)} seconds. The agent waits for a pause.`
    : mode === 'early' ? 'The assistant can prepare the handoff before speaking.' : 'The usual path waits for the caller to finish.';
  waveform(Math.min(seconds, callerEnd));
}

function tick() {
  if (!playing) return;
  const seconds = (performance.now() - started) / 1000;
  paint(Math.min(seconds, duration));
  if (!acknowledgementStarted && seconds >= data[mode].playbackAt) {
    caller.pause();
    acknowledgementStarted = true;
    acknowledgement.currentTime = 0;
    const version = playbackVersion;
    acknowledgement.play().catch(error => { if (version === playbackVersion) report(error); });
  }
  if (seconds >= duration) {
    stop();
    $('speaker').textContent = 'Handoff requested (simulated)';
    $('status').textContent = 'Replay complete. No real call was transferred.';
    return;
  }
  frame = requestAnimationFrame(tick);
}

async function play(nextMode) {
  if (!data) throw new Error('Recording data has not loaded');
  stop();
  const version = playbackVersion;
  document.body.classList.remove('summary');
  $('evidence').hidden = true;
  mode = nextMode;
  plan = audioPlan({
    callerDuration: data.callerDuration,
    acknowledgementAt: data[mode].playbackAt,
    acknowledgementDuration: data.acknowledgementDuration,
  });
  duration = plan.at(-1).end;
  acknowledgementStarted = false;
  caller.currentTime = 0;
  $('error').hidden = true;
  $('play-standard').classList.toggle('selected', mode === 'standard');
  $('play-early').classList.toggle('selected', mode === 'early');
  $('stop').disabled = false;
  $('status').textContent = 'Replaying recorded events at original speed.';
  paint(0);
  try { await caller.play(); }
  catch (error) { if (version === playbackVersion) throw error; return; }
  if (version !== playbackVersion) return;
  started = performance.now();
  playing = true;
  document.body.dataset.playing = 'true';
  tick();
}

function summary() {
  stop();
  document.body.classList.add('summary');
  $('evidence').hidden = false;
}

$('play-standard').addEventListener('click', () => play('standard').catch(report));
$('play-early').addEventListener('click', () => play('early').catch(report));
$('stop').addEventListener('click', () => { stop(); $('status').textContent = 'Playback stopped. Choose a version to restart.'; });
$('results').addEventListener('click', summary);
$('back').addEventListener('click', () => {
  document.body.classList.remove('summary');
  $('evidence').hidden = true;
  paint(0);
});
for (const audio of [caller, acknowledgement]) {
  audio.addEventListener('error', () => report(new Error(`Could not load ${audio === caller ? 'caller' : 'acknowledgement'} audio`)));
}

try {
  const response = await fetch('recording.json');
  if (!response.ok) throw new Error(`Recording data returned HTTP ${response.status}`);
  data = await response.json();
  data.standard.playbackAt = data.standard.audioReadyAt;
  data.early.playbackAt = politeSpeechAt(data.quietWindows, data.early.audioReadyAt, data.callerDuration);
  data.politeLeadSeconds = data.standard.playbackAt - data.early.playbackAt;
  caller.src = data.customerFile;
  acknowledgement.src = data.agentFile;
  $('record-id').textContent = data.case;
  $('acknowledgement').firstChild.textContent = `“${data.acknowledgementText}”`;
  $('control-quote').textContent = `“${data.control.quote}”`;
  for (const id of ['play-standard', 'play-early', 'results']) $(id).disabled = false;
  $('status').textContent = 'Original-speed audio. Only one voice plays at a time.';
  paint(0);
  window.demo = {
    play, stop, summary,
    setMode(nextMode) { stop(); mode = nextMode; paint(0); },
    seek(seconds) { stop(); paint(seconds); },
    caption(text) { $('caption').textContent = text; },
    get data() { return data; },
    get seconds() { return currentSeconds; },
  };
} catch (error) { report(error); }
