import type { Facility, ParkingSpace } from '@parkright/contracts';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DemoInfo, Health } from '../net/api.ts';
import { matches, type Destination, type Ranked } from '../lib/directory.ts';
import type { Saved } from '../lib/saved.ts';
import { GarageSource } from './Garages.tsx';
import { ago } from '../lib/time.ts';
import { detectorKind, type DetectorKind } from '../lib/names.ts';
import { DemoMark } from '../ui/bits.tsx';
import { Close, Search as SearchIcon } from '../ui/icons.tsx';

export function Modal({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  // Esc closes, and focus returns to whatever opened the sheet.
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.section
            key="modal"
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', visualDuration: 0.42, bounce: 0.08 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose(); }}
          >
            <div style={{ padding: '10px 0 6px', display: 'grid', placeItems: 'center' }}><span className="grab" /></div>
            <div className="content">{children}</div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}

/** Says what actually produced the states, so a scripted run is never called real detection. */
const SOURCE_LINE: Record<DetectorKind, string> = {
  a2: 'Space states come from the NVIDIA A2 detector running on its camera frames; the garage itself isn\'t real.',
  scripted: 'Space states come from a scripted test source, not a detector.',
  none: 'No detector is connected, so every space shows as can\'t confirm.',
  other: 'Space states come from the detector named below; the garage itself isn\'t real.',
  unknown: 'The detector can\'t be identified right now.',
};

export function AboutData({ open, onClose, facility, spaces, health, demo, info, openDisabled, now }: {
  open: boolean; onClose: () => void; facility: Facility | null; spaces: ParkingSpace[]; health: Health | null; demo: boolean;
  info: DemoInfo | null; openDisabled: boolean; now: number;
}) {
  const model = spaces.find((s) => s.model)?.model ?? null;
  const detector = detectorKind(model?.provider ?? health?.perception.provider);
  return (
    <Modal open={open} onClose={onClose} label="How Meridian knows">
      <div style={{ display: 'grid', gap: 18 }} data-testid="about">
        <div className="row"><h2 className="title" style={{ fontSize: 28 }}>How Meridian knows</h2><button type="button" className="circ flat press" aria-label="Close" onClick={onClose}><Close /></button></div>
        {facility && !facility.is_simulated && !spaces.length && <p className="body" data-testid="about-physical">This garage's camera isn't connected to validated occupancy, so no availability is reported.</p>}
        <p className="body">Cameras watch each space. A detector decides whether it's open, occupied or unclear. Only a space seen open in the last few seconds is shown as open.</p>
        <div className="list">
          <div className="li"><span className="t"><b><span className="live">Live</span></b><small>Straight from the garage's cameras, updated as each frame is processed.</small></span></div>
          <div className="li" data-testid="about-simulated"><span className="t"><b className="simw">Simulated garage</b><small>A virtual garage and cameras built for this demo. {SOURCE_LINE[detector]}</small></span></div>
          <div className="li"><span className="t"><b><DemoMark /></b><small>Example data: class schedule, walking estimates and garages without cameras. Fixed numbers, never live availability.</small></span></div>
          <div className="li"><span className="t"><b>Can't confirm</b><small>No clear view, weak evidence or an old frame. Never offered as open.</small></span></div>
          {openDisabled && <div className="li" data-testid="about-open-disabled"><span className="t"><b>Occupied-only detection</b><small>We can detect occupied spaces, but can't yet confirm empty ones. Open-space confirmation isn't enabled in this demo yet.</small></span></div>}
        </div>
        {info?.site && (
          <div className="site-note" data-testid="about-site">
            <b>{info.site.title}</b>
            <span>{info.site.disclaimer}</span>
          </div>
        )}
        {facility && (
          <>
            <div className="sec">{facility.name}</div>
            <div className="list">
              {facility.cameras.map((c) => (
                <div key={c.camera_id} className="li"><span className="t"><b>{c.name}</b><small>{c.camera_id} · {c.kind} · {c.last_frame_at ? `last frame ${ago(now - Date.parse(c.last_frame_at))} ago` : 'no frames yet'}</small></span></div>
              ))}
              <div className="li"><span className="t"><b>Detector</b><small>{model ? `${model.provider} ${model.version}` : health?.perception.provider === 'none' ? 'Not connected · every space shows as can\'t confirm' : health ? `${health.perception.provider} ${health.perception.version}` : 'Unknown'}</small></span></div>
              <div className="li"><span className="t"><b>Location</b><small>{facility.location ? facility.address ?? 'Surveyed location' : 'No real location. The map is an illustration.'}</small></span></div>
            </div>
          </>
        )}
        {demo && <p className="body" style={{ fontSize: 13 }}>This server is running in demo mode.</p>}
      </div>
    </Modal>
  );
}

type Option =
  | { kind: 'destination'; key: string; name: string; short: string; line: string | null; demo: boolean }
  | { kind: 'garage'; key: string; r: Ranked }
  | { kind: 'free'; key: string; text: string };

/** Destinations and garages. Only what the app's data names, plus "use what I typed" with no distances. */
export function SearchSheet({ open, onClose, destinations, ranked, saved, onPickDestination, onPickGarage }: {
  open: boolean; onClose: () => void; destinations: Destination[]; ranked: Ranked[]; saved: Saved;
  onPickDestination: (d: string) => void; onPickGarage: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => { if (open) { setQ(''); setCursor(0); } }, [open]);
  const typed = q.trim();
  const dests: Option[] = destinations.filter((d) => typed || d.isClass || destinations.indexOf(d) < 7).filter((d) => matches(typed, d.name, d.short, d.terms)).map((d) => ({ kind: 'destination', key: `d:${d.short}`, name: d.name, short: d.short, line: d.line, demo: d.isClass }));
  const recents: Option[] = saved.recentDestinations
    .filter((d) => !destinations.some((k) => k.short === d) && matches(typed, d))
    .map((d) => ({ kind: 'destination', key: `r:${d}`, name: d, short: d, line: 'Recent', demo: false }));
  const garages: Option[] = ranked.filter((r) => matches(typed, r.entry.name, r.entry.standsInFor, r.entry.geo?.short, r.entry.geo?.terms) && (typed || r.tier < 2 || !!r.entry.facility)).map((r) => ({ kind: 'garage', key: `g:${r.entry.id}`, r }));
  const exact = [...dests, ...recents].some((o) => o.kind === 'destination' && (o.short.toLowerCase() === typed.toLowerCase() || o.name.toLowerCase() === typed.toLowerCase()));
  const free: Option[] = typed && !exact ? [{ kind: 'free', key: 'free', text: typed }] : [];
  const options = [...dests, ...recents, ...garages, ...free];
  const at = Math.min(cursor, Math.max(0, options.length - 1));

  const pick = (o: Option) => {
    if (o.kind === 'garage') onPickGarage(o.r.entry.id);
    else onPickDestination(o.kind === 'free' ? o.text : o.short);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((at + 1) % Math.max(1, options.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((at - 1 + options.length) % Math.max(1, options.length)); }
    else if (e.key === 'Enter' && options[at]) { e.preventDefault(); pick(options[at]); }
  };
  const row = (o: Option) => {
    const i = options.indexOf(o);
    const common = { id: `opt-${i}`, role: 'option', 'aria-selected': i === at, className: `li press${i === at && typed ? ' cur' : ''}`, onClick: () => pick(o), onPointerEnter: () => setCursor(i), 'data-testid': 'search-option', type: 'button' as const };
    if (o.kind === 'garage') {
      return <button key={o.key} {...common} data-kind="garage"><span className="t"><b>{o.r.entry.name}</b><small>{o.r.reasons[0]}{o.r.entry.standsInFor ? ` · stand-in for ${o.r.entry.standsInFor}` : ''}</small></span><GarageSource source={o.r.entry.source} /></button>;
    }
    if (o.kind === 'free') {
      return <button key={o.key} {...common} data-kind="free"><span className="t"><b>Use “{o.text}”</b><small>Not in Meridian's campus directory, so it can't be routed</small></span></button>;
    }
    return <button key={o.key} {...common} data-kind="destination"><span className="t"><b>{o.name}</b>{o.line && <small>{o.line}</small>}</span>{o.demo && <span style={{ fontSize: 12.5 }}><DemoMark /></span>}</button>;
  };
  return (
    <Modal open={open} onClose={onClose} label="Where to?">
      <div style={{ display: 'grid', gap: 16 }} data-testid="search-sheet">
        <h2 className="hl" style={{ fontSize: 34 }}>Where to?</h2>
        <label className="field"><SearchIcon width={20} height={20} /><input value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} onKeyDown={onKey} placeholder="Building or garage on campus" aria-label="Search buildings and garages" role="combobox" aria-expanded={options.length > 0} aria-controls="search-results" aria-activedescendant={options.length ? `opt-${at}` : undefined} autoFocus data-testid="search-input" enterKeyHint="search" autoComplete="off" /></label>
        <div id="search-results" role="listbox" aria-label="Results" style={{ display: 'grid', gap: 12 }}>
          {[...dests, ...recents].length > 0 && <><div className="sec">Destinations</div><div className="list">{[...dests, ...recents].map(row)}</div></>}
          {garages.length > 0 && <><div className="sec">Garages</div><div className="list">{garages.map(row)}</div></>}
          {free.length > 0 && <div className="list">{free.map(row)}</div>}
        </div>
        <p className="body" style={{ fontSize: 13.5 }} data-testid="search-note">Meridian doesn't have a campus building directory yet{destinations.length ? `; this demo includes ${destinations.length === 1 ? 'one destination' : `${destinations.length} destinations`}` : ''}.</p>
      </div>
    </Modal>
  );
}
