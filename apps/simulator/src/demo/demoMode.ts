/**
 * Hackathon demo mode for the Vision Lab, enabled by `?demo=1` in the URL.
 *
 *   - loads the fixed demo scene from the API's demo fixture (seed, preset, parked bays);
 *   - starts streaming cam-01 at the fixture's rate once the detector reports ready;
 *   - reloads the page when the API's demo epoch changes (`npm run demo:reset`),
 *     so every take starts from the same scene, session and sequence numbers.
 *
 * Without `?demo=1` nothing here runs and the Vision Lab behaves as before.
 */
import { decodeSpec, encodeSpec } from '../sim/spec.ts';
import type { FrameStreamer, StreamRate } from '../stream/streamer.ts';
import { STREAM_RATES } from '../stream/streamer.ts';

export interface DemoStatus {
  epoch: number;
  scenario_id: string;
  simulator: { hash: string; stream_fps: number };
}

export const isDemoMode = (search = location.search) => new URLSearchParams(search).get('demo') === '1';

/** True when the scene in `hash` is the demo fixture's scene (ignores parameter order and the camera pose default). */
export function isDemoScene(hash: string, fixtureHash: string): boolean {
  return encodeSpec(decodeSpec(hash)) === encodeSpec(decodeSpec(fixtureHash));
}

/** How demo mode checks and loads the fixture's scene. Default: the legacy lab's URL hash. */
export interface DemoScene {
  matches(fixtureHash: string): boolean;
  load(fixtureHash: string): void;
}

const hashScene: DemoScene = {
  matches: (fixtureHash) => isDemoScene(location.hash, fixtureHash),
  load: (fixtureHash) => {
    location.hash = fixtureHash; // App's hashchange handler loads it in a new session
  },
};

export function startDemoMode(streamer: FrameStreamer, apiBase = '', scene: DemoScene = hashScene): () => void {
  let epoch: number | null = null;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    const status = await fetch(`${apiBase}/api/v1/demo/status`, { signal: AbortSignal.timeout(2000) })
      .then((r) => (r.ok ? (r.json() as Promise<DemoStatus>) : null))
      .catch(() => null);
    if (status) {
      if (epoch === null) epoch = status.epoch;
      else if (status.epoch !== epoch) {
        location.reload();
        return;
      }
      if (!scene.matches(status.simulator.hash)) scene.load(status.simulator.hash);
      const ready = streamer.health?.inference?.inference_ready === true;
      const fps = (STREAM_RATES as readonly number[]).includes(status.simulator.stream_fps) ? (status.simulator.stream_fps as StreamRate) : 1;
      if (ready && streamer.rate === 0 && scene.matches(status.simulator.hash)) streamer.setRate(fps);
    }
    document.body.dataset.demo = status ? 'on' : 'unreachable';
  };

  void poll();
  const timer = setInterval(() => void poll(), 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
