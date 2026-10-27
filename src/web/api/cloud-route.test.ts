import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Point MERCURY_HOME at a temp dir with a paired Cloud whose model is a reranker.
const home = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury-cloud-route-'));
  fs.writeFileSync(path.join(dir, 'mercury.yaml'), [
    'identity:',
    '  owner: Test',
    'cloud:',
    '  enabled: true',
    '  apiUrl: https://cloud.test',
    '  wsUrl: wss://cloud.test/ws',
    '  jwt: old.jwt.token',
    '  refreshToken: ""',
    '  agentId: agent-1',
    '  agentApiKey: ""',
    '  accessKey: sk-mc-access',
    '  tier: free',
    'providers:',
    '  default: mercuryCloud',
    '  mercuryCloud:',
    '    name: mercuryCloud',
    '    apiKey: sk-mc-access',
    '    baseUrl: https://cloud.test',
    '    model: nemotron-3.5-rerank-8b:free',
    '    enabled: true',
    '',
  ].join('\n'));
  process.env.MERCURY_HOME = dir;
  return dir;
});

import cloud, { setCloudTestHooks } from './cloud.js';

const models = (ids: string[]) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id, available: true })) }) } as unknown as Response);
const get = (path: string) => cloud.request(`http://127.0.0.1${path}`);
const post = (path: string) => cloud.request(`http://127.0.0.1${path}`, { method: 'POST' });
const yaml = () => readFileSync(join(home, 'mercury.yaml'), 'utf-8');

afterEach(() => vi.useRealTimers());

describe('Mercury Cloud status', () => {
  it('chat key works but the session is gone and the model is a reranker: asks to sign in', async () => {
    setCloudTestHooks({ fetch: models(['mercury-mini', 'claude-sonnet-4.6', 'nemotron-3.5-rerank-8b:free', 'text-embedding-3-small']) });
    const body = await (await get('/api/cloud/status?fresh=1')).json() as any;
    expect(body.paired).toBe(true);
    expect(body.chat.ok).toBe(true);
    expect(body.chat.models).toEqual(['mercury-mini', 'claude-sonnet-4.6']);
    expect(body.session).toBe('signed-out');
    expect(body.selfRecovers).toBe(false);
    expect(body.modelOk).toBe(false);
    expect(body.action).toBe('sign-in');
    expect(JSON.stringify(body)).not.toContain('sk-mc-access');
  });

  it('a rejected chat key reads as signed out, not as a crash', async () => {
    setCloudTestHooks({ fetch: vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response) });
    const body = await (await get('/api/cloud/status?fresh=1')).json() as any;
    expect(body.chat).toMatchObject({ ok: false });
    expect(body.chat.error).toMatch(/no longer accepts/);
    expect(body.action).toBe('sign-in');
  });

  it('an unreachable Cloud says so', async () => {
    setCloudTestHooks({ fetch: vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout')) });
    const body = await (await get('/api/cloud/status?fresh=1')).json() as any;
    expect(body.chat.error).toMatch(/10 seconds/);
  });
});

describe('Mercury Cloud sign-in from the app', () => {
  it('pairs in the browser, saves the new session with its recovery key, keeps a chat model, then restarts', async () => {
    vi.useFakeTimers();
    const restart = vi.fn().mockReturnValue(true);
    let approve!: (v: unknown) => void;
    setCloudTestHooks({
      start: vi.fn().mockResolvedValue({ code: 'ABCD-1234', pairingUrl: 'https://cloud.test/pair/ABCD-1234' }),
      poll: vi.fn().mockReturnValue(new Promise((r) => { approve = r; })) as never,
      restart,
    });
    const started = await (await post('/api/cloud/signin')).json() as any;
    expect(started).toMatchObject({ code: 'ABCD-1234', status: 'pending' });
    expect((await (await get('/api/cloud/signin')).json() as any).status).toBe('pending');

    approve({ jwt: 'new.jwt.token', refreshToken: 'rt-new', agentId: 'agent-1', tier: 'extended', apiKey: 'agent-key-1', accessKey: 'sk-mc-new' });
    await vi.waitFor(async () => expect((await (await get('/api/cloud/signin')).json() as any).status).toBe('done'));
    vi.advanceTimersByTime(400);
    expect(restart).toHaveBeenCalledOnce();

    const saved = yaml();
    expect(saved).toContain('rt-new');
    expect(saved).toContain('agentApiKey: agent-key-1');
    expect(saved).toContain('sk-mc-new');
    expect(saved).toContain('model: mercury-mini');
    expect(saved).not.toContain('rerank');
  });

  it('a refused pairing reports why, with the upgrade link when the plan is full', async () => {
    const { PairingFailureError } = await import('../../cloud/pairing.js');
    setCloudTestHooks({
      start: vi.fn().mockResolvedValue({ code: 'X', pairingUrl: 'https://cloud.test/pair/X' }),
      poll: vi.fn().mockRejectedValue(new PairingFailureError('Agent limit reached', { code: 'AGENT_LIMIT_REACHED', upgradeUrl: 'https://cloud.test/upgrade' })) as never,
    });
    await cloud.request('http://127.0.0.1/api/cloud/signin', { method: 'DELETE' });
    await post('/api/cloud/signin');
    await vi.waitFor(async () => expect((await (await get('/api/cloud/signin')).json() as any).status).toBe('failed'));
    const body = await (await get('/api/cloud/signin')).json() as any;
    expect(body.error).toMatch(/limit/);
    expect(body.upgradeUrl).toBe('https://cloud.test/upgrade');
  });
});
