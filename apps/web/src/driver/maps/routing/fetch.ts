import { RoutingError } from './types.ts';

/** Fetches JSON, turning each way a directions request can fail into one RoutingError. */
export async function fetchRouteJson(url: string, signal?: AbortSignal): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new RoutingError('aborted', 'aborted');
    throw new RoutingError('network', String(e));
  }
  if (res.status === 429) throw new RoutingError('rate-limit', '429');
  if (res.status === 401 || res.status === 403) throw new RoutingError('auth', String(res.status));
  let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = await res.json();
  } catch {
    throw new RoutingError(res.ok ? 'bad-response' : 'network', `status ${res.status}`);
  }
  return { ok: res.ok, status: res.status, body };
}
