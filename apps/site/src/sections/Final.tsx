import { LINKS } from '../config.ts';
import { Action, Reveal } from '../ui/kit.tsx';

export function Final() {
  return (
    <>
      <section className="section final" aria-labelledby="final-title">
        <Reveal className="wrap final-inner">
          <h2 id="final-title" className="h1 final-h"><span className="ln">Less searching.</span>{' '}<span className="ln">More arriving.</span></h2>
          <div className="actions center">
            <Action to="app" testid="cta-final-app">Try Student App</Action>
            <Action to="demo" kind="secondary" testid="cta-final-demo">See AI Demo</Action>
            <a className="btn btn-ghost" href={LINKS.repo} target="_blank" rel="noreferrer" data-testid="cta-repo">GitHub repository</a>
          </div>
        </Reveal>
      </section>
      <footer className="footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <a href="#top" className="brand" data-testid="footer-brand"><span className="brand-mark"><img src="/brand/parkright-mark.png" alt="" width={37} height={32} /><img className="brand-word" src="/brand/parkright-wordmark.png" alt="ParkRight" width={93} height={21} /></span></a>
            <p>A hackathon prototype for campus parking.</p>
          </div>
          <div className="disclosures" aria-label="Simulation and data disclosures">
            <h3>About this prototype</h3>
            <ul>
              <li>The Ohio Union North Garage-inspired level is simulated: not an official or exact digital twin, and no real university data.</li>
              <li>Camera imagery is rendered by the simulator, not real-world CCTV.</li>
              <li>The detector reports occupied and can’t-confirm spaces. Open-space confirmation is not enabled.</li>
              <li>Schedules, traffic, weather, routing and departure times are demo scenarios.</li>
              <li>App screens show scripted demo data. ParkRight never reserves a space.</li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
