import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Foundry reference retrieval scenario', () => {
  const docs = readFileSync(new URL('../../skills/think-slow-act-fast/decision-model.md', import.meta.url), 'utf8');
  it('teaches the exact Foundry route', () => expect(docs).toContain('/providers/microsoft/v1/systemone'));
  it('teaches the decision-model Entra token scope', () => expect(docs).toContain('https://cognitiveservices.azure.com/.default'));
  it('puts the deployment name in the body model field', () => expect(docs).toContain('"model": "decision-1"'));
  it('distinguishes two groups at 3 requests/s from a 60RPM deployment', () => {
    expect(docs).toContain('360 RPM');
    expect(docs).toContain('60 RPM');
    expect(docs).toContain('2 seconds per group');
    expect(docs).toContain('fallback');
  });
});
