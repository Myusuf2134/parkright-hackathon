import { useRef, useState, type KeyboardEvent } from 'react';
import { Phone, SectionHead, Source } from '../ui/kit.tsx';

const TABS = [
  {
    id: 'explore', label: 'Explore', q: 'Where should I park?',
    screens: [['/media/v5-explore.webp', 'Explore: spaces confirmed open near Dreese Labs'], ['/media/v5-space.webp', 'Choose a space: only confirmed-open spaces can be picked']],
    points: [
      ['Confirmed, or not shown as open', 'Only a space a camera recently saw empty counts as open.'],
      ['Only spaces you can use', 'Accessible and EV spaces follow your settings. Reserved spaces are never offered.'],
      ['Rechecked before you go', 'Re-read when you tap Go and watched on the way. Never a reservation.'],
    ],
  },
  {
    id: 'plan', label: 'Plan', q: 'When should I leave?',
    screens: [['/media/v5-plan.webp', 'Plan: recommended departure 9:58 AM for a 10:20 AM class, labelled demo estimate'], ['/media/v5-trip.webp', 'Trip: the chosen space is still open, with demo guidance']],
    points: [
      ['One time to remember', 'Drive, park, walk and a buffer become one departure time.'],
      ['Only what affects your trip', 'Updates are filtered to your route, your class and your travel window.'],
      ['Honest about its inputs', 'Schedules and travel times here are demo scenarios, labelled in the app.'],
    ],
  },
  {
    id: 'you', label: 'You', q: 'My parking preferences',
    screens: [['/media/v5-you.webp', 'You: vehicle type, accessible placard and permit settings, stored on this device'], ['/media/v5-garage.webp', 'Garage details: open, occupied and can’t-confirm counts, and space types you can use']],
    points: [
      ['No account', 'Preferences stay on the device.'],
      ['Eligibility narrows, never widens', 'Your vehicle and placard decide which confirmed-open spaces you’re offered.'],
      ['Alerts while the app is open', 'If your space is taken on the way, ParkRight offers the next one.'],
    ],
  },
] as const;

export function Showcase() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = TABS[active]!;
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (active + d + TABS.length) % TABS.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <section className="section showcase" id="app" aria-labelledby="showcase-title">
      <div className="wrap">
        <SectionHead id="showcase-title" eyebrow="The student app" title="Your day, parked." lede="Your class starts at 10:20. Parking shouldn’t be the unknown. Three tabs answer the three questions that matter." />
        <div className="tabs" role="tablist" aria-label="App tabs" onKeyDown={onKey}>
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={i === active} aria-controls={`panel-${t.id}`} tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)} data-testid={`tab-${t.id}`}>
              <b>{t.label}</b><span>{t.q}</span>
            </button>
          ))}
        </div>
        <div className="tabpanel" role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`}>
          <div className="duo">
            {TABS.map((t, i) => (
              <div key={t.id} className={`duo-set${i === active ? ' on' : ''}`} aria-hidden={i !== active}>
                <Phone src={t.screens[0][0]} alt={i === active ? t.screens[0][1] : ''} className="duo-a" />
                <Phone src={t.screens[1][0]} alt={i === active ? t.screens[1][1] : ''} className="duo-b" />
              </div>
            ))}
          </div>
          <div className="points" key={tab.id}>
            <h3 className="h3">{tab.q}</h3>
            <ul>
              {tab.points.map(([h, p]) => <li key={h}><b>{h}</b><p>{p}</p></li>)}
            </ul>
            <p className="fine"><Source tone="sim">Screens captured from the app</Source> on a simulated garage with scripted demo data.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
