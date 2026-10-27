/**
 * Live facility state for the driver app. Same rules as src/live.ts (which the legacy screens keep using):
 * a snapshot on connect, then whole-facility replacements; while disconnected every space is UNCERTAIN.
 * Added here: a null facility id, the time of the last message, and a silence guard — if the socket
 * says nothing for SILENCE_MS, the view goes blind too, because evidence that old is stale anyway.
 */
import type { Facility, FacilitySnapshotMessage, OccupancyUpdateMessage, ParkingSpace } from '@parkright/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useNow } from '../lib/time.ts';

export type Connection = 'idle' | 'connecting' | 'live' | 'reconnecting';
export const SILENCE_MS = 35_000; // longer than any facility's stale window (30 s at the Ohio site)

interface Raw {
  connection: Connection;
  facility: Facility | null;
  spaces: ParkingSpace[];
  lastFrame: OccupancyUpdateMessage['frame'];
  lastMessageAt: number | null;
  everLive: boolean;
  lastLiveAt: number | null;
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

const INITIAL: Raw = { connection: 'idle', facility: null, spaces: [], lastFrame: null, lastMessageAt: null, everLive: false, lastLiveAt: null };

export function useLiveFacility(facilityId: string | null): LiveView {
  const [raw, setRaw] = useState<Raw>(INITIAL);
  const now = useNow(1000);

  useEffect(() => {
    if (!facilityId) { setRaw(INITIAL); return; }
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempt = 0;
    setRaw({ ...INITIAL, connection: 'connecting' });

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/v1/realtime?facility_id=${encodeURIComponent(facilityId)}`);
      socket.onmessage = (event) => {
        let msg: Message;
        try { msg = JSON.parse(String(event.data)) as Message; } catch { return; }
        attempt = 0;
        const at = Date.now();
        if (msg.type === 'facility_snapshot') {
          setRaw((r) => ({ ...r, connection: 'live', facility: msg.facility, spaces: msg.spaces, lastMessageAt: at, everLive: true, lastLiveAt: at }));
        } else if (msg.type === 'occupancy_update') {
          setRaw((r) => ({
            ...r,
            connection: 'live',
            spaces: msg.spaces,
            facility: r.facility && { ...r.facility, counts: msg.counts },
            lastFrame: msg.frame ?? r.lastFrame,
            lastMessageAt: at,
            lastLiveAt: at,
          }));
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setRaw((r) => ({ ...r, connection: r.everLive ? 'reconnecting' : 'connecting', spaces: blind(r.spaces) }));
        retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [facilityId]);

  const silent = raw.connection === 'live' && raw.lastMessageAt !== null && now - raw.lastMessageAt > SILENCE_MS;
  const trusted = raw.connection === 'live' && !silent;
  const safeSpaces = useMemo(() => (trusted ? raw.spaces : blind(raw.spaces)), [trusted, raw.spaces]);
  return { ...raw, safeSpaces, trusted, silent };
}
