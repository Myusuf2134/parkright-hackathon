import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const api = process.env.PARKRIGHT_API_URL ?? 'http://127.0.0.1:8400';

export default defineConfig({
  plugins: [react()],
  server: {
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
