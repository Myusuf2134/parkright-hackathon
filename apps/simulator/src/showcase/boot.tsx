/** Boots the 34-space showcase (?showcase=1&sim=garage). Loaded lazily; the other labs never load it. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShowcaseLab } from './lab.ts';
import { parseShowcaseUrl, ShowcaseApp } from './ShowcaseApp.tsx';
import { ShowcaseStreamer } from './streamer.ts';

export function boot(): void {
  const { scenario, preset, stream } = parseShowcaseUrl();
  const lab = new ShowcaseLab(scenario, preset);
  const streamer = new ShowcaseStreamer(lab);
  streamer.start();
  if (stream) streamer.setRunning(true);
  if (import.meta.env.DEV) Object.assign(window, { __showcase: { lab, streamer } });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ShowcaseApp lab={lab} streamer={streamer} />
    </StrictMode>,
  );
}
