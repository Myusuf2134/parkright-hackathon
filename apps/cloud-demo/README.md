# Meridian Option A cloud demo

Browser-only interactive 72-space parking simulation; all occupancy and recommendations are demo-generated, not NVIDIA camera inference or Nemotron calls. Mac-independent. The original local NVIDIA demo remains unchanged.

Serve this folder as static assets. `vercel.json` provides an optional read-only proxy to Render for health checks; the simulation deliberately has no dependency on the API.

Test with a local static server or Vercel preview. Distinguish this public simulation from the A2 AI technical demo.
