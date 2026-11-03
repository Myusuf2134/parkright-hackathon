/** Routed walking times from the nearest garages to the destination. A failed request leaves a garage without one. */
import { useEffect, useState } from 'react';
import type { LatLng } from '../campus/types.ts';
import type { DirectionsProvider } from '../routing/types.ts';
import { metres } from './geo.ts';

export type WalkTimes = Record<string, number>;
const NEAREST = 4;

export function useWalkTimes(provider: DirectionsProvider, destination: LatLng | null, garages: { id: string; at: (toward: LatLng) => LatLng; always?: boolean }[]): WalkTimes {
  const [times, setTimes] = useState<WalkTimes>({});
  const key = garages.map((g) => g.id).join();
  useEffect(() => {
    setTimes({});
    if (!destination) return;
    const ctl = new AbortController();
    // The nearest garages, and any garage Meridian has parking data for, wherever it is.
    const sorted = [...garages].sort((a, b) => metres(a.at(destination), destination) - metres(b.at(destination), destination));
    const near = sorted.filter((g, i) => i < NEAREST || g.always);
    for (const g of near) {
      provider.route({ profile: 'walking', from: g.at(destination), to: destination, signal: ctl.signal })
        .then((r) => { if (r[0] && !ctl.signal.aborted) setTimes((t) => ({ ...t, [g.id]: Math.max(1, Math.round(r[0].duration / 60)) })); })
        .catch(() => { /* no time for this garage */ });
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, destination?.lat, destination?.lng, key]);
  return times;
}
