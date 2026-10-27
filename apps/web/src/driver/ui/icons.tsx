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
