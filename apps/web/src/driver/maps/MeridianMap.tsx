/**
 * The real map. It stays mounted behind every screen, so opening a garage or starting a route never
 * reloads tiles. MapLibre is loaded on demand. Pins are DOM buttons, so they keep the keyboard and
 * screen-reader behaviour of the rest of the app.
 */
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LatLng } from './campus/types.ts';
import { PALETTE, styleFor, type MapTheme } from './mapStyle.ts';
import type { Fix } from './nav/engine.ts';

export interface MapPin {
  id: string;
  at: LatLng;
  node: ReactNode;
  /** Draws above other pins. */
  focused?: boolean;
  /** Draws above pins with nothing to offer. */
  priority?: boolean;
  /** bottom: the pin stands on its point. top: hangs below it, clear of pins standing there. */
  anchor?: 'bottom' | 'top' | 'left' | 'right' | 'center';
}

export interface RouteLine { id: string; coords: [number, number][]; role: 'selected' | 'alternative' | 'walk' }

export interface MapHandle {
  fit: (points: LatLng[], opts?: { maxZoom?: number; animate?: boolean }) => void;
  fly: (at: LatLng, zoom?: number) => void;
  follow: (at: LatLng, heading: number | null, profile: 'driving' | 'walking') => void;
  flat: () => void;
  north: () => void;
  togglePitch: () => void;
  setPadding: (p: { top?: number; bottom?: number; left?: number; right?: number }) => void;
}

export type MapLoad = 'loading' | 'ready' | 'failed';

const prefersReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

function paint(map: MlMap, theme: MapTheme) {
  const c = PALETTE[theme];
  const set = (id: string, prop: string, value: string) => { if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never); };
  set('background', 'background-color', c.ground);
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== 'fill') continue;
    if (/water/.test(l.id)) set(l.id, 'fill-color', c.water);
    else if (/park|wood|grass|landcover|landuse_(?:park|cemetery)/.test(l.id)) set(l.id, 'fill-color', c.park);
  }
}

function addLayers(map: MlMap, theme: MapTheme) {
  const c = PALETTE[theme];
  // 3D buildings when the map is tilted, if the style has a building layer to take them from.
  const first = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
  const src = Object.keys(map.getStyle().sources ?? {}).find((id) => (map.getStyle().sources[id] as { type: string }).type === 'vector');
  if (src && !map.getLayer('meridian-3d')) {
    map.addLayer({
      id: 'meridian-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 15,
      paint: { 'fill-extrusion-color': c.buildingTop, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.82 },
    }, first);
  }
  map.addSource('meridian-routes', { type: 'geojson', data: EMPTY });
  map.addSource('meridian-footprints', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'footprint-fill', type: 'fill', source: 'meridian-footprints', paint: { 'fill-color': c.footprint, 'fill-opacity': 0.22 } });
  map.addLayer({ id: 'footprint-line', type: 'line', source: 'meridian-footprints', paint: { 'line-color': c.footprint, 'line-width': 1.5, 'line-opacity': 0.75 } });
  const line = (id: string, role: string, color: string, width: number, extra: Record<string, unknown> = {}) => map.addLayer({
    id, type: 'line', source: 'meridian-routes', filter: ['==', ['get', 'role'], role],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, width * 0.6, 17, width * 1.4], ...extra },
  });
  // One hierarchy: alternatives recede, the chosen drive is solid and heaviest, the walk is dots along a pale path.
  line('route-alt-case', 'alternative', c.casing, 7);
  line('route-alt', 'alternative', c.alt, 4.5);
  line('route-walk-case', 'walk', c.casing, 7.5, { 'line-opacity': 0.95 });
  line('route-walk', 'walk', c.walk, 4.5, { 'line-dasharray': [0, 1.7] });
  line('route-case', 'selected', c.routeCasing, 9.5);
  line('route-main', 'selected', c.route, 6.5);
}

