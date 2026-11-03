/**
 * Directions are handed to a real maps app. Meridian never draws routes or turn instructions of its
 * own, and no travel time is computed here.
 */
export type MapsApp = 'auto' | 'apple' | 'google';

export function resolveMapsApp(app: MapsApp, userAgent = navigator.userAgent): 'apple' | 'google' {
  if (app !== 'auto') return app;
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent) ? 'apple' : 'google';
}

export function directionsUrl(app: 'apple' | 'google', to: string, opts: { from?: string; mode?: 'driving' | 'walking' } = {}): string {
  const mode = opts.mode ?? 'driving';
  const q = new URLSearchParams();
  if (app === 'apple') {
    q.set('daddr', to);
    if (opts.from) q.set('saddr', opts.from);
    q.set('dirflg', mode === 'walking' ? 'w' : 'd');
    return `https://maps.apple.com/?${q}`;
  }
  q.set('api', '1');
  q.set('destination', to);
  if (opts.from) q.set('origin', opts.from);
  q.set('travelmode', mode);
  return `https://www.google.com/maps/dir/?${q}`;
}
