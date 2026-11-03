/** Whether guidance can start, and if not, the exact reason and what to do. */
import type { Fix } from './engine.ts';
import type { GeoStatus } from './useGeolocation.ts';
import { GPS_STALE_MS } from './constants.ts';

export type StartBlock = 'insecure' | 'unsupported' | 'denied' | 'off' | 'acquiring' | 'unavailable' | 'inaccurate' | 'stale' | 'manual' | 'no-route';
export type StartAction = 'request' | 'use-location' | null;

export interface StartGate { ok: boolean; code: StartBlock | null; title: string; detail: string; action: StartAction }

/** Beyond this, the app can't tell which road you're on. iPhones with Precise Location off report kilometres. */
export const MAX_START_ACCURACY = 100;
const OK: StartGate = { ok: true, code: null, title: '', detail: '', action: null };
const block = (code: StartBlock, title: string, detail: string, action: StartAction = null): StartGate => ({ ok: false, code, title, detail, action });

export function startGate(s: { status: GeoStatus; fix: Fix | null; manualName: string | null; hasRoute: boolean; now: number; isIOS?: boolean }): StartGate {
  const preview = s.manualName ? ` Preview from ${s.manualName} still works.` : '';
  if (!s.hasRoute) return block('no-route', 'No route to follow yet', 'Start becomes available once a route has loaded.');
  // A route from somewhere else can't be followed from here, whatever the GPS says.
  if (s.manualName && s.fix && s.status === 'on') return block('manual', `This route starts at ${s.manualName}`, 'Guidance follows where you are.', 'use-location');
  switch (s.status) {
    case 'insecure': return block('insecure', 'Opened without HTTPS', `Location needs HTTPS. Open the https:// address printed by npm run demo:student -- --lan.${preview}`);
    case 'unsupported': return block('unsupported', "This browser can't share location", `Try Safari or Chrome.${preview}`);
    case 'denied': return block('denied', 'Location is blocked for this site', `${s.isIOS ? 'On iPhone: Settings > Privacy & Security > Location Services > Safari Websites > While Using, then tap Try again.' : "Allow location for this site in your browser's settings, then tap Try again."}${preview}`, 'request');
    case 'off': return block('off', 'Location is off', `Turn it on to start guidance.${preview}`, 'request');
    case 'requesting': return block('acquiring', 'Finding your location…', `This can take a few seconds, longer indoors.${preview}`);
    case 'unavailable': return block('unavailable', "Can't find your location", `No GPS signal yet. Try near a window or outside.${preview}`, 'request');
    case 'on': break;
  }
  if (!s.fix) return block('acquiring', 'Finding your location…', 'This can take a few seconds, longer indoors.');
  if (s.now - s.fix.at > GPS_STALE_MS) return block('stale', 'Your location is out of date', 'No GPS update for a while. Waiting for a new one.', 'request');
  if (s.fix.accuracy > MAX_START_ACCURACY) {
    return block('inaccurate', `GPS is only accurate to ${Math.round(s.fix.accuracy)} m`, `Guidance needs ${MAX_START_ACCURACY} m or better.${s.isIOS ? ' Check that Precise Location is on for Safari Websites, and try outside.' : ' Try outside.'}`);
  }
  return OK;
}
