/** The browser's location, on request only. Never prompts on load; a permission already given is used. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fix } from './engine.ts';

export type GeoStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable' | 'insecure' | 'unsupported';

export interface Geo {
  status: GeoStatus;
  fix: Fix | null;
  request: () => void;
}

export function useGeolocation(): Geo {
  const [status, setStatus] = useState<GeoStatus>(() => (typeof navigator === 'undefined' || !navigator.geolocation ? 'unsupported' : !window.isSecureContext ? 'insecure' : 'off'));
  const [fix, setFix] = useState<Fix | null>(null);
  const watch = useRef<number | null>(null);

  const request = useCallback(() => {
    if (!navigator.geolocation) { setStatus('unsupported'); return; }
    if (!window.isSecureContext) { setStatus('insecure'); return; }
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    setStatus((s) => (s === 'on' ? s : 'requesting'));
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus('on');
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, at: p.timestamp });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          setFix(null);
          setStatus('denied');
          if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
          watch.current = null;
        } else {
          // A timeout or lost signal: keep the watch running, it may recover. An old fix is judged by its age.
          setStatus((s) => (s === 'on' ? s : 'unavailable'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    let live = true;
    void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((p) => {
      if (!live) return;
      if (p.state === 'granted') request();
      if (p.state === 'denied') setStatus('denied');
      p.onchange = () => { if (p.state === 'granted') request(); else if (p.state === 'denied') { setFix(null); setStatus('denied'); } };
    }).catch(() => { /* no Permissions API (older Safari): stays off until asked */ });
    return () => {
      live = false;
      if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    };
  }, [request]);

  return { status, fix, request };
}
