/**
 * How long the drive to a garage takes from here, from the directions provider. One request per garage and
 * rough position (about 100 m), kept for the session, so opening a place again doesn't ask the service again.
 */
import { useEffect, useState } from 'react';
import type { LatLng } from '../campus/types.ts';
import type { DirectionsProvider } from '../routing/types.ts';

export type DriveEstimate =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ok'; seconds: number; metres: number; trafficAware: boolean }
  | { state: 'failed' };

const cache = new Map<string, DriveEstimate>();

export function useDriveEstimate(provider: DirectionsProvider, from: LatLng | null, to: (LatLng & { id: string }) | null): DriveEstimate {
  const key = from && to ? `${to.id}@${from.lat.toFixed(3)},${from.lng.toFixed(3)}` : null;
  const [estimate, setEstimate] = useState<DriveEstimate>({ state: 'none' });
  useEffect(() => {
    if (!key || !from || !to) { setEstimate({ state: 'none' }); return; }
    const known = cache.get(key);
    if (known) { setEstimate(known); return; }
    const ctl = new AbortController();
    setEstimate({ state: 'loading' });
    provider.route({ profile: 'driving', from, to, signal: ctl.signal })
      .then((r) => {
        const e: DriveEstimate = r[0] ? { state: 'ok', seconds: r[0].duration, metres: r[0].distance, trafficAware: r[0].trafficAware } : { state: 'failed' };
        cache.set(key, e);
        setEstimate(e);
      })
      .catch(() => { if (!ctl.signal.aborted) setEstimate({ state: 'failed' }); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, provider]);
  return estimate;
}
