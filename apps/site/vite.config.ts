import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The public website. A static build with no API dependency; the only code shared with the
// student app is the pure Arrival Intelligence engine (apps/web/src/driver/arrival), imported as-is;
// the dev server may read the repository root for it and for the hoisted font packages.
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, strictPort: true, fs: { allow: [resolve(import.meta.dirname, '../..')] } },
  preview: { port: 5190, strictPort: true },
});
