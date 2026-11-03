/**
 * Shared public directions servers refuse bursts, and one journey can ask about many doors. This keeps the
 * app to a few requests at a time, spaced apart, reuses an answer it already has, and retries once after a dropped connection.
 * It only ever returns what the provider returned.
 */
import { RoutingError, type DirectionsProvider, type Route, type RouteRequest } from './types.ts';

const MAX_AT_ONCE = 3;
const CACHE_MS = 5 * 60_000;
const CACHE_SIZE = 80;
const RETRY_MS = 900;
const SPACING_MS = 250;

const keyOf = (r: RouteRequest) => [r.profile, r.from.lat.toFixed(5), r.from.lng.toFixed(5), r.to.lat.toFixed(5), r.to.lng.toFixed(5), !!r.alternatives].join();
const aborted = () => new RoutingError('aborted', 'aborted');

export function polite(inner: DirectionsProvider, opts: { maxAtOnce?: number; retryMs?: number; spacingMs?: number; now?: () => number } = {}): DirectionsProvider {
  const limit = opts.maxAtOnce ?? MAX_AT_ONCE, retryMs = opts.retryMs ?? RETRY_MS, spacing = opts.spacingMs ?? SPACING_MS, now = opts.now ?? Date.now;
  let nextStart = 0;
  const cache = new Map<string, { at: number; routes: Route[] }>();
  const waiting: (() => void)[] = [];
  let running = 0;
  const slot = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    if (running < limit) { running++; resolve(); return; }
    const go = () => { signal?.removeEventListener('abort', stop); running++; resolve(); };
    const stop = () => { const i = waiting.indexOf(go); if (i >= 0) waiting.splice(i, 1); reject(aborted()); };
    waiting.push(go);
    signal?.addEventListener('abort', stop, { once: true });
  });
  const free = () => { running--; waiting.shift()?.(); };
  const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(aborted()); }, { once: true });
  });

  return {
    ...inner,
    async route(req) {
      const key = keyOf(req);
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) return hit.routes;
      await slot(req.signal);
      try {
        // Requests start a little apart, however many are waiting.
        const at = Math.max(Date.now(), nextStart);
        nextStart = at + spacing;
        if (at > Date.now()) await wait(at - Date.now(), req.signal);
        let routes: Route[];
        try {
          routes = await inner.route(req);
        } catch (e) {
          if (!(e instanceof RoutingError) || (e.kind !== 'network' && e.kind !== 'rate-limit')) throw e;
          await wait(retryMs, req.signal);
          routes = await inner.route(req);
        }
        cache.set(key, { at: now(), routes });
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
        return routes;
      } finally {
        free();
      }
    },
  };
}
