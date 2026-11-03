import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DriverApp } from './DriverApp.tsx';
import './styles.css';

// ?device=iphone15 simulates standalone-PWA safe areas, for screenshots and design review.
const device = new URLSearchParams(location.search).get('device');
if (device) document.documentElement.dataset.device = device;

// Desktop preview scale for the framed phone (styles.css, min-width 720px): the 393 × 852 screen plus its
// 14 px bezel, at most ~750 px tall, shrinking with shorter or narrower windows. Phones ignore it.
const fit = () => {
  const s = Math.min(752 / 880, (innerHeight - 40) / 880, (innerWidth - 40) / 421);
  document.documentElement.style.setProperty('--fit', String(Math.max(0.4, s).toFixed(4)));
};
fit();
addEventListener('resize', fit);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DriverApp />
  </StrictMode>,
);

// The on-screen keyboard shrinks the visual viewport on iOS, not the layout one: sheets ride above it.
const keyboard = () => {
  const v = visualViewport;
  document.documentElement.style.setProperty('--kb', `${v ? Math.max(0, innerHeight - v.height - v.offsetTop) : 0}px`);
};
visualViewport?.addEventListener('resize', keyboard);
visualViewport?.addEventListener('scroll', keyboard);

// Offline shell for the built app only. The worker never touches /api, so availability is never cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).then(async () => {
    const ready = await navigator.serviceWorker.ready;
    const assets = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin) && !u.includes('/api/'));
    ready.active?.postMessage({ type: 'cache', urls: assets });
  }).catch(() => { /* no worker (e.g. plain http on a phone): the app still works online */ });
}
