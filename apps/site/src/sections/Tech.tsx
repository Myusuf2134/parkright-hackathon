import { Reveal, SectionHead } from '../ui/kit.tsx';

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

export function Tech() {
  return (
    <section className="section tech" id="tech" aria-labelledby="tech-title">
      <div className="wrap">
        <SectionHead id="tech-title" eyebrow="Technology" title="What it’s built with." lede="The actual stack in the repository, and what each part does today." />
        <ul className="stack">
          {STACK.map(([h, p, tag], i) => (
            <Reveal as="li" key={h} delay={(i % 4) * 70}>
              <div className="stack-top"><b>{h}</b><span className={`tag${tag === 'In the demo' ? '' : ' opt'}`}>{tag}</span></div>
              <p>{p}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
