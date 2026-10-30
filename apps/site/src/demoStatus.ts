import { useSyncExternalStore } from 'react';
import { LINKS } from './config.ts';

/**
 * Whether the hosted demo (FastAPI + simulator + A2 behind a temporary tunnel) is reachable right now.
 * One shared probe of /api/v1/health drives the embed and every button that links to the demo, so the
 * page never claims a connection it has not just verified.
 */
export type DemoStatus =
  | { state: 'unconfigured' }
  | { state: 'checking' }
  | { state: 'offline'; checkedAt: number }
  | { state: 'live'; checkedAt: number; detectorReady: boolean; cpu: boolean };

const TIMEOUT_MS = 8000;
const RECHECK_MS = 45000;

const base = LINKS.demo ?? LINKS.app;
const healthUrl = base ? new URL('/api/v1/health', base).toString() : null;

let status: DemoStatus = healthUrl ? { state: 'checking' } : { state: 'unconfigured' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;

function set(next: DemoStatus) {
  status = next;
  listeners.forEach((l) => l());
}

type Health = { status?: string; inference?: { inference_ready?: boolean; identity?: string } };

export async function checkDemo(): Promise<void> {
  if (!healthUrl || inFlight) return;
  inFlight = true;
  clearTimeout(timer);
  const ctrl = new AbortController();
  const abort = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(healthUrl, { cache: 'no-store', signal: ctrl.signal });
    const body = (res.ok ? await res.json() : null) as Health | null;
    if (body?.status !== 'ok') throw new Error('unhealthy');
    set({
      state: 'live',
      checkedAt: Date.now(),
      detectorReady: body.inference?.inference_ready === true,
      cpu: /cpu/i.test(body.inference?.identity ?? ''),
    });
  } catch {
    set({ state: 'offline', checkedAt: Date.now() });
  } finally {
    clearTimeout(abort);
    inFlight = false;
    timer = setTimeout(() => { if (document.visibilityState === 'visible') void checkDemo(); else schedule(); }, RECHECK_MS);
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void checkDemo(), RECHECK_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1 && healthUrl && status.state === 'checking') void checkDemo();
  return () => listeners.delete(l);
}

export function useDemoStatus(): DemoStatus {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

export const getDemoStatus = (): DemoStatus => status;
