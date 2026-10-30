import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const api = process.env.PARKRIGHT_API_URL ?? 'http://127.0.0.1:8400';

export default defineConfig({
  plugins: [react()],
  server: {
    // Only the active Cloudflare quick tunnel; update when the tunnel is restarted.
    allowedHosts: ['prescription-polo-framed-study.trycloudflare.com'],
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
