import { useState } from 'react';
import { LINKS } from '../config.ts';
import { Action, Reveal, SectionHead, Source } from '../ui/kit.tsx';

type View = 'split' | 'student';

/**
 * Embed the actual running app and presentation (including its own interactive
 * student iframe) instead of a screenshot. Production without hosted app URLs
 * shows an honest static fallback; it never points visitors at localhost.
 */
export function Demo() {
  const [view, setView] = useState<View>('split');
  const hasSplit = Boolean(LINKS.demo);
  const hasStudent = Boolean(LINKS.app);
  const interactive = hasSplit || hasStudent;
  const selected: View = view === 'student' && hasStudent ? 'student' : hasSplit ? 'split' : 'student';
  const src = selected === 'split' ? LINKS.demo : LINKS.app;

  return (
    <section className="section demo md-demo" id="demo" aria-labelledby="demo-title">
      <div className="wrap">
        <SectionHead
          id="demo-title"
          eyebrow="Explore the real prototype"
          title="See both sides of Meridian."
          lede="Use the real student app here. Explore parking, open the garage, plan a departure, and see the simulated AI pipeline beside it."
        />
        {interactive && src ? (
          <div className="md-interactive-demo" data-testid="interactive-demo">
            <div className="md-demo-toolbar">
              <div className="md-demo-toolbar-left">
                <span className="md-live-indicator" aria-hidden="true" />
                <div>
                  <b>Interactive demo</b>
                  <small>Connected to the Meridian app server · simulated garage</small>
                </div>
              </div>
              <div className="md-demo-switch" role="tablist" aria-label="Embedded demo view">
                {hasSplit && <button
                  id="md-demo-tab-split"
                  type="button"
                  role="tab"
                  aria-selected={selected === 'split'}
                  aria-controls="md-demo-panel"
                  data-testid="demo-view-split"
                  onClick={() => setView('split')}
                >Student + AI</button>}
                {hasStudent && <button
                  id="md-demo-tab-student"
                  type="button"
                  role="tab"
                  aria-selected={selected === 'student'}
                  aria-controls="md-demo-panel"
                  data-testid="demo-view-student"
                  onClick={() => setView('student')}
                >Full-size app</button>}
              </div>
            </div>
            <div
              className={'md-demo-viewport ' + (selected === 'student' ? 'md-demo-viewport-student' : 'md-demo-viewport-split')}
              id="md-demo-panel"
              role="tabpanel"
              aria-labelledby={'md-demo-tab-' + selected}
            >
              <iframe
                key={selected}
                className="md-demo-iframe"
                src={src}
                title={selected === 'split' ? 'Interactive Meridian student app and AI presentation' : 'Interactive Meridian student app'}
                data-testid="demo-live-frame"
                loading="lazy"
                allow="fullscreen"
              />
            </div>
            <p className="md-demo-help">Try tapping inside the phone: <b>Explore, Garage, Plan, You.</b> The split view uses the same running simulated data. This is not real campus availability.</p>
          </div>
        ) : (
          <Reveal as="figure" className="browser">
            <div className="browser-bar" aria-hidden><i /><i /><i /><span>/present/ · captured preview</span></div>
            <img
              src="/media/present-split.webp"
              alt="Captured Meridian presentation: the student phone app beside simulated garage occupancy and an AI pipeline"
              width={2000}
              height={1250}
              loading="lazy"
            />
            <figcaption>
              <Source tone="demo">Screenshot only</Source>
              This captured preview is not interactive. The real app runs locally and can be embedded when a hosted app URL is configured.
            </figcaption>
          </Reveal>
        )}
        <div className="demo-row">
          <p className="demo-modes"><b>Student</b><span aria-hidden>·</span><b>Split</b><span aria-hidden>·</span><b>Live AI</b><em>the same simulated garage state</em></p>
          <div className="actions">
            <Action to="app" testid="cta-demo-app">Open Student App</Action>
            <Action to="demo" kind="secondary" testid="cta-demo">Open Live Demo</Action>
            {LINKS.walkthrough && <a className="btn btn-secondary" href={LINKS.walkthrough} target="_blank" rel="noreferrer" data-testid="cta-walkthrough">Watch recorded walkthrough</a>}
          </div>
        </div>
      </div>
    </section>
  );
}
