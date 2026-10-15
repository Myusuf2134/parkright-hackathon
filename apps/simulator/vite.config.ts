import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read PARKRIGHT_* from the environment or the repo's .env. Only the dev server sees them.
  const env = { ...loadEnv(mode, repoRoot, 'PARKRIGHT_'), ...process.env };
  const api = env.PARKRIGHT_API_URL ?? 'http://127.0.0.1:8400';
  const token = env.PARKRIGHT_INGEST_TOKEN;

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(env.PARKRIGHT_SIM_PORT ?? 5181),
      strictPort: true,
      proxy: {
        '/api': {
          target: api,
          ws: true,
          changeOrigin: true,
          // The ingest token is attached here, server-side; it is never shipped to the browser.
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (token) req.setHeader('authorization', `Bearer ${token}`);
            });
          },
        },
      },
    },
    test: { environment: 'node', include: ['test/**/*.test.ts'] },
  };
});
