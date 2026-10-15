import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Lab } from '../lab.ts';
import type { BackendView } from '../stream/backendView.ts';
import type { FrameStreamer } from '../stream/streamer.ts';

export interface LabServices {
  lab: Lab;
  streamer: FrameStreamer;
  backend: BackendView;
}

export const LabContext = createContext<LabServices | null>(null);

export function useLab(): LabServices {
  const v = useContext(LabContext);
  if (!v) throw new Error('LabContext missing');
  return v;
}

interface Versioned {
  version: number;
  subscribe(fn: () => void): () => void;
}

/** Re-renders when `source` reports a change. */
export function useVersion(source: Versioned): number {
  return useSyncExternalStore(
    (fn) => source.subscribe(fn),
    () => source.version,
  );
}

/** Re-renders every `ms` for continuously changing readouts (sim time, ages). */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export const formatSimTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
};
