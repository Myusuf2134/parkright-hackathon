import { LINKS } from '../config.ts';
import { Action, Reveal, SectionHead, Source } from '../ui/kit.tsx';

export function Demo() {
  return (
    <section className="section demo" id="demo" aria-labelledby="demo-title">
      <div className="wrap">
        <SectionHead id="demo-title" eyebrow="Live demo" title="See both sides of ParkRight." lede="The presentation view puts the real student app beside the pipeline that feeds it: the same garage, the same live state." />
        <Reveal as="figure" className="browser">
          <div className="browser-bar" aria-hidden><i /><i /><i /><span>/present/</span></div>
          <img src="/media/present-split.webp" alt="ParkRight presentation view: the student app in a phone on the left, and on the right the pipeline flow, camera tabs, metrics, a bay map and live events" width={2000} height={1250} loading="lazy" />
          <figcaption>
            <Source tone="demo">Captured on the scripted test harness</Source>
            Space states in this capture are scripted and the camera panel shows no imagery. With the simulator and the A2 detector running, the right side shows live camera frames and detections.
          </figcaption>
        </Reveal>
        <div className="demo-row">
          <ul className="demo-points">
            <li><b>Student</b> The app itself, embedded unchanged, with a short tour.</li>
            <li><b>Split</b> The default: app on the left, perception on the right.</li>
            <li><b>Live AI</b> Camera, detector, space state, latency and events.</li>
          </ul>
          <div className="actions">
            <Action to="demo" testid="cta-demo">Open Live Demo</Action>
            {LINKS.walkthrough && <a className="btn btn-secondary" href={LINKS.walkthrough} target="_blank" rel="noreferrer" data-testid="cta-walkthrough">Watch recorded walkthrough</a>}
          </div>
        </div>
        <Reveal className="run" >
          <div id="run" className="run-anchor" />
          <h3 className="h3">Run it yourself</h3>
          <p>{LINKS.demo ? 'The live demo needs the local stack.' : 'The live demo isn’t hosted publicly yet.'} {LINKS.walkthrough ? 'The recorded walkthrough shows it end to end.' : ''} With the repository and the A2 checkpoint:</p>
          <pre><code>{`npm run demo:ohio -- --open
# student app   http://localhost:5180/app/
# both sides    http://localhost:5180/present/`}</code></pre>
          <p className="fine">Without the A2 checkpoint, <code>apps/web/README.md</code> describes a scripted harness. Its screens say “scripted test source” wherever detection would appear.</p>
          <a className="link" href={LINKS.repo} target="_blank" rel="noreferrer">View the repository on GitHub</a>
        </Reveal>
      </div>
    </section>
  );
}
