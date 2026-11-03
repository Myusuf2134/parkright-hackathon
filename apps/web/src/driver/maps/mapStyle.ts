/**
 * Which basemap to draw. The default needs no key (OpenFreeMap, OSM data). VITE_MAP_STYLE_LIGHT and
 * _DARK point at any MapLibre style URL; "blank" draws no basemap and makes no request (automated tests).
 */
import type { StyleSpecification } from 'maplibre-gl';

export type MapTheme = 'light' | 'dark';
export type ThemePref = MapTheme | 'auto';

const env = import.meta.env;
const URLS: Record<MapTheme, string> = {
  light: env.VITE_MAP_STYLE_LIGHT ?? 'https://tiles.openfreemap.org/styles/positron',
  dark: env.VITE_MAP_STYLE_DARK ?? env.VITE_MAP_STYLE_LIGHT ?? 'https://tiles.openfreemap.org/styles/dark',
};

const BLANK = (theme: MapTheme): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#14171a' : '#f3f3ef' } }] });

export const styleFor = (theme: MapTheme): string | StyleSpecification => (URLS[theme] === 'blank' ? BLANK(theme) : URLS[theme]);
export const usesBlankStyle = () => URLS.light === 'blank';
export const attributionText = 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors';

/** Meridian's colours on top of whichever OpenMapTiles-based style loaded. Layers it can't find are skipped. */
export const PALETTE: Record<MapTheme, { ground: string; water: string; park: string; building: string; buildingTop: string; route: string; routeCasing: string; alt: string; walk: string; casing: string; footprint: string }> = {
  light: { ground: '#f4f4f0', water: '#cfe0ee', park: '#dcebd9', building: '#e4e3dd', buildingTop: '#e9e8e2', route: '#12a15a', routeCasing: '#0a6b3b', alt: '#a3aba6', walk: '#1a5fb4', casing: '#ffffff', footprint: '#5b6770' },
  dark: { ground: '#14171a', water: '#0d2233', park: '#17261f', building: '#23272b', buildingTop: '#2a2f34', route: '#2fd07f', routeCasing: '#0d4a2c', alt: '#66716b', walk: '#7db8ff', casing: '#10253a', footprint: '#aab4bd' },
};

export const resolveTheme = (pref: ThemePref, systemDark: boolean): MapTheme => (pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref);
