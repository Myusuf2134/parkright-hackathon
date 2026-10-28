import { Fragment, type CSSProperties } from 'react';
import { Action, Phone, Source } from '../ui/kit.tsx';

/** Splits a line into words that rise into view one after another (CSS only; static with reduced motion). */
function Words({ text, start }: { text: string; start: number }) {
  return (
    <span className="ln">
      {text.split(' ').map((w, i) => (
        <Fragment key={i}><span className="w" style={{ '--d': `${start + i * 90}ms` } as CSSProperties}>{w}</span>{' '}</Fragment>
      ))}
    </span>
  );
}

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <span className="eyebrow rise" style={{ '--d': '0ms' } as CSSProperties}>Campus parking, before you leave</span>
        <h1 className="h1" aria-label="Park smarter. Arrive ready."><Words text="Park smarter." start={120} /><Words text="Arrive ready." start={300} /></h1>
        <p className="hero-lede rise" style={{ '--d': '560ms' } as CSSProperties}>Know when to leave, understand where parking is available, and make every arrival easier.</p>
        <div className="actions rise" style={{ '--d': '680ms' } as CSSProperties}>
          <Action to="app" testid="cta-hero-app">Try ParkRight</Action>
          <Action to="demo" kind="secondary" testid="cta-hero-demo">See the AI Demo</Action>
        </div>
        <p className="fine rise" style={{ '--d': '800ms' } as CSSProperties}>Hackathon prototype on a simulated campus garage. Schedules and travel times are demo scenarios.</p>
      </div>
      <div className="hero-stage" aria-label="ParkRight app screens">
        {/* A route drawn once from the class to the garage: an illustration, not a real route. */}
        <svg className="hero-route" viewBox="0 0 600 700" aria-hidden>
          <path pathLength={1} d="M40 640 C 140 560, 120 470, 230 430 S 420 380, 470 250 S 540 110, 590 70" />
        </svg>
        <Phone src="/media/v5-plan.webp" alt="ParkRight Plan tab: next class CSE 2421 at 10:20 AM, recommended departure 9:58 AM, labelled demo estimate" className="hero-back" />
        <Phone src="/media/v5-explore.webp" alt="ParkRight Explore tab: 13 spaces confirmed open in the simulated showcase garage, with a parking observations bar" className="hero-front" priority />
        <div className="chip chip-a"><i className="dot-green" />Rechecked before you go</div>
        <div className="chip chip-b"><b>Leave 9:58 AM</b><Source>Demo estimate</Source></div>
        <p className="hero-cap">Real app screens · simulated garage with scripted demo data</p>
      </div>
    </header>
  );
}
