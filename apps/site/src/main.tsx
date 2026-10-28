import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Site } from './Site.tsx';
import './site.css';
import './meridian.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
