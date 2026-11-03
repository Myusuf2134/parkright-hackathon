/**
 * Live facility state for the driver app. Same rules as src/live.ts (which the legacy screens keep using):
 * a snapshot on connect, then whole-facility replacements; while disconnected every space is UNCERTAIN.
 * Added here: several facilities at once, the time of the last message, and a silence guard — if the socket
 * says nothing for SILENCE_MS, the view goes blind too, because evidence that old is stale anyway.
 * The client–server clock offset is kept so per-space evidence ages (lib/evidence.ts) use the
 * server's observation times without trusting the two clocks to agree.
 */
import type { Facility, FacilitySnapshotMessage, OccupancyUpdateMessage, ParkingSpace } from '@parkright/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../lib/time.ts';

export type Connection = 'idle' | 'connecting' | 'live' | 'reconnecting';
export const SILENCE_MS = 35_000; // longer than any facility's stale window (30 s at the Ohio site)

interface Raw {
  connection: Connection;
  facility: Facility | null;
  spaces: ParkingSpace[];
  lastFrame: OccupancyUpdateMessage['frame'];
  lastMessageAt: number | null;
  /** When the newest camera evidence arrived (client clock); null if no frame has been seen. */
  lastFrameAt: number | null;
  everLive: boolean;
  lastLiveAt: number | null;
  /** Client clock minus server clock, from the last update's published_at (0 until one arrives). */
  clockOffsetMs: number;
}

export interface LiveView extends Raw {
  /** Spaces safe to render: the received ones while live and recent, otherwise all UNCERTAIN. */
  safeSpaces: ParkingSpace[];
  /** True when the data on screen can be treated as live. */
  trusted: boolean;
  silent: boolean;
}

type Message = FacilitySnapshotMessage | OccupancyUpdateMessage;

export const blind = (spaces: ParkingSpace[]): ParkingSpace[] =>
  spaces.map((s) => ({ ...s, current_state: 'UNCERTAIN', confidence: null }));

const INITIAL: Raw = { connection: 'idle', facility: null, spaces: [], lastFrame: null, lastMessageAt: null, lastFrameAt: null, everLive: false, lastLiveAt: null, clockOffsetMs: 0 };

/** One socket for one facility, with backoff; a phone returning from the background reconnects at once. */
function connectFacility(facilityId: string, set: (fn: (r: Raw) => Raw) => void): () => void {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let attempt = 0;
  let lastAt = Date.now();

  const connect = () => {
    clearTimeout(retry);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/v1/realtime?facility_id=${encodeURIComponent(facilityId)}`);
    socket = ws;
    ws.onmessage = (event) => {
      let msg: Message;
      try { msg = JSON.parse(String(event.data)) as Message; } catch { return; }
      attempt = 0;
      const at = Date.now();
      lastAt = at;
      if (msg.type === 'facility_snapshot') {
        // Evidence age on connect: the newest observation, measured on the server's clock.
        const newest = Math.max(0, ...msg.spaces.map((s) => (s.last_observed_at ? Date.parse(s.last_observed_at) : 0)));
        set((r) => ({ ...r, connection: 'live', facility: msg.facility, spaces: msg.spaces, lastMessageAt: at, lastFrameAt: newest || null, everLive: true, lastLiveAt: at }));
      } else if (msg.type === 'occupancy_update') {
        const published = Date.parse(msg.published_at);
        set((r) => ({
          ...r,
          connection: 'live',
          spaces: msg.spaces,
          facility: r.facility && { ...r.facility, counts: msg.counts },
          lastFrame: msg.frame ?? r.lastFrame,
          lastMessageAt: at,
          lastFrameAt: msg.frame ? at : r.lastFrameAt,
          lastLiveAt: at,
          clockOffsetMs: Number.isFinite(published) ? at - published : r.clockOffsetMs,
        }));
      }
    };
    ws.onclose = () => {
      if (closed || socket !== ws) return;
      socket = null;
      set((r) => ({ ...r, connection: r.everLive ? 'reconnecting' : 'connecting', spaces: blind(r.spaces) }));
      retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
    };
  };
  const wake = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (!socket) { attempt = 0; connect(); }
    // A socket frozen in the background can still look open; a silent one is replaced.
    else if (Date.now() - lastAt > SILENCE_MS) socket.close();
  };
  document.addEventListener('visibilitychange', wake);
  addEventListener('online', wake);
  set(() => ({ ...INITIAL, connection: 'connecting' }));
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    document.removeEventListener('visibilitychange', wake);
    removeEventListener('online', wake);
    socket?.close();
  };
}

function view(raw: Raw, now: number): LiveView {
  const silent = raw.connection === 'live' && raw.lastMessageAt !== null && now - raw.lastMessageAt > SILENCE_MS;
  const trusted = raw.connection === 'live' && !silent;
  return { ...raw, safeSpaces: trusted ? raw.spaces : blind(raw.spaces), trusted, silent };
}

export const IDLE_VIEW: LiveView = view(INITIAL, 0);

/** Live state for several facilities: the contract is one socket per facility. */
export function useLiveFleet(ids: string[]): Record<string, LiveView> {
  const [raws, setRaws] = useState<Record<string, Raw>>({});
  const now = useNow(1000);
  const key = ids.join('\n');

  useEffect(() => {
    const list = key ? key.split('\n') : [];
    const stops = list.map((id) => connectFacility(id, (fn) => setRaws((all) => ({ ...all, [id]: fn(all[id] ?? INITIAL) }))));
    return () => {
      for (const stop of stops) stop();
      setRaws({});
    };
  }, [key]);

  // Silence is judged at render, but a view object only changes when its data or trust does.
  const cache = useRef(new Map<string, { raw: Raw; view: LiveView }>());
  return useMemo(() => {
    const out: Record<string, LiveView> = {};
    for (const id of ids) {
      const raw = raws[id] ?? INITIAL;
      const prev = cache.current.get(id);
      const next = view(raw, now);
      out[id] = prev && prev.raw === raw && prev.view.trusted === next.trusted ? prev.view : next;
      cache.current.set(id, { raw, view: out[id] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, raws, now]);
}

export function useLiveFacility(facilityId: string | null): LiveView {
  const fleet = useLiveFleet(facilityId ? [facilityId] : []);
  return (facilityId && fleet[facilityId]) || IDLE_VIEW;
}
