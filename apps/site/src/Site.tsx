import { useEffect, useState } from 'react';
import { Ai } from './sections/Ai.tsx';
import { Arrival } from './sections/Arrival.tsx';
import { Demo } from './sections/Demo.tsx';
import { Final } from './sections/Final.tsx';
import { Hero } from './sections/Hero.tsx';
import { Problem } from './sections/Problem.tsx';
import { Showcase } from './sections/Showcase.tsx';
import { Tech } from './sections/Tech.tsx';
import { Action } from './ui/kit.tsx';

const NAV = [['#app', 'App'], ['#ai', 'AI'], ['#demo', 'Demo'], ['#arrival', 'Arrival'], ['#tech', 'Tech']] as const;

export function Site() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 12);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <nav className={`nav${scrolled ? ' scrolled' : ''}`} aria-label="Primary">
        <div className="wrap nav-inner">
          <a href="#top" className="brand" aria-label="ParkRight home"><img src="/icon.svg" alt="" width={28} height={28} />ParkRight</a>
          <div className="nav-links">{NAV.map(([h, l]) => <a key={h} href={h}>{l}</a>)}</div>
          <Action to="app" kind="primary" testid="cta-nav">Try ParkRight</Action>
        </div>
      </nav>
      <div className="site-background" aria-hidden />
      <Hero />
      <main id="main">
        <Problem />
        <Showcase />
        <Ai />
        <Demo />
        <Arrival />
        <Tech />
      </main>
      <Final />
    </>
  );
}
