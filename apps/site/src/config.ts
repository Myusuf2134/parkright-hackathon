/**
 * Where the buttons go. Nothing here points at localhost in a production build: set the hosted URLs
 * at build time (VITE_PARKRIGHT_*), or the buttons fall back to the demo section and its offline preview.
 * In `vite dev` they default to the local demo (npm run demo:ohio serves the web app on :5180).
 */
const env = import.meta.env;
const dev = (path: string) => (env.DEV ? `http://localhost:5180${path}` : null);

export const LINKS = {
  app: env.VITE_PARKRIGHT_APP_URL || dev('/app/'),
  demo: env.VITE_PARKRIGHT_DEMO_URL || dev('/present/'),
  /** A recorded walkthrough, if one has been published. Labelled as a recording wherever it appears. */
  walkthrough: env.VITE_PARKRIGHT_WALKTHROUGH_URL || null,
  repo: env.VITE_PARKRIGHT_REPO_URL || 'https://github.com/Myusuf2134/parkright-hackathon',
} as const;

/** Where demo buttons go while the hosted demo is unconfigured or unreachable: the demo section. */
export const RUN_ANCHOR = '#demo';
