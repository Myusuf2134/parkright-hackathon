import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Phone, Reveal, SectionHead, Source } from '../ui/kit.tsx';

const STEPS = [
  ['Camera', 'Eight simulated CCTV views send frames to the API.'],
  ['A2 detector', 'A fine-tuned Faster R-CNN finds vehicles in each frame.'],
  ['Space state', 'Detections map to bays: occupied, or can’t confirm.'],
  ['ParkRight', 'Fresh state streams to the app. Nothing stale is offered.'],
] as const;

/** Lights the pipeline once, step by step, when it first comes into view. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

export function Ai() {
  const [flowRef, flowOn] = useInView<HTMLOListElement>();
  return (
    <section className="section ai" id="ai" aria-labelledby="ai-title">
      <div className="wrap">
        <SectionHead id="ai-title" eyebrow="Perception" title="From camera to clarity." lede="Camera frames become a state for every space. Only that state reaches the app." />
        <ol ref={flowRef} className={`flow${flowOn ? ' on' : ''}`} aria-label="Pipeline" data-testid="flow">
          {STEPS.map(([h, p], i) => (
            <li key={h} style={{ '--i': i } as CSSProperties}>
              <span className="flow-n">{String(i + 1).padStart(2, '0')}</span>
              <b>{h}</b>
              <p>{p}</p>
              {i < STEPS.length - 1 && <span className="flow-link" aria-hidden><i /></span>}
            </li>
          ))}
        </ol>

        <div className="ai-grid">
          <Reveal as="figure" className="shot shot-hero">
            <img src="/media/a2-cam05.webp" alt="Simulated CCTV view of row A with A2 vehicle boxes and labelled bays A10 to A18" width={732} height={412} loading="lazy" />
            <figcaption><Source tone="sim">Rendered simulation, not real-world CCTV</Source> A2 vehicle boxes over the bays one camera watches.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={80}>
            <img src="/media/sim-observer.webp" alt="Overview of the Three.js simulated garage level with parked and moving cars" width={1280} height={440} loading="lazy" />
            <figcaption><Source tone="sim">Three.js simulator</Source> 72 spaces, inspired by a campus deck. Not an official or exact digital twin.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={120}>
            <img src="/media/a2-eight-cameras.webp" alt="Eight simulated camera views with A2 detections" width={1280} height={440} loading="lazy" />
            <figcaption><Source tone="sim">Eight simulated cameras</Source> Each owns nine bays: one source per space.</figcaption>
          </Reveal>
          <Reveal as="figure" className="shot" delay={160}>
            <img src="/media/live-bay-states.webp" alt="Live bay grid: 72 spaces, occupied in red, uncertain in grey, zero confirmed open" width={764} height={360} loading="lazy" />
            <figcaption><Source tone="live">Live state view</Source> All 72 bays, updated over WebSocket.</figcaption>
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
            <p>A2 reports <b>occupied</b> spaces. A bay with no vehicle in view stays <b>can’t confirm</b>, because no detection isn’t proof it’s empty. Open-space confirmation is off, and the app says so.</p>
          </Reveal>
          <Reveal className="truth-phone" delay={120}>
            <Phone src="/media/v5-ohio-explore.webp" alt="ParkRight Explore on the Ohio-inspired garage: 36 spaces seen occupied, empty spaces can’t be confirmed yet, open-space confirmation isn’t enabled in this demo" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
