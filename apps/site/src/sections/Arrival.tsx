/**
 * Arrival Intelligence, running the student app's own engine (apps/web/src/driver/arrival) on its own
 * demo scenarios. No live parking is passed in here, so parking time is the demo estimate.
 */
import { useMemo, useState } from 'react';
import { evaluate } from '../../../web/src/driver/arrival/engine.ts';
import { buildScenarios } from '../../../web/src/driver/arrival/scenarios.ts';
import { Reveal, SectionHead, Source } from '../ui/kit.tsx';

const ORDER = ['normal', 'traffic', 'weather', 'construction', 'canceled', 'moved', 'quiet'];
const KIND: Record<string, string> = { traffic: 'Traffic', weather: 'Weather', construction: 'Roadwork', announcement: 'Announcement', parking: 'Parking' };

export function Arrival() {
  const scenarios = useMemo(() => buildScenarios().filter((s) => ORDER.includes(s.id)).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)), []);
  const [id, setId] = useState('normal');
  const def = scenarios.find((s) => s.id === id) ?? scenarios[0]!;
  const r = useMemo(() => evaluate(def), [def]);
  const dep = r.departure;
  const total = dep.state === 'ok' ? dep.totalMinutes : 0;

  return (
    <section className="section arrival" id="arrival" aria-labelledby="arrival-title">
      <div className="wrap">
        <SectionHead id="arrival-title" eyebrow="Arrival Intelligence" title="Know when to leave. Not just where to park." lede="Every update is checked against your trip. What matters becomes one departure time." />
        <div className="arr">
          <div className="arr-picker" role="radiogroup" aria-label="Demo scenario">
            {scenarios.map((s) => (
              <button key={s.id} role="radio" aria-checked={s.id === id} onClick={() => setId(s.id)} data-testid={`scn-${s.id}`}>
                <b>{s.label}</b><span>{s.blurb}</span>
              </button>
            ))}
          </div>

          <Reveal className="arr-card" >
            <div className="arr-top">
              <div>
                <span className="eyebrow">Next class</span>
                <div className="arr-class"><b>{r.session.course}</b> · {r.session.startsAt}</div>
                <div className="arr-bldg">{r.movedTo ? <><s>{r.session.building}</s> → {r.movedTo.building}</> : r.session.building}</div>
              </div>
              <Source>Demo schedule</Source>
            </div>

            <div className="arr-leave" aria-live="polite" data-testid="arr-leave">
              <span className="eyebrow">Leave at</span>
              {/* Keyed on the value so each new estimate eases in; nothing animates with reduced motion. */}
              <span className="arr-swap" key={dep.state === 'ok' ? dep.leaveAt : dep.state}>
                {dep.state === 'ok' && <><b className="arr-time">{dep.leaveAt}</b><span className="arr-sub">Arrive by {dep.arriveBy} · {dep.spareMinutes} min to spare</span></>}
                {dep.state === 'not-needed' && <><b className="arr-time off">No trip needed</b><span className="arr-sub">Your class was canceled.</span></>}
                {dep.state === 'unavailable' && <><b className="arr-time off">Not available</b><span className="arr-sub">Missing {dep.missing.join(', ')}. Meridian won’t guess.</span></>}
              </span>
              <Source>Demo estimate</Source>
            </div>

            {dep.state === 'ok' && (
              <div className="arr-parts" aria-label="Departure breakdown">
                <div className="arr-bar">{dep.parts.map((p) => <i key={p.label} className={`p-${p.label.toLowerCase()}`} style={{ flexGrow: p.minutes }} />)}</div>
                <div className="arr-legend">{dep.parts.map((p) => <span key={p.label}><i className={`p-${p.label.toLowerCase()}`} />{p.label} {p.minutes} min</span>)}<span className="tot">{total} min total</span></div>
              </div>
            )}

            {r.note && <p className={`arr-note ${r.note.tone}`} data-testid="arr-note" key={r.note.text}>{r.note.text}</p>}

            <div className="arr-checks">
              <div>
                <span className="eyebrow">Shown to you</span>
                {r.shown.length ? r.shown.map((j) => <p key={j.signal.id} className="sig on"><i />{KIND[j.signal.kind]} · {j.signal.title}</p>) : <p className="sig none">Nothing affects this trip.</p>}
              </div>
              <div>
                <span className="eyebrow">Checked and filtered out</span>
                {r.filtered.length ? r.filtered.map((j) => <p key={j.signal.id} className="sig off"><i />{j.signal.title}<em>{j.reason}</em></p>) : <p className="sig none">No other updates.</p>}
              </div>
            </div>
          </Reveal>
        </div>
        <p className="fine center">Demo scenarios run through the app’s own engine. Nothing here is live traffic, weather or schedule data.</p>
      </div>
    </section>
  );
}
