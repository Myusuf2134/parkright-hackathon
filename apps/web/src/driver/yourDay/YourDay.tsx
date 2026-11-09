/** Opt-in, read-only My Day. No login, LLM, GPS or transmission of class entries. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { LiveParking } from '../arrival/useArrival.ts';
import { DEVICE_STORE, isUsableForecast, upcoming, validateClasses, whenAt, type CampusForecast, type SavedClass } from './model.ts';
import './your-day.css';

function loadClasses(): SavedClass[] {
  try { const raw = localStorage.getItem(DEVICE_STORE); return raw ? validateClasses(JSON.parse(raw)) : []; }
  catch { return []; }
}
function savedOnDevice(): boolean {
  try { return localStorage.getItem(DEVICE_STORE) !== null; } catch { return false; }
}

export function YourDay({ onFind, onDemo, parking }: {
  onFind: (destination: string) => void;
  onDemo: () => void;
  parking: LiveParking | null;
}) {
  const [classes, setClasses] = useState<SavedClass[]>(loadClasses);
  const [remember, setRemember] = useState(savedOnDevice);
  const [course, setCourse] = useState('');
  const [building, setBuilding] = useState('');
  const [start, setStart] = useState('');
  const [editing, setEditing] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [forecast, setForecast] = useState<CampusForecast | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);

  useEffect(() => {
    if (!remember) return;
    try { localStorage.setItem(DEVICE_STORE, JSON.stringify(classes)); }
    catch { /* Storage disabled: continue in memory. */ }
  }, [classes, remember]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/v1/your-day/campus-weather', { signal: ac.signal, credentials: 'omit' })
      .then((response) => { if (!response.ok) throw Error('Forecast unavailable'); return response.json() as Promise<CampusForecast>; })
      .then((data) => { if (!ac.signal.aborted) setForecast(data); })
      .catch(() => { if (!ac.signal.aborted) setForecast(null); })
      .finally(() => { if (!ac.signal.aborted) setWeatherLoading(false); });
    return () => ac.abort();
  }, []);

  const next = useMemo(() => upcoming(classes, clock)[0] ?? null, [classes, clock]);
  const weatherOK = isUsableForecast(forecast, clock);
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const date = new Date(start);
    if (!course.trim() || !building.trim() || !Number.isFinite(date.getTime()) || classes.length >= 25) return;
    setClasses((prev) => [...prev, {
      id: crypto.randomUUID(), course: course.trim().slice(0, 90), building: building.trim().slice(0, 140),
      startsAt: date.toISOString(),
    }]);
    setCourse(''); setBuilding(''); setStart(''); setEditing(false);
  };
  const setStorage = (checked: boolean) => {
    setRemember(checked);
    if (!checked) try { localStorage.removeItem(DEVICE_STORE); } catch { /* ignore */ }
  };
  const clear = () => {
    setClasses([]); setRemember(false);
    try { localStorage.removeItem(DEVICE_STORE); } catch { /* ignore */ }
  };

  return <div className="screen yd-screen" data-testid="your-day">
    <div className="wash tall" aria-hidden="true" />
    <div className="yd-content">
      <header className="yd-header">
        <div><span className="yd-ey">Meridian · Private planning</span><h1>My day.</h1><p>Classes, parking, and campus information — without guessing.</p></div>
        <button type="button" className="yd-linkbtn" onClick={onDemo}>Demo</button>
      </header>
      <section className="yd-card yd-next" aria-label="Next class">
        <div className="yd-row"><span className="yd-ey">Next class</span><span className="yd-tag">Entered by you</span></div>
        {next ? <>
          <h2>{next.course}</h2><p className="yd-bold">{next.building}</p><p>{whenAt(next.startsAt)}</p>
          <p className="yd-disclaimer">Departure time unavailable until a real drive route, parking time, and walking route have been verified.</p>
          <button type="button" className="yd-primary" onClick={() => onFind(next.building)}>Find route and parking</button>
        </> : <>
          <h2>No upcoming class entered</h2><p>Enter your own class and building. Meridian won't guess your schedule.</p>
          <button type="button" className="yd-primary" onClick={() => setEditing(true)}>Add a class</button>
        </>}
      </section>

      <div className="yd-row yd-section"><h2>Campus updates</h2><span className="yd-tag">Read-only</span></div>
      <section className="yd-card yd-updates" aria-label="Campus updates">
        <article className="yd-item"><span className="yd-symbol" aria-hidden="true">☁</span><div>
          <b>Campus weather forecast</b>
          <p>{weatherLoading ? 'Checking official forecast…' : weatherOK ?
            String(forecast!.temperature_f) + '°F · ' + forecast!.summary + ' · For ' + whenAt(forecast!.forecast_at!) :
            'Official forecast unavailable right now.'}</p>
          {weatherOK && <a className="yd-source-link" href={forecast!.source_url!} rel="noopener noreferrer" target="_blank">
            National Weather Service · Checked {new Date(forecast!.checked_at).toLocaleTimeString()}
          </a>}
        </div></article>
        <article className="yd-item"><span className="yd-symbol" aria-hidden="true">▤</span><div>
          <b>Announcements and assignments</b><p>Not connected. Your university account has not been accessed.</p>
        </div></article>
        <article className="yd-item"><span className="yd-symbol" aria-hidden="true">⚑</span><div>
          <b>Traffic and roadwork</b><p>No verified campus disruption feed connected. Live traffic isn't included.</p>
        </div></article>
        <article className="yd-item"><span className="yd-symbol" aria-hidden="true">P</span><div>
          <b>Parking near campus</b><p>{!parking ? 'No parking feed available.' :
            !parking.trusted ? 'Parking feed unavailable.' :
            parking.openDisabled ? 'Open spaces cannot currently be confirmed.' :
            String(parking.open) + ' confirmed open · ' + parking.garage + (parking.simulated ? ' · Simulated, not real availability' : '')}</p>
        </div></article>
      </section>

      <section className="yd-card yd-schedule" aria-label="My classes">
        <div className="yd-row"><h2>My classes</h2><button type="button" className="yd-linkbtn" onClick={() => setEditing((s) => !s)}>{editing ? 'Cancel' : 'Add class'}</button></div>
        {editing && <form className="yd-form" onSubmit={add}>
          <label>Course<input required maxLength={90} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. CSE 2421" /></label>
          <label>Building<input required maxLength={140} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="e.g. Dreese Labs" /></label>
          <label>Date and time (your device timezone)<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <button type="submit" className="yd-primary" disabled={classes.length >= 25}>Add to my day</button>
        </form>}
        {classes.length === 0 ? <p>No classes entered yet.</p> :
          <div className="yd-class-list">{[...classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((c) =>
            <div className="yd-class" key={c.id}><div><b>{c.course}</b><p>{c.building} · {whenAt(c.startsAt)}</p></div>
              <button type="button" aria-label={'Remove ' + c.course} onClick={() => setClasses((old) => old.filter((i) => i.id !== c.id))}>Remove</button></div>
          )}</div>}
      </section>
      <section className="yd-privacy" aria-label="Privacy controls">
        <h2>Privacy controls</h2>
        <p>Entered classes stay in this browser. They're not sent to an AI model or the weather service. The weather forecast uses a fixed campus location, not your GPS.</p>
        <label className="yd-remember"><input type="checkbox" checked={remember} onChange={(e) => setStorage(e.target.checked)} /> Remember classes on this device</label>
        <p>{remember ? 'Stored in this browser until cleared. Do not use on shared devices.' : 'Stored only while the view is open. Reloading may discard classes.'}</p>
        <button type="button" className="yd-linkbtn" onClick={clear}>Clear classes and device storage</button>
      </section>
    </div>
  </div>;
}
