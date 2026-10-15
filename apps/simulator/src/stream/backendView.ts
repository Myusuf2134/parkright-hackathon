/**
 * What the backend currently tells drivers, from the same realtime socket the web app
 * uses. Read-only: the simulator never writes parking state.
 */
import type { FacilitySnapshotMessage, OccupancyUpdateMessage, ParkingSpace } from '@parkright/contracts';

type Listener = () => void;

export class BackendView {
  spaces: ParkingSpace[] = [];
  connected = false;
  version = 0;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private listeners = new Set<Listener>();

  constructor(private readonly facilityId: string) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  start(): void {
    this.closed = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/api/v1/realtime?facility_id=${encodeURIComponent(this.facilityId)}`);
    this.socket = socket;
    socket.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as FacilitySnapshotMessage | OccupancyUpdateMessage;
      this.spaces = msg.spaces;
      this.connected = true;
      this.changed();
    };
    socket.onclose = () => {
      this.connected = false;
      this.changed();
      if (!this.closed) this.retry = setTimeout(() => this.start(), 2000);
    };
  }

  stop(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }
}
