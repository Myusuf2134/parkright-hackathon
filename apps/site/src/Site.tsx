import { useEffect, useState } from 'react';
import { Ai } from './sections/Ai.tsx';
import { Arrival } from './sections/Arrival.tsx';
import { Demo } from './sections/Demo.tsx';
import { Showcase } from './sections/Showcase.tsx';
import { Tech } from './sections/Tech.tsx';
import { LINKS } from './config.ts';
import { Action, Reveal } from './ui/kit.tsx';

const NAV = [
  ['#app', 'Product'],
  ['#ai', 'Technology'],
  ['#markets', 'Markets'],
  ['#about', 'About'],
  ['#tech', 'Under the hood'],
] as const;

function Brand({ footer = false }: { footer?: boolean }) {
  return <a href="#top" className="md-brand" data-testid={footer ? 'footer-brand' : 'nav-brand'} aria-label="Meridian home">
    <img src="/brand/meridian-atlas.svg" alt="" width={45} height={45} />
    <span>MERIDIAN</span>
  </a>;
}

const FEATURES = [
  { number: '01', icon: 'target', heading: 'Spatial intelligence', description: 'Understand what is happening in physical spaces, not just what happened before.' },
  { number: '02', icon: 'layers', heading: 'Seamless journeys', description: 'Connect departure, parking and walking into one calmer experience.' },
  { number: '03', icon: 'network', heading: 'Connected systems', description: 'Bring cameras, infrastructure and destinations into the same picture.' },
  { number: '04', icon: 'waves', heading: 'A clearer way forward', description: 'Less guesswork for people. Better information for the places they go.' },
] as const;

function FeatureIcon({ name }: { name: typeof FEATURES[number]['icon'] }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'target') return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="6"/><path d="M24 2v11M24 35v11M2 24h11M35 24h11"/></svg>;
  if (name === 'layers') return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}><path d="m24 4 18 11-18 11L6 15 24 4Z"/><path d="m6 24 18 11 18-11M6 33l18 11 18-11"/></svg>;
  if (name === 'network') return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}><path d="M9 35 23 8l16 27H9ZM23 8v27M9 35l14-11 16 11"/><circle cx="23" cy="8" r="3" fill="currentColor"/><circle cx="9" cy="35" r="3" fill="currentColor"/><circle cx="39" cy="35" r="3" fill="currentColor"/></svg>;
  return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}><path d="M3 19c9-12 17 12 26 0s13-7 16-4M3 32c9-12 17 12 26 0s13-7 16-4"/></svg>;
}

function MeridianHero() {
  return <header className="md-hero" id="top">
    <div className="md-hero-photo" aria-hidden="true" />
    <div className="wrap md-hero-inner">
      <div className="md-hero-copy">
        <span className="md-eyebrow md-hero-enter">INTELLIGENT MOBILITY<br/>FOR A MORE CONNECTED WORLD.</span>
        <p className="md-hero-name md-hero-enter">MERIDIAN</p>
        <h1 className="md-hero-title md-hero-enter">Arrive ready.</h1>
        <p className="md-hero-description md-hero-enter">A better way to move through the world. We connect physical spaces, intelligent systems, and the people on their way.</p>
        <div className="actions md-hero-actions md-hero-enter">
          <Action to="app" testid="cta-hero-app">Explore ParkRight</Action>
          <Action to="demo" kind="secondary" testid="cta-hero-demo">Try out the demo</Action>
        </div>
        <p className="md-prototype-note">Introducing ParkRight, our university mobility prototype. Garage imagery, schedules and estimates are simulated or demo scenarios.</p>
      </div>
      <aside className="md-hero-aside" aria-label="Meridian values">
        <span>PEOPLE</span><span>PLACES</span><span>POSSIBILITIES</span>
        <i />
        <small>IN SYNC.</small>
      </aside>
    </div>
    <a className="md-scroll-cue" href="#capabilities">DISCOVER <span aria-hidden="true">↓</span></a>
    <span className="md-hero-index">01 / 05</span>
  </header>;
}

function Capabilities() {
  return <section id="capabilities" className="md-capabilities" aria-labelledby="capabilities-title">
    <h2 id="capabilities-title" className="sr-only">Meridian capabilities</h2>
    <div className="wrap md-capabilities-grid">
      {FEATURES.map(f => <div className="md-capability" key={f.number}>
        <span className="md-capability-number">{f.number}</span>
        <FeatureIcon name={f.icon}/>
        <h3>{f.heading}</h3>
        <p>{f.description}</p>
      </div>)}
    </div>
  </section>;
}

function Vision() {
  return <section id="about" className="md-vision md-panel-section" aria-labelledby="vision-title">
    <div className="wrap md-vision-grid">
      <Reveal className="md-vision-copy">
        <span className="md-eyebrow">OUR VISION / 01</span>
        <h2 id="vision-title">A higher standard<br/>for how people <em>arrive.</em></h2>
        <p>Every trip is a series of decisions. When to leave. Where to go. Where to park. How to make the last few minutes count.</p>
        <p>Meridian is building toward a world where those decisions feel effortless. We start on campus with ParkRight, an AI-powered parking and arrival demonstration.</p>
        <a className="md-text-link" href="#app">Explore the first product <span aria-hidden="true">↗</span></a>
      </Reveal>
      <Reveal className="md-vision-visual" delay={120}>
        <div className="md-vision-photo" role="img" aria-label="Nighttime university campus landscape"/>
        <div className="md-glass-card md-card-top">
          <span className="md-card-kicker">CAMERA COVERAGE · SIMULATED</span>
          <strong>8 <span>views</span></strong>
          <span>72 bays in a prototype garage</span>
        </div>
        <div className="md-glass-card md-card-bottom">
          <span className="md-card-kicker">ARRIVAL PLANNING</span>
          <strong>9:58 <span>AM</span></strong>
          <span>Illustrative departure estimate</span>
        </div>
        <span className="md-photo-caption">Prototype scenarios · not live campus availability</span>
      </Reveal>
    </div>
  </section>;
}