export const MeridianMap = forwardRef<MapHandle, {
  theme: MapTheme;
  center: LatLng;
  zoom: number;
  visible: boolean;
  dimmed: boolean;
  pins: MapPin[];
  routes: RouteLine[];
  /** Garage outlines to draw, [lng, lat] rings. They sit below every route. */
  footprints: [number, number][][];
  user: Fix | null;
  userHeading: number | null;
  onLoad: (s: MapLoad) => void;
  onGesture: () => void;
  onBearing: (deg: number) => void;
  onSelectRoute: (id: string) => void;
}>(function MeridianMap(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const userMarker = useRef<Marker | null>(null);
  const userEl = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0); // a new style drops our data, so it's set again
  const [, force] = useState(0);
  const latest = useRef(props);
  latest.current = props;

  // ---- create once
  useEffect(() => {
    let dead = false, map: MlMap | null = null;
    const loaded = { current: false };
    void import('maplibre-gl').then((ml) => {
      if (dead || !box.current) return;
      lib.current = ml;
      ml.setWorkerUrl(`${location.origin}/app/maplibre-worker.mjs?v=${ml.getVersion()}`); // see mapWorker in vite.config.ts
      try {
        map = new ml.Map({
          container: box.current, style: styleFor(latest.current.theme),
          center: [latest.current.center.lng, latest.current.center.lat], zoom: latest.current.zoom, minZoom: 3, maxZoom: 20, maxPitch: 70,
          attributionControl: false, fadeDuration: prefersReduced() ? 0 : 200,
        });
      } catch {
        latest.current.onLoad('failed'); // no WebGL, for example
        return;
      }
      mapRef.current = map;
      const m = map;
      const setPaletteAttr = () => box.current?.setAttribute('data-style', currentTheme.current);
      const onStyle = () => {
        if (!m.getSource('meridian-routes')) { paint(m, currentTheme.current); addLayers(m, currentTheme.current); }
        setPaletteAttr();
        if (!loaded.current) { loaded.current = true; latest.current.onLoad('ready'); }
        setReady(true);
        setStyleEpoch((n) => n + 1);
      };
      m.on('style.load', onStyle);
      // The basemap can fail after the page opened; only a map that never drew counts as failed.
      m.on('error', () => { if (!loaded.current && !m.isStyleLoaded()) latest.current.onLoad('failed'); });
      for (const ev of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'] as const) m.on(ev, (e: { originalEvent?: unknown }) => { if (e.originalEvent) latest.current.onGesture(); });
      m.on('rotate', () => latest.current.onBearing(m.getBearing()));
      for (const id of ['route-alt', 'route-alt-case']) {
        m.on('click', id, (e) => { const f = e.features?.[0]; if (f) latest.current.onSelectRoute(String(f.properties?.id)); });
      }
      force((n) => n + 1);
    }).catch(() => latest.current.onLoad('failed'));
    return () => { dead = true; map?.remove(); mapRef.current = null; markers.current.clear(); userMarker.current = null; };
  }, []);

  // ---- theme: a new style drops custom layers; style.load puts them back
  const currentTheme = useRef(props.theme);
  useEffect(() => {
    if (currentTheme.current === props.theme) return;
    currentTheme.current = props.theme;
    mapRef.current?.setStyle(styleFor(props.theme));
  }, [props.theme]);

  // ---- a hidden map doesn't redraw; catching up on size when it returns
  useEffect(() => { if (props.visible) mapRef.current?.resize(); }, [props.visible]);

  // ---- pins
  const pinIds = props.pins.map((p) => `${p.id}@${p.at.lat},${p.at.lng}`).join();
  useEffect(() => {
    const map = mapRef.current, ml = lib.current;
    if (!map || !ml) return;
    const wanted = new Set(props.pins.map((p) => p.id));
    for (const [id, m] of markers.current) if (!wanted.has(id)) { m.marker.remove(); markers.current.delete(id); }
    for (const p of props.pins) {
      const have = markers.current.get(p.id);
      if (have) { have.marker.setLngLat([p.at.lng, p.at.lat]); continue; }
      const el = document.createElement('div');
      el.className = 'mpin-host';
      const marker = new ml.Marker({ element: el, anchor: p.anchor ?? 'bottom' }).setLngLat([p.at.lng, p.at.lat]).addTo(map);
      markers.current.set(p.id, { marker, el });
    }
    force((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinIds, ready]);

  // ---- routes
  const routeKey = props.routes.map((r) => `${r.id}:${r.role}:${r.coords.length}:${r.coords[0]?.join()}`).join('|');
  useEffect(() => {
    if (import.meta.env.VITE_MAP_STYLE_LIGHT === 'blank') (window as unknown as { __meridianRoutes: RouteLine[] }).__meridianRoutes = props.routes; // what's drawn, for tests
    const src = mapRef.current?.getSource('meridian-routes') as GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: props.routes.map((r) => ({ type: 'Feature', properties: { id: r.id, role: r.role }, geometry: { type: 'LineString', coordinates: r.coords } })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, ready, styleEpoch]);

  const footKey = props.footprints.map((f) => f[0]?.join()).join('|');
  useEffect(() => {
    const src = mapRef.current?.getSource('meridian-footprints') as GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: props.footprints.map((f) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [f] } })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footKey, ready, styleEpoch]);

  // ---- the user's real position, with how sure the fix is
  useEffect(() => {
    const map = mapRef.current, ml = lib.current;
    if (!map || !ml) return;
    if (!props.user) { userMarker.current?.remove(); userMarker.current = null; return; }
    if (!userMarker.current) {
      const el = document.createElement('div');
      el.className = 'upin';
      el.dataset.testid = 'user-location';
      el.innerHTML = '<span class="upin-acc"></span><span class="upin-cone"></span><span class="upin-dot"></span>';
      userEl.current = el;
      userMarker.current = new ml.Marker({ element: el, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'map' }).setLngLat([props.user.lng, props.user.lat]).addTo(map);
    }
    userMarker.current.setLngLat([props.user.lng, props.user.lat]);
    const el = userEl.current!;
    const pxPerM = 156543.03 * Math.cos(props.user.lat * Math.PI / 180) / 2 ** map.getZoom();
    el.style.setProperty('--acc', `${Math.min(220, Math.max(26, (props.user.accuracy / pxPerM) * 2))}px`);
    el.dataset.heading = props.userHeading === null ? 'none' : 'yes';
    el.style.setProperty('--heading', `${props.userHeading ?? 0}deg`);
  }, [props.user, props.userHeading, ready]);

  // ---- camera
  useImperativeHandle(ref, () => ({
    fit(points, opts) {
      const map = mapRef.current, ml = lib.current;
      if (!map || !ml || !points.length) return;
      const b = new ml.LngLatBounds();
      for (const p of points) b.extend([p.lng, p.lat]);
      // Keep the padding within what's visible, however tall the sheet is.
      const pad = map.getPadding(), h = map.getContainer().clientHeight, w = map.getContainer().clientWidth;
      const room = Math.min(h - (pad.top ?? 0) - (pad.bottom ?? 0), w - (pad.left ?? 0) - (pad.right ?? 0));
      const edge = Math.max(0, Math.min(28, Math.floor(room / 4)));
      map.fitBounds(b, { padding: { top: edge, bottom: edge, left: edge + 16, right: edge + 40 }, maxZoom: opts?.maxZoom ?? 16.5, pitch: 0, bearing: 0, duration: prefersReduced() || opts?.animate === false ? 0 : 800 });
    },
    fly(at, zoom) {
      mapRef.current?.easeTo({ center: [at.lng, at.lat], zoom: zoom ?? Math.max(mapRef.current.getZoom(), 15.5), duration: prefersReduced() ? 0 : 700 });
    },
    follow(at, heading, profile) {
      mapRef.current?.easeTo({ center: [at.lng, at.lat], zoom: profile === 'driving' ? 16.5 : 17.5, pitch: profile === 'driving' ? 58 : 45, bearing: heading ?? mapRef.current.getBearing(), duration: prefersReduced() ? 0 : 900, easing: (t) => t });
    },
    flat() { mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: prefersReduced() ? 0 : 500 }); },
    north() { mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: prefersReduced() ? 0 : 400 }); },
    togglePitch() { const m = mapRef.current; m?.easeTo({ pitch: m.getPitch() > 5 ? 0 : 55, duration: prefersReduced() ? 0 : 500 }); },
    setPadding(p) { mapRef.current?.easeTo({ padding: { top: p.top ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0, right: p.right ?? 0 }, duration: 0 }); },
  }), []);

  return (
    <div className={`mstage${props.dimmed ? ' off' : ''}`} style={{ visibility: props.visible ? 'visible' : 'hidden' }} data-theme={props.theme} data-map-ready={ready ? 'yes' : 'no'} data-testid="map">
      <div ref={box} className="mcanvas" role="application" aria-label="Map of campus. Drag to pan, pinch to zoom, two fingers to rotate and tilt." />
      {props.pins.map((p) => {
        const host = markers.current.get(p.id)?.el;
        if (host) host.style.zIndex = p.focused ? '3' : p.priority ? '2' : '1';
        return host ? createPortal(p.node, host, p.id) : null;
      })}
    </div>
  );
});
