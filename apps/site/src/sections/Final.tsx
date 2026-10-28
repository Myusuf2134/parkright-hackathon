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
            <a href="#top" className="brand"><img src="/icon.svg" alt="" width={28} height={28} />ParkRight</a>
            <p>A hackathon prototype for campus parking.</p>
          </div>
          <div className="disclosures" aria-label="Simulation and data disclosures">
            <h3>About this prototype</h3>
            <ul>
              <li>The Ohio Union North Garage-inspired level is a simulation inspired by a campus parking deck. It is not an official or exact digital twin and uses no real university data.</li>
              <li>Camera imagery on this page is rendered by the simulator. It is not real-world CCTV.</li>
              <li>On that garage, the detector reports occupied spaces and spaces it can’t confirm. Open-space confirmation is not enabled.</li>
              <li>Class schedules, traffic, weather, roadwork, routing and departure times are demo scenarios.</li>
              <li>App screens were captured from the app running on scripted demo data. ParkRight never reserves a space.</li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