function TechnologyIntro() {
  return <section className="md-technology-intro md-panel-section" aria-labelledby="md-tech-title">
    <div className="wrap md-tech-grid">
      <Reveal className="md-tech-copy">
        <span className="md-eyebrow">TECHNOLOGY / 02</span>
        <h2 id="md-tech-title">From real spaces<br/>to <em>real possibilities.</em></h2>
        <p>Computer vision turns camera frames into meaningful signals. Our prototype combines simulated garage views with an A2 vehicle detector, a live state engine and a student-facing app.</p>
        <a className="md-text-link" href="#ai">Discover how it works <span aria-hidden="true">↗</span></a>
      </Reveal>
      <Reveal className="md-tech-image" delay={80}>
        <img src="/media/a2-cam05.webp" width={732} height={412} loading="lazy" alt="A2 detector boxes over simulated garage camera footage"/>
        <span className="md-tech-stamp"><i/> SIMULATED CAMERA · A2 DETECTOR</span>
      </Reveal>
      <Reveal className="md-tech-points" delay={160}>
        <div><span className="md-point-icon">◎</span><h3>Computer vision</h3><p>Detect vehicles in simulated garage camera views.</p></div>
        <div><span className="md-point-icon">▥</span><h3>State, not guesses</h3><p>Distinguish observed occupancy from spaces we cannot confirm.</p></div>
        <div><span className="md-point-icon">↗</span><h3>Arrival intelligence</h3><p>Combine trip information into a useful departure recommendation.</p></div>
      </Reveal>
    </div>
  </section>;
}

const MARKETS = [
  ['Campuses', 'A smarter way to get to class'],
  ['Airports', 'A future opportunity'],
  ['Cities', 'A future opportunity'],
  ['Venues', 'A future opportunity'],
  ['Hospitals', 'A future opportunity'],
] as const;

function Markets() {
  return <section className="md-markets" id="markets" aria-labelledby="markets-title">
    <div className="md-globe" aria-hidden="true"/>
    <div className="wrap md-markets-inner">
      <div className="md-markets-copy">
        <span className="md-eyebrow">THE ROAD AHEAD / 05</span>
        <h2 id="markets-title">A platform for<br/><em>what’s next.</em></h2>
        <p>Today, a campus prototype. Tomorrow, more intelligent connections between people, places and infrastructure.</p>
        <a href="#app" className="md-pill-link">Meet ParkRight <span aria-hidden="true">↗</span></a>
      </div>
      <div className="md-markets-row">
        {MARKETS.map(([name, detail],i)=><div key={name}><span className="md-market-symbol">{['⌂','✈','▤','◌','✚'][i]}</span><b>{name}</b><small>{detail}</small></div>)}
      </div>
    </div>
  </section>;
}

function MeridianFooter() {
  return <>
    <section className="md-end" aria-labelledby="final-title">
      <div className="wrap md-end-inner">
        <span className="md-eyebrow">THE FUTURE STARTS SOMEWHERE.</span>
        <h2 id="final-title">A clearer way<br/><em>to arrive.</em></h2>
        <div className="actions">
          <Action to="app" testid="cta-final-app">Try ParkRight</Action>
          <Action to="demo" kind="secondary" testid="cta-final-demo">Explore the demo</Action>
          <a className="md-footer-repo" href={LINKS.repo} target="_blank" rel="noreferrer" data-testid="cta-repo">GitHub repository ↗</a>
        </div>
      </div>
    </section>
    <footer className="md-footer">
      <div className="wrap md-footer-grid">
        <div>
          <Brand footer/>
          <p className="md-footer-tag">Intelligent mobility.<br/>People, places, possibilities.</p>
          <span className="md-footer-small">© 2026 Meridian concept · ParkRight prototype</span>
        </div>
        <div className="md-footer-disclosures" aria-label="Simulation and data disclosures">
          <h3>About this prototype</h3>
          <p>ParkRight is a hackathon prototype. The Ohio Union North Garage-inspired level is simulated—not an official or exact digital twin—and uses no real university camera data.</p>
          <p>Camera views are simulator-rendered, not real-world CCTV. The A2 detector identifies occupied spaces, but cannot verify open bays. Open-space confirmation is not enabled.</p>
          <p>Schedules, traffic, routing and departure estimates are demo scenarios. The app never reserves a parking space. Airports, cities, venues and hospitals represent future possibilities, not deployed markets.</p>
        </div>
      </div>
    </footer>
  </>;
}

export function Site() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <nav className={'nav md-nav' + (scrolled ? ' scrolled' : '')} aria-label="Primary">
      <div className="wrap nav-inner md-nav-inner">
        <Brand/>
        <div className="nav-links">{NAV.map(([href,label])=><a key={href} href={href}>{label}</a>)}</div>
        <Action to="app" testid="cta-nav">Explore ParkRight</Action>
      </div>
    </nav>
    <div className="site-background" aria-hidden="true"/>
    <MeridianHero/>
    <main id="main">
      <Capabilities/>
      <Vision/>
      <TechnologyIntro/>
      <section className="md-product-heading"><div className="wrap"><span className="md-eyebrow">INTRODUCING PARKRIGHT / 03</span><p>One connected experience for the moments before you arrive.</p></div></section>
      <Showcase/>
      <Ai/>
      <Demo/>
      <Arrival/>
      <Tech/>
      <Markets/>
    </main>
    <MeridianFooter/>
  </>;
}
