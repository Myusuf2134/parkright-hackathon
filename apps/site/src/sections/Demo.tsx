import { useState } from 'react';
import { LINKS } from '../config.ts';
import { checkDemo, useDemoStatus, type DemoStatus } from '../demoStatus.ts';
import { Action, Reveal, SectionHead, Source } from '../ui/kit.tsx';

type View = 'split' | 'student';

/**
 * Embed the actual running app and presentation (including its own interactive student iframe) only
 * after the demo server has answered a health check. Otherwise show a captured preview that says
 * plainly it is not connected; it never points visitors at localhost or a dead tunnel.
 */
export function Demo() {
  const status = useDemoStatus();
  const live = status.state === 'live';

  return (
    <section className="section demo md-demo" id="demo" aria-labelledby="demo-title">
      <div className="wrap">
        <SectionHead
          id="demo-title"
          eyebrow="Explore the real prototype"
          title="See both sides of Meridian."
          lede="Use the real student app here. Explore parking, open the garage, plan a departure, and see the simulated AI pipeline beside it."
        />
        {live ? <LiveDemo status={status} /> : <OfflineDemo status={status} />}
        <div className="demo-row">
          <p className="demo-modes"><b>Student</b><span aria-hidden>·</span><b>Split</b><span aria-hidden>·</span><b>Live AI</b><em>the same simulated garage state</em></p>
          <div className="actions">
            {live && <Action to="app" testid="cta-demo-app">Open Student App</Action>}
            {live && <Action to="demo" kind="secondary" testid="cta-demo">Open Live Demo</Action>}
            {LINKS.walkthrough && <a className="btn btn-secondary" href={LINKS.walkthrough} target="_blank" rel="noreferrer" data-testid="cta-walkthrough">Watch recorded walkthrough</a>}
          </div>
        </div>
      </div>
    </section>
  );
}

function LiveDemo({ status }: { status: Extract<DemoStatus, { state: 'live' }> }) {
  const [view, setView] = useState<View>('split');
  const hasSplit = Boolean(LINKS.demo);
  const hasStudent = Boolean(LINKS.app);
  const selected: View = view === 'student' && hasStudent ? 'student' : hasSplit ? 'split' : 'student';
  const src = selected === 'split' ? LINKS.demo : LINKS.app;
  const detector = status.detectorReady ? `A2 detector ready${status.cpu ? ' (CPU)' : ''}` : 'A2 detector still warming up';

  return (
    <div className="md-interactive-demo" data-testid="interactive-demo" data-demo-state="live">
      <div className="md-demo-toolbar">
        <div className="md-demo-toolbar-left">
          <span className="md-live-indicator" aria-hidden="true" />
          <div>
            <b>Interactive demo · server reachable</b>
            <small data-testid="demo-status-detail">{detector} · simulated garage</small>
          </div>
        </div>
        <div className="md-demo-switch" role="tablist" aria-label="Embedded demo view">
          {hasSplit && <button id="md-demo-tab-split" type="button" role="tab" aria-selected={selected === 'split'} aria-controls="md-demo-panel" data-testid="demo-view-split" onClick={() => setView('split')}>Student + AI</button>}
          {hasStudent && <button id="md-demo-tab-student" type="button" role="tab" aria-selected={selected === 'student'} aria-controls="md-demo-panel" data-testid="demo-view-student" onClick={() => setView('student')}>Full-size app</button>}
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
          src={src ?? undefined}
          title={selected === 'split' ? 'Interactive Meridian student app and AI presentation' : 'Interactive Meridian student app'}
          data-testid="demo-live-frame"
          loading="lazy"
          allow="fullscreen"
        />
      </div>
      <p className="md-demo-help">Try tapping inside the phone: <b>Explore, Garage, Plan, You.</b> Served from a developer machine through a temporary tunnel. Garage, cameras and traffic are simulated; this is not real campus availability.</p>
    </div>
  );
}

function OfflineDemo({ status }: { status: DemoStatus }) {
  const checking = status.state === 'checking';
  const configured = status.state !== 'unconfigured';
  const title = checking ? 'Checking the demo server…' : configured ? 'Live demo is offline' : 'Interactive demo not hosted';
  const detail = checking
    ? 'Nothing is embedded until the server answers.'
    : configured
      ? 'The interactive demo runs on a developer laptop through a temporary tunnel, and it is not reachable right now.'
      : 'This build has no hosted demo configured. The app, API, simulator and A2 detector run locally.';

  return (
    <div className="md-interactive-demo md-demo-offline" data-testid="demo-offline" data-demo-state={status.state} aria-live="polite">
      <div className="md-demo-toolbar">
        <div className="md-demo-toolbar-left">
          <span className={'md-status-indicator' + (checking ? ' checking' : '')} aria-hidden="true" />
          <div>
            <b data-testid="demo-status-title">{title}</b>
            <small>{detail}</small>
          </div>
        </div>
        {configured && !checking && (
          <button type="button" className="md-demo-retry" data-testid="demo-retry" onClick={() => void checkDemo()}>Try again</button>
        )}
      </div>
      <Reveal as="figure" className="md-demo-preview">
        <img
          src="/media/present-split.webp"
          alt="Captured Meridian presentation: the student phone app beside simulated garage occupancy and an AI pipeline"
          width={2000}
          height={1250}
          loading="lazy"
        />
        <figcaption>
          <Source tone="demo">Captured screenshot</Source>
          <span>Not live and not interactive. Recorded earlier from the same app on the simulated garage.</span>
        </figcaption>
      </Reveal>
      <p className="md-demo-help">
        Run it yourself: <code>npm run demo:ohio</code> starts the API, simulator, A2 detector and app; then open <code>localhost:5180/present/</code>.{' '}
        <a href={LINKS.repo} target="_blank" rel="noreferrer" data-testid="cta-repo">Source on GitHub ↗</a>
      </p>
    </div>
  );
}
