import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DriverApp } from './DriverApp.tsx';
import './styles.css';

// ?device=iphone15 simulates standalone-PWA safe areas, for screenshots and design review.
const device = new URLSearchParams(location.search).get('device');
if (device) document.documentElement.dataset.device = device;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DriverApp />
  </StrictMode>,
);
