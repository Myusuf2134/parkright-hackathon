/**
 * Live facility state from the realtime socket. The client holds only what the
 * backend sent: a snapshot on connect, then full space lists on every update.
 * While disconnected, every space is shown UNCERTAIN — never the last known OPEN.
 */
import type { Facility, FacilitySnapshotMessage, OccupancyUpdateMessage, ParkingSpace } from '@parkright/contracts';
import { useEffect, useState } from 'react';

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface LiveFacility {
  connection: Connection;
  facility: Facility | null;
  spaces: ParkingSpace[];
  lastFrame: OccupancyUpdateMessage['frame'];
}

type Message = FacilitySnapshotMessage | OccupancyUpdateMessage;

const blind = (spaces: ParkingSpace[]): ParkingSpace[] =>
  spaces.map((s) => ({ ...s, current_state: 'UNCERTAIN', confidence: null }));

export function useLiveFacility(facilityId: string): LiveFacility {
  const [state, setState] = useState<LiveFacility>({ connection: 'connecting', facility: null, spaces: [], lastFrame: null });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/v1/realtime?facility_id=${encodeURIComponent(facilityId)}`);
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as Message;
        attempt = 0;
        if (msg.type === 'facility_snapshot') {
          setState({ connection: 'live', facility: msg.facility, spaces: msg.spaces, lastFrame: null });
        } else {
          setState((s) => ({
            ...s,
            connection: 'live',
            spaces: msg.spaces,
            facility: s.facility && { ...s.facility, counts: msg.counts },
            lastFrame: msg.frame ?? s.lastFrame,
          }));
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setState((s) => ({ ...s, connection: 'reconnecting', spaces: blind(s.spaces) }));
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

  return state;
}
