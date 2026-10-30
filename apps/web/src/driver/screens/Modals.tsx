import type { Facility, ParkingSpace } from '@parkright/contracts';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { DemoInfo, Health, Scenario } from '../net/api.ts';
import { ago } from '../lib/time.ts';
import { detectorKind, type DetectorKind } from '../lib/names.ts';
import { DemoMark } from '../ui/bits.tsx';
import { Close, Search as SearchIcon } from '../ui/icons.tsx';

export function Modal({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
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
        <p className="body">Cameras watch each space. A detector decides whether it's open, occupied or unclear. Only a space seen open in the last few seconds is shown as open.</p>
        <div className="list">
          <div className="li"><span className="t"><b><span className="live">Live</span></b><small>Straight from the garage's cameras, updated as each frame is processed.</small></span></div>
          <div className="li" data-testid="about-simulated"><span className="t"><b className="simw">Simulated garage</b><small>A virtual garage and cameras built for this demo. {SOURCE_LINE[detector]}</small></span></div>
          <div className="li"><span className="t"><b><DemoMark /></b><small>Example data: class schedule, other garages and the route. Never shown as availability.</small></span></div>
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

export function SearchSheet({ open, onClose, scenario, onPick }: { open: boolean; onClose: () => void; scenario: Scenario | null | undefined; onPick: (d: string) => void }) {
  const [q, setQ] = useState('');
  const options = scenario ? [{ short: scenario.next_class.destination_short, full: scenario.next_class.destination, line: `${scenario.next_class.course} · ${scenario.next_class.time}` }] : [];
  const shown = options.filter((o) => !q || `${o.short} ${o.full}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} label="Where to?">
      <div style={{ display: 'grid', gap: 16 }} data-testid="search-sheet">
        <h2 className="hl" style={{ fontSize: 34 }}>Where to?</h2>
        <label className="field"><SearchIcon width={20} height={20} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Campus building" aria-label="Campus building" autoFocus /></label>
        {shown.length > 0 && (
          <div className="list">
            {shown.map((o) => (
              <button key={o.short} type="button" className="li press" onClick={() => { onPick(o.short); onClose(); }}>
                <span className="t"><b>{o.full}</b><small>{o.line}</small></span>
                <span style={{ fontSize: 12.5 }}><DemoMark /></span>
              </button>
            ))}
          </div>
        )}
        <p className="body" style={{ fontSize: 13.5 }}>Building search isn't connected yet{scenario ? '; this demo includes one destination' : ''}. The garage Meridian watches is shown either way.</p>
      </div>
    </Modal>
  );
}
