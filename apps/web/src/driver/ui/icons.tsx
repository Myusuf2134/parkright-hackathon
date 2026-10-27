/** Line icons, 24px grid, 2px stroke, round caps. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const Arrow = (p: P) => <svg {...base(p)} strokeWidth={2.3}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
export const Back = (p: P) => <svg {...base(p)} strokeWidth={2.2}><path d="M15 5l-7 7 7 7" /></svg>;
export const Close = (p: P) => <svg {...base(p)} strokeWidth={2.2}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>;
export const Locate = (p: P) => <svg {...base(p)}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="5.5" /></svg>;
export const Info = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" strokeWidth={2.2} /><circle cx="12" cy="7.8" r="1.2" fill="currentColor" stroke="none" /></svg>;
export const Person = (p: P) => <svg {...base(p)}><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20c1.4-3.6 4.2-5.2 7.5-5.2s6.1 1.6 7.5 5.2" /></svg>;
export const Car = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M4 15.5V12l2.2-4.6A2 2 0 0 1 8 6.3h8a2 2 0 0 1 1.8 1.1L20 12v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" /><path d="M4.5 12h15" /><circle cx="7.5" cy="16.5" r="1.4" fill="currentColor" /><circle cx="16.5" cy="16.5" r="1.4" fill="currentColor" /></svg>;
export const Access = (p: P) => <svg {...base(p)} stroke="#2f6fde"><circle cx="12" cy="4.6" r="1.8" fill="#2f6fde" stroke="none" /><path d="M8 9.2h8M12 9.2v4.8l3.4 5M12 14l-3.4 5" /></svg>;
export const Badge = (p: P) => <svg {...base(p)} strokeWidth={1.9}><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 10h8M8 14h5" /></svg>;
export const School = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z" /><path d="M7 11.5v4c1.5 1.5 3 2 5 2s3.5-.5 5-2v-4" /></svg>;
export const Bell = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" /><path d="M10 20.5h4" /></svg>;
export const Shield = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-2.5Z" /><path d="m9 12 2.2 2.2L15.5 10" stroke="#12a15a" /></svg>;
export const Bolt = (p: P) => <svg {...base(p)} stroke="none"><path d="M13 3 6 13.5h5L10 21l8-11.5h-5L13 3Z" fill="#12a15a" /></svg>;
export const TurnRight = (p: P) => <svg {...base(p)} strokeWidth={2.4}><path d="M8 19V11a3 3 0 0 1 3-3h8M15 4l4 4-4 4" /></svg>;
export const Search = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
export const Replay = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>;
export const Check = (p: P) => <svg {...base(p)} strokeWidth={2.4}><path d="m5.5 12.5 4 4 9-9.5" /></svg>;
export const Chevron = (p: P) => <svg {...base(p)} strokeWidth={2.2}><path d="m9 5 7 7-7 7" /></svg>;
export const Clock = (p: P) => <svg {...base(p)} strokeWidth={1.9}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const Lock = (p: P) => <svg {...base(p)} strokeWidth={1.9}><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
export const Phone = (p: P) => <svg {...base(p)} strokeWidth={1.9}><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></svg>;
export const Camera = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" /><circle cx="12" cy="12.5" r="3.5" /></svg>;
export const Spark = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M12 3.5 13.8 9l5.7 1.5-5.7 1.6L12 17.5l-1.8-5.4L4.5 10.5 10.2 9Z" /></svg>;
export const Plug = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-10 0Z" /><path d="M12 15v6" /></svg>;
const TrafficIcon = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M5 14.5V12l1.7-3.6A1.8 1.8 0 0 1 8.3 7.4h7.4a1.8 1.8 0 0 1 1.6 1L19 12v2.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" /><path d="M5.5 12h13M8 18.5v1M16 18.5v1" /></svg>;
const WeatherIcon = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M7.5 15.5h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.3 9.6 3 3 0 0 0 7.5 15.5Z" /><path d="M9 19h.01M12 20.5h.01M15 19h.01" strokeWidth={2.6} /></svg>;
const ConeIcon = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M10.3 4h3.4l4.3 14H6Z" /><path d="M4 20h16M8.2 13h7.6M9.4 9h5.2" /></svg>;
const AnnounceIcon = (p: P) => <svg {...base(p)} strokeWidth={1.9}><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M16.5 9a4 4 0 0 1 0 6" /></svg>;
const ParkIcon = (p: P) => <svg {...base(p)} strokeWidth={1.9}><rect x="4.5" y="4.5" width="15" height="15" rx="4" /><path d="M10 16V8h2.8a2.4 2.4 0 0 1 0 4.8H10" /></svg>;
export function AlertIcon({ kind, ...p }: P & { kind: 'traffic' | 'weather' | 'construction' | 'announcement' | 'parking' }) {
  const I = { traffic: TrafficIcon, weather: WeatherIcon, construction: ConeIcon, announcement: AnnounceIcon, parking: ParkIcon }[kind];
  return <I {...p} />;
}
