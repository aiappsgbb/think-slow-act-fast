import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('warehouse configuration', () => {
  it.each(['jev', 'laya', 'mistyped'])('rejects unsupported decision provider %s rather than silently running rules', (provider) => {
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/warehouse/run.ts'], {
      encoding: 'utf8', env: { ...process.env, DECISION_MODEL: provider, PLANNER: 'off', DURATION: '0.1' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Unsupported DECISION_MODEL');
  });
  it('requires explicit Foundry decision deployment configuration', () => {
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/warehouse/run.ts'], {
      encoding: 'utf8',
      env: { ...process.env, DECISION_MODEL: 'microsoft', DECISION_ENDPOINT: '', DECISION_DEPLOYMENT: '', PLANNER: 'off', DURATION: '0.1' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('DECISION_ENDPOINT and DECISION_DEPLOYMENT');
  });
});
