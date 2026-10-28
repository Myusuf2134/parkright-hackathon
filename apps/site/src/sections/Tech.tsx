import { useEffect, useRef } from 'react';

const STACK = [
  ['React 19 · Vite · TypeScript', 'The student app, the presentation view and this site.', 'In the demo'],
  ['FastAPI', 'Frame ingestion, per-space state, staleness rules and recommendations.', 'In the demo'],
  ['WebSockets', 'A full snapshot on connect, then every space after each processed frame.', 'In the demo'],
  ['Three.js simulator', 'Renders the garage, traffic and eight CCTV cameras, then sends frames to the API.', 'In the demo'],
  ['A2 detector', 'torchvision Faster R-CNN (ResNet-50-FPN v2), fine-tuned on simulator imagery. Runs on CPU in the demo; GPU performance has not been measured yet.', 'In the demo'],
  ['NVIDIA Nemotron via Nebius Token Factory', 'Optional parking advice: Nemotron picks from facts the API supplies, and ParkRight validates the choice. Without a key, a labelled local fallback is used.', 'Optional'],
  ['Shared contracts', 'Pydantic models exported to TypeScript, so the API and the app agree on every message.', 'In the demo'],
  ['Tests', 'Vitest unit tests and Playwright browser tests, including runs against the real API with scripted camera states.', 'In the repo'],
] as const;

/** "Under the hood": the full stack, folded away by default. Opens when linked to (#tech). */
export function Tech() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => { if (location.hash === '#tech' && ref.current) ref.current.open = true; };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
  }, []);
  return (
    <section className="section tech" aria-labelledby="tech-title">
      <div className="wrap">
        <details className="hood" id="tech" ref={ref} data-testid="hood">
          <summary>
            <span className="eyebrow">Under the hood</span>
            <span id="tech-title" className="h3">What it’s built with</span>
            <span className="hood-chev" aria-hidden />
          </summary>
          <ul className="stack">
            {STACK.map(([h, p, tag]) => (
              <li key={h}>
                <div className="stack-top"><b>{h}</b><span className={`tag${tag === 'In the demo' ? '' : ' opt'}`}>{tag}</span></div>
                <p>{p}</p>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
