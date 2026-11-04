import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.PARKRIGHT_API_URL ?? 'http://127.0.0.1:8400';

/**
 * MapLibre's tile worker at /app/maplibre-worker.mjs, byte for byte from node_modules. Vite's transform would
 * inject its client into the file (WebKit refuses that in a worker), and a production build can't see MapLibre's
 * own path to it. It used to be copied into public/ at startup, but Vite indexes public/ before plugins run, so on
 * a fresh checkout the dev server answered with index.html: the worker died and every tile stayed blank.
 */
const WORKER_PATH = '/app/maplibre-worker.mjs';
const workerFile = () => resolve(createRequire(import.meta.url).resolve('maplibre-gl/package.json'), '../dist/maplibre-gl-worker.mjs');
function mapWorker(): Plugin {
  const serve = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== WORKER_PATH) return next();
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(readFileSync(workerFile()));
    });
  };
  return {
    name: 'meridian-map-worker',
    configureServer: serve,
    configurePreviewServer: serve,
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKER_PATH.slice(1), source: readFileSync(workerFile()) });
    },
  };
}

const { MERIDIAN_HTTPS_CERT: cert, MERIDIAN_HTTPS_KEY: key } = process.env;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;

export default defineConfig({
  plugins: [react(), mapWorker()],
  server: {
    https,
    // Cloudflare quick tunnels get a new hostname each time they start.
    allowedHosts: ['.trycloudflare.com'],
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
