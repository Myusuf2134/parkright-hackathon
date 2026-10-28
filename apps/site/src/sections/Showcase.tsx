import { useRef, useState, type KeyboardEvent } from 'react';
import { Phone, SectionHead, Source } from '../ui/kit.tsx';

const TABS = [
  {
    id: 'explore', label: 'Explore', q: 'Where should I park?',
    screens: [['/media/v5-explore.webp', 'Explore: spaces confirmed open near Dreese Labs'], ['/media/v5-space.webp', 'Choose a space: only confirmed-open spaces can be picked']],
    points: [
      ['Confirmed, or not shown as open', 'Only a space a camera saw empty in the last few seconds counts as open. Everything else is occupied or “can’t confirm”.'],
      ['Pick a space, or take the suggestion', 'Spaces you can’t use are never offered: accessible without a placard, EV charging without an EV, and reserved spaces.'],
      ['Rechecked before you go', 'The space is re-read when you tap Go and watched on the way. It is never a reservation.'],
    ],
  },
  {
    id: 'plan', label: 'Plan', q: 'When should I leave?',
    screens: [['/media/v5-plan.webp', 'Plan: recommended departure 9:58 AM for a 10:20 AM class, labelled demo estimate'], ['/media/v5-trip.webp', 'Trip: the chosen space is still open, with demo guidance']],
    points: [
      ['One time to remember', 'Drive, park, walk and a buffer add up to a single departure time.'],
      ['Only what affects your trip', 'Traffic, weather, roadwork and class announcements are filtered to your route, your class and your travel window.'],
      ['Honest about its inputs', 'In this prototype the schedule and travel times are demo scenarios, and they’re labelled that way in the app.'],
    ],
  },
  {
    id: 'you', label: 'You', q: 'My parking preferences',
    screens: [['/media/v5-you.webp', 'You: vehicle type, accessible placard and permit settings, stored on this device'], ['/media/v5-garage.webp', 'Garage details: open, occupied and can’t-confirm counts, and space types you can use']],
    points: [
      ['No account', 'Preferences stay on the device.'],
      ['Eligibility narrows, never widens', 'An EV setting or accessible placard decides which confirmed-open spaces you’re offered. A self-reported permit unlocks nothing.'],
      ['Alerts while the app is open', 'If your space is taken on the way, ParkRight says so and offers the next one.'],
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
        <SectionHead id="showcase-title" eyebrow="The student app" title="Your day, parked." lede="Three tabs. One question each." />
        <div className="tabs" role="tablist" aria-label="App tabs" onKeyDown={onKey}>
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={i === active} aria-controls={`panel-${t.id}`} tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)} data-testid={`tab-${t.id}`}>
              <b>{t.label}</b><span>{t.q}</span>
            </button>
          ))}
        </div>
        <div className="tabpanel" role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} key={tab.id}>
          <div className="duo">
            <Phone src={tab.screens[0][0]} alt={tab.screens[0][1]} className="duo-a" />
            <Phone src={tab.screens[1][0]} alt={tab.screens[1][1]} className="duo-b" />
          </div>
          <div className="points">
            <h3 className="h3">{tab.q}</h3>
            <ul>
              {tab.points.map(([h, p]) => <li key={h}><b>{h}</b><p>{p}</p></li>)}
            </ul>
            <p className="fine"><Source tone="sim">Screens captured from the app</Source> running on a simulated garage with scripted demo data.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
