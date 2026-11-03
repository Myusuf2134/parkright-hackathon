import { describe, expect, it } from 'vitest';
import type { Fix } from './engine.ts';
import { startGate } from './startGate.ts';

const now = 1_000_000;
const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 40, lng: -83, accuracy: 10, heading: null, speed: null, at: now - 1000, ...over });
const gate = (o: Partial<Parameters<typeof startGate>[0]>) => startGate({ status: 'on', fix: fix(), manualName: null, hasRoute: true, now, ...o });

describe('start gate', () => {
  it('opens on a fresh, accurate fix from your own location', () => expect(gate({}).ok).toBe(true));
  it('plain HTTP: names HTTPS and how to get it, keeps the manual preview', () => {
    const g = gate({ status: 'insecure', fix: null, manualName: 'Ohio Union' });
    expect(g).toMatchObject({ ok: false, code: 'insecure' });
    expect(g.detail).toContain('https://');
    expect(g.detail).toContain('Preview from Ohio Union still works');
  });
  it('denied: gives iPhone settings path and a retry', () => {
    const g = gate({ status: 'denied', fix: null, isIOS: true });
    expect(g).toMatchObject({ code: 'denied', action: 'request' });
    expect(g.detail).toContain('Safari Websites');
  });
  it('acquiring is visible and not an error', () => expect(gate({ status: 'requesting', fix: null })).toMatchObject({ code: 'acquiring', title: 'Finding your location…' }));
  it('a manual start with good GPS asks to switch', () => expect(gate({ manualName: 'RPAC' })).toMatchObject({ code: 'manual', action: 'use-location' }));
  it('refuses a coarse fix, with the number', () => {
    const g = gate({ fix: fix({ accuracy: 3000 }), isIOS: true });
    expect(g.code).toBe('inaccurate');
    expect(g.title).toContain('3000 m');
    expect(g.detail).toContain('Precise Location');
    expect(gate({ fix: fix({ accuracy: 100 }) }).ok).toBe(true);
  });
  it('refuses an old fix', () => expect(gate({ fix: fix({ at: now - 60_000 }) }).code).toBe('stale'));
  it('no route, no start', () => expect(gate({ hasRoute: false }).code).toBe('no-route'));
  it('other states', () => {
    expect(gate({ status: 'off', fix: null })).toMatchObject({ code: 'off', action: 'request' });
    expect(gate({ status: 'unavailable', fix: null })).toMatchObject({ code: 'unavailable', action: 'request' });
    expect(gate({ status: 'unsupported', fix: null }).code).toBe('unsupported');
    expect(gate({ status: 'on', fix: null }).code).toBe('acquiring');
  });
});
