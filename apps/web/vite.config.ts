import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.PARKRIGHT_API_URL ?? 'http://127.0.0.1:8400';

/**
 * MapLibre's tile worker, served byte for byte from public/. Vite's dev server would inject its client into
 * the file (WebKit refuses that in a worker), and a production build can't see MapLibre's own path to it.
 */
function mapWorker(): Plugin {
  return {
    name: 'meridian-map-worker',
    buildStart() {
      const entry = createRequire(import.meta.url).resolve('maplibre-gl/package.json');
      copyFileSync(resolve(entry, '../dist/maplibre-gl-worker.mjs'), resolve(import.meta.dirname, 'public/app/maplibre-worker.mjs'));
    },
  };
}

const { MERIDIAN_HTTPS_CERT: cert, MERIDIAN_HTTPS_KEY: key } = process.env;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;

export default defineConfig({
  plugins: [react(), mapWorker()],
  server: {
    https,
    // Only the active Cloudflare quick tunnel; update when the tunnel is restarted.
    allowedHosts: ['joined-warming-stars-changing.trycloudflare.com'],
    // Vite's default (localhost only) plus the Meridian site, which probes /api/v1/health before embedding.
    cors: { origin: [/^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, 'https://meridian-site-murex.vercel.app', 'https://meridian-site-mmoodyy21-2297s-projects.vercel.app'] },
    port: 5180,
    strictPort: true,
    // The browser only talks to this origin; the API URL never reaches client code.
    proxy: { '/api': { target: api, ws: true, changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      // The legacy screens stay at /, the driver app lives at /app/, the presentation at /present/.
      input: { main: resolve(import.meta.dirname, 'index.html'), app: resolve(import.meta.dirname, 'app/index.html'), present: resolve(import.meta.dirname, 'present/index.html') },
    },
  },
});
