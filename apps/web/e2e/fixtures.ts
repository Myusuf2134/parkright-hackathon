/** Scripted backend for the driver app: REST via page.route, realtime via page.routeWebSocket. */
import type { Page, WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
type State = 'OPEN' | 'OCCUPIED' | 'UNCERTAIN';
export type States = Record<string, State | 'STALE'>;

interface FixtureSpace { space_id: string; level_id: string; designation: string; plan: { x: number; y: number; w: number; h: number } }
interface FixtureFile { facility_id: string; name: string; is_simulated: boolean; levels: { level_id: string; name: string; ordinal: number }[]; spaces: FixtureSpace[]; cameras: { camera_id: string; level_id: string; name: string; kind: string }[] }

export const MVP: FixtureFile = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/fixtures/mvp-facility.json'), 'utf8'));
export const SCENARIO = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/fixtures/hackathon-demo.json'), 'utf8'));
export const OHIO: FixtureFile = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/calibration/ohio-union/facility.json'), 'utf8'));
export const OHIO_SITE = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/calibration/ohio-union/site.json'), 'utf8'));

/** A minimal /api/v1/demo/status: only the fields the driver app reads. */
export const demoStatus = (allowOpen: boolean, site: unknown = null) => ({ demo_mode: true, site, perception: { provider: 'scripted-test', allow_open: allowOpen } });

/** The approved v4 state. */
export const V4: States = { A1: 'OCCUPIED', A2: 'OPEN', A3: 'OCCUPIED', A4: 'OPEN', A5: 'UNCERTAIN', A6: 'OPEN', B1: 'OPEN', B2: 'OCCUPIED', B3: 'UNCERTAIN', B4: 'OPEN', B5: 'OPEN', B6: 'OPEN' };

/** ages: seconds since each space was last observed (default 0). */
export function spaces(states: States, designations: Record<string, string> = {}, fixture = MVP, ages: Record<string, number> = {}) {
  const t = Date.now();
  return fixture.spaces.map((s) => {
    const now = new Date(t - (ages[s.space_id] ?? 0) * 1000).toISOString();
    const st = states[s.space_id] ?? 'UNCERTAIN';
    // 'STALE' is deliberately adversarial: it claims OPEN but is flagged stale.
    const current = st === 'STALE' ? 'OPEN' : st;
    return {
      space_id: s.space_id, facility_id: fixture.facility_id, level_id: s.level_id, designation: designations[s.space_id] ?? s.designation, plan: s.plan,
      current_state: current, confidence: current === 'UNCERTAIN' ? null : 0.93, last_observed_at: now, source_camera_id: 'cam-01',
      stale: st === 'STALE', frame_seq: 1, model: { provider: 'scripted-test', version: '1' },
    };
  });
}

function counts(sp: ReturnType<typeof spaces>) {
  return { total: sp.length, open: sp.filter((s) => s.current_state === 'OPEN').length, occupied: sp.filter((s) => s.current_state === 'OCCUPIED').length, uncertain: sp.filter((s) => s.current_state === 'UNCERTAIN').length };
}

export function facility(sp: ReturnType<typeof spaces>, fixture = MVP) {
  return {
    facility_id: fixture.facility_id, name: fixture.name, address: null, location: null, is_simulated: fixture.is_simulated, updated_at: null,
    levels: fixture.levels.map((l) => ({ ...l, facility_id: fixture.facility_id })),
    cameras: fixture.cameras.map((c) => ({ ...c, facility_id: fixture.facility_id, online: true, last_frame_at: new Date().toISOString() })),
    counts: counts(sp),
  };
}

export class Backend {
  states: States;
  designations: Record<string, string> = {};
  sockets: WebSocketRoute[] = [];
  online = true;
  seq = 1;
  spaceOverride: Record<string, State> = {};
  ages: Record<string, number> = {};
  fixture: FixtureFile;

  constructor(private page: Page, states: States = V4, private opts: { scenario?: boolean; status?: unknown; fixture?: FixtureFile } = {}) {
    this.states = { ...states };
    this.fixture = opts.fixture ?? MVP;
  }

  private sp() { return spaces(this.states, this.designations, this.fixture, this.ages); }

  async install() {
    const p = this.page;
    await p.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const sp = this.sp();
      if (!this.online) return route.abort();
      if (path === '/api/v1/facilities') return route.fulfill({ json: [facility(sp, this.fixture)] });
      if (path === '/api/v1/demo/status') return this.opts.status ? route.fulfill({ json: this.opts.status }) : route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      if (path === '/api/v1/health') return route.fulfill({ json: { status: 'ok', perception: { provider: 'scripted-test', version: '1' } } });
      if (path === '/api/v1/demo/scenario') return this.opts.scenario ? route.fulfill({ json: SCENARIO }) : route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      const one = /\/facilities\/[^/]+\/spaces\/([^/]+)$/.exec(path);
      if (one) {
        const s = sp.find((x) => x.space_id === decodeURIComponent(one[1]))!;
        const o = this.spaceOverride[s.space_id];
        return route.fulfill({ json: o ? { ...s, current_state: o } : s });
      }
      if (path.endsWith('/recommendation')) {
        return route.fulfill({ json: { facts: {}, result: { facility_id: 'garage-01', recommendation: 'Scripted advice for tests.', uncertainties: [], expires_at: new Date(Date.now() + 60_000).toISOString(), provenance: { provider: 'nebius', model: 'nemotron', status: 'fallback', attempted: false, latency_ms: 1, fallback_reason: 'missing_api_key', provider_reported_model: null } } } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await p.routeWebSocket(/\/api\/v1\/realtime/, (ws) => {
      if (!this.online) { ws.close(); return; }
      this.sockets.push(ws);
      const sp = this.sp();
      ws.send(JSON.stringify({ type: 'facility_snapshot', facility: facility(sp, this.fixture), spaces: sp }));
    });
  }

  /** Push an occupancy_update carrying every space, as the real API does. */
  update(patch: States) {
    Object.assign(this.states, patch);
    const sp = this.sp();
    const msg = { type: 'occupancy_update', facility_id: 'garage-01', counts: counts(sp), spaces: sp, changes: [], frame: { camera_id: 'cam-01', session_id: 's', seq: ++this.seq, received_at: new Date().toISOString() }, published_at: new Date().toISOString() };
    for (const ws of this.sockets) ws.send(JSON.stringify(msg));
  }

  disconnect() {
    this.online = false;
    for (const ws of this.sockets.splice(0)) ws.close();
  }

  reconnect() { this.online = true; }
}

export const APP = '/app/?device=iphone15&splash=off';
