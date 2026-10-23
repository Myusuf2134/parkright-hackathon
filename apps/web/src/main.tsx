import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { fetchScenario, type Scenario } from './demo/api.ts';
import { DemoApp } from './demo/DemoApp.tsx';
import './styles.css';

/** In demo mode (the API serves /api/v1/demo) the demo screen is shown; ?classic=1 keeps the original app. */
function Root() {
  const classic = new URLSearchParams(location.search).get('classic') === '1';
  const [scenario, setScenario] = useState<Scenario | null | undefined>(classic ? null : undefined);
  useEffect(() => {
    if (!classic) void fetchScenario().then(setScenario);
  }, [classic]);
  if (scenario === undefined) return null;
  return scenario ? <DemoApp scenario={scenario} /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
