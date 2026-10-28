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
