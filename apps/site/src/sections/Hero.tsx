import { Action, Phone, Source } from '../ui/kit.tsx';

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <span className="eyebrow">Campus parking, before you leave</span>
        <h1 className="h1"><span className="ln">Park smarter.</span>{' '}<span className="ln">Arrive ready.</span></h1>
        <p className="hero-lede">Know when to leave, understand where parking is available, and make every arrival easier.</p>
        <div className="actions">
          <Action to="app" testid="cta-hero-app">Try ParkRight</Action>
          <Action to="demo" kind="secondary" testid="cta-hero-demo">See the AI Demo</Action>
        </div>
        <p className="fine">Hackathon prototype on a simulated campus garage. Schedules and travel times are demo scenarios.</p>
      </div>
      <div className="hero-stage" aria-label="ParkRight app screens">
        <Phone src="/media/v5-plan.webp" alt="ParkRight Plan tab: next class CSE 2421 at 10:20 AM, recommended departure 9:58 AM, labelled demo estimate" className="hero-back" />
        <Phone src="/media/v5-explore.webp" alt="ParkRight Explore tab: 13 spaces confirmed open in the simulated showcase garage, with a parking observations bar" className="hero-front" priority />
        <div className="chip chip-a"><i className="dot-green" />Rechecked before you go</div>
        <div className="chip chip-b"><b>Leave 9:58 AM</b><Source>Demo estimate</Source></div>
        <p className="hero-cap">Real app screens · simulated garage with scripted demo data</p>
      </div>
    </header>
  );
}
