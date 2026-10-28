import { Phone, Reveal, SectionHead, Source } from '../ui/kit.tsx';

const STEPS = [
  ['Camera', 'Eight CCTV views of the garage, rendered by the simulator and sent to the API as JPEG frames.'],
  ['A2 detector', 'A Faster R-CNN vehicle detector, fine-tuned on simulator imagery, finds vehicles in each frame.'],
  ['Space state', 'Each detection is matched to calibrated bay outlines. A bay is occupied, or ParkRight can’t confirm it.'],
  ['ParkRight', 'The state streams to the app over a WebSocket. Old evidence goes stale; nothing stale is offered.'],
] as const;

export function Ai() {
  return (
    <section className="section ai" id="ai" aria-labelledby="ai-title">
      <div className="wrap">
        <SectionHead id="ai-title" eyebrow="Perception" title="From camera to clarity." lede="ParkRight turns camera frames into a state for every space, and only that state reaches the app." />
        <ol className="flow" aria-label="Pipeline">
          {STEPS.map(([h, p], i) => (
            <Reveal as="li" key={h} delay={i * 80}>
              <span className="flow-n">{String(i + 1).padStart(2, '0')}</span>
              <b>{h}</b>
              <p>{p}</p>
            </Reveal>
          ))}
        </ol>

        <div className="ai-grid">
          <Reveal as="figure" className="shot shot-hero">
            <img src="/media/a2-cam05.webp" alt="Simulated CCTV view of row A with A2 vehicle boxes and labelled bays A10 to A18" width={732} height={412} loading="lazy" />
            <figcaption><Source tone="sim">Rendered simulation, not real-world CCTV</Source> One simulated camera, with the A2 detector’s vehicle boxes and the bays it watches.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={80}>
            <img src="/media/sim-observer.webp" alt="Overview of the Three.js simulated garage level with parked and moving cars" width={1280} height={440} loading="lazy" />
            <figcaption><Source tone="sim">Three.js simulator</Source> A 72-space level inspired by a campus deck. Not an official or exact digital twin.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={120}>
            <img src="/media/a2-eight-cameras.webp" alt="Eight simulated camera views with A2 detections" width={1280} height={440} loading="lazy" />
            <figcaption><Source tone="sim">Eight simulated cameras</Source> Each camera owns nine bays, so every space has exactly one source.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={160}>
            <img src="/media/live-bay-states.webp" alt="Live bay grid: 72 spaces, occupied in red, uncertain in grey, zero confirmed open" width={764} height={360} loading="lazy" />
            <figcaption><Source tone="live">Live state view</Source> All 72 bays, updated over WebSocket as each frame is processed.</figcaption>
          </Reveal>
        </div>

        <div className="ai-truth">
          <Reveal className="stats">
            <div><b>8</b><span>simulated cameras</span></div>
            <div><b>72</b><span>simulated bays</span></div>
            <div><b>Live</b><span>WebSocket state updates</span></div>
            <div className="muted"><b>Off</b><span>open-space confirmation</span></div>
          </Reveal>
          <Reveal className="truth-card" delay={80}>
            <h3 className="h3">What the detector can say today</h3>
            <p>On the Ohio-inspired garage, A2 reports <b>occupied</b> spaces. A bay with no vehicle in view stays <b>can’t confirm</b>: no detection is not proof a space is empty, so open-space confirmation is switched off and nothing is shown as available that the cameras haven’t confirmed.</p>
            <p className="fine">The app says this too, in its own words.</p>
          </Reveal>
          <Reveal className="truth-phone" delay={120}>
            <Phone src="/media/v5-ohio-explore.webp" alt="ParkRight Explore on the Ohio-inspired garage: 36 spaces seen occupied, empty spaces can’t be confirmed yet, open-space confirmation isn’t enabled in this demo" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
