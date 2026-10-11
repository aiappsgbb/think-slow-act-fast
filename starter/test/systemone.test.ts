import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultAzureCredential } from '@azure/identity';
import { Rng } from '../src/core/rng.js';
import { SystemOneEngine } from '../src/core/systemone.js';
import type { Snapshot } from '../src/core/types.js';

const snapshot: Snapshot = {
  group: 'north', tick: 0, context: {},
  shared: { goal: 'ship orders', _private: 'not for the model' },
  agents: [{
    agentId: 'N1', identity: 'robot N1', seeing: {}, question: 'Next job?',
    options: [{ key: 'pick', text: 'pick order', facts: {} }, { key: 'wait', text: 'wait', facts: {} }],
  }],
};
const answer = () => ({
  model: 'microsoft-decision-1',
  answers: { N1: { type: 'choice', choice: 'pick', confidence: 0.8, probabilities: { pick: 0.8, wait: 0.2 } } },
  usage: { input_tokens: 100, output_tokens: 0 },
});
const engine = () => new SystemOneEngine({
  baseUrl: 'https://example.services.ai.azure.com/',
  model: 'decision-1',
  tokenProvider: async () => 'test-token',
  sample: false,
}, new Rng(1));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Microsoft Decision transport', () => {
  it('uses the Cognitive Services Entra scope by default', async () => {
    const getToken = vi.spyOn(DefaultAzureCredential.prototype, 'getToken').mockResolvedValue({ token: 'entra-token', expiresOnTimestamp: Date.now() + 60_000 });
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer())));
    vi.stubGlobal('fetch', transport);
    await new SystemOneEngine({ baseUrl: 'https://example.services.ai.azure.com', model: 'decision-1' }, new Rng(1)).decide(snapshot);
    expect(getToken).toHaveBeenCalledWith('https://cognitiveservices.azure.com/.default');
    expect((transport.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer entra-token' });
  });

  it('propagates authentication failures without sending a request', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const e = new SystemOneEngine({
      baseUrl: 'https://example.services.ai.azure.com', model: 'decision-1',
      tokenProvider: async () => { throw new Error('authentication failed'); },
    }, new Rng(1));
    await expect(e.decide(snapshot)).rejects.toThrow('authentication failed');
    expect(transport).not.toHaveBeenCalled();
  });

  it('uses the Foundry provider route, deployment name and Entra bearer token', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer())));
    vi.stubGlobal('fetch', transport);
    const e = engine();
    const r = await e.decide(snapshot);
    expect(transport.mock.calls[0][0]).toBe('https://example.services.ai.azure.com/providers/microsoft/v1/systemone');
    const request = transport.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({ authorization: 'Bearer test-token' });
    expect(JSON.parse(request.body as string)).toMatchObject({ model: 'decision-1', state: { goal: 'ship orders' } });
    expect(request.body).not.toContain('_private');
    expect(r.decisions[0].key).toBe('pick');
    expect(r.inputTokens).toBe(100);
    expect(e.name).toContain('Microsoft');
    expect(e.pricePerInputToken).toBe(0.042 / 1_000_000);
  });

  it('uses an api-key header when explicitly configured', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer())));
    vi.stubGlobal('fetch', transport);
    await new SystemOneEngine({ baseUrl: 'https://example.services.ai.azure.com', model: 'decision-1', apiKey: 'test-key' }, new Rng(1)).decide(snapshot);
    expect((transport.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'api-key': 'test-key' });
    expect((transport.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('authorization');
  });

  it.each([
    ['missing answer', (b: ReturnType<typeof answer>) => { b.answers = {} as typeof b.answers; }],
    ['unknown choice', (b: ReturnType<typeof answer>) => { b.answers.N1.choice = 'teleport'; }],
    ['wrong type', (b: ReturnType<typeof answer>) => { b.answers.N1.type = 'score'; }],
    ['bad confidence', (b: ReturnType<typeof answer>) => { b.answers.N1.confidence = 2; }],
    ['negative probability', (b: ReturnType<typeof answer>) => { b.answers.N1.probabilities.pick = -1; }],
    ['unnormalized distribution', (b: ReturnType<typeof answer>) => { b.answers.N1.probabilities.pick = 0.1; }],
    ['missing probability', (b: ReturnType<typeof answer>) => { delete (b.answers.N1.probabilities as Partial<typeof b.answers.N1.probabilities>).wait; }],
    ['extra probability', (b: ReturnType<typeof answer>) => { Object.assign(b.answers.N1.probabilities, { teleport: 0.2 }); }],
    ['bad usage', (b: ReturnType<typeof answer>) => { b.usage.input_tokens = -1; }],
  ])('rejects %s instead of manufacturing a model decision', async (_, corrupt) => {
    const b = answer();
    corrupt(b);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(b)));
    await expect(engine().decide(snapshot)).rejects.toThrow();
  });

  it('propagates HTTP throttling errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('quota exhausted', { status: 429 }));
    await expect(engine().decide(snapshot)).rejects.toThrow('429');
  });

  it('propagates network failures', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    await expect(engine().decide(snapshot)).rejects.toThrow('network down');
  });

  it('resolves only single-option agents locally without a network call', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const r = await engine().decide({ ...snapshot, agents: [{ ...snapshot.agents[0], options: [snapshot.agents[0].options[0]] }] });
    expect(transport).not.toHaveBeenCalled();
    expect(r.decisions[0].key).toBe('pick');
    expect(r.inputTokens).toBe(0);
  });
});
