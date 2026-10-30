import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEMO = 'https://example-tunnel.trycloudflare.com/present/';

async function load(health: () => Promise<Response>) {
  vi.resetModules();
  vi.stubEnv('VITE_PARKRIGHT_DEMO_URL', DEMO);
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => health());
  vi.stubGlobal('fetch', fetchMock);
  const mod = await import('./demoStatus.ts');
  return { ...mod, fetchMock };
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('demo status probe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('starts as checking and probes the tunnel health endpoint', async () => {
    const { getDemoStatus, checkDemo, fetchMock } = await load(() => json({ status: 'ok', inference: { inference_ready: true, identity: 'a2:torch-cpu' } }));
    expect(getDemoStatus()).toEqual({ state: 'checking' });
    await checkDemo();
    expect(fetchMock.mock.calls[0][0]).toBe('https://example-tunnel.trycloudflare.com/api/v1/health');
    expect(getDemoStatus()).toMatchObject({ state: 'live', detectorReady: true, cpu: true });
  });

  it('is offline when the tunnel is unreachable', async () => {
    const { getDemoStatus, checkDemo } = await load(() => Promise.reject(new TypeError('Failed to fetch')));
    await checkDemo();
    expect(getDemoStatus().state).toBe('offline');
  });

  it('is offline on an error status (e.g. Vite host check 403, Cloudflare 530)', async () => {
    const { getDemoStatus, checkDemo } = await load(() => Promise.resolve(new Response('Blocked request.', { status: 403 })));
    await checkDemo();
    expect(getDemoStatus().state).toBe('offline');
  });

  it('is offline when health answers but is not ok', async () => {
    const { getDemoStatus, checkDemo } = await load(() => json({ status: 'degraded' }));
    await checkDemo();
    expect(getDemoStatus().state).toBe('offline');
  });

  it('reports a detector that is still warming up', async () => {
    const { getDemoStatus, checkDemo } = await load(() => json({ status: 'ok', inference: { inference_ready: false } }));
    await checkDemo();
    expect(getDemoStatus()).toMatchObject({ state: 'live', detectorReady: false, cpu: false });
  });
});
