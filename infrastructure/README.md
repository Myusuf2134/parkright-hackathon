# Infrastructure

- [nebius/](nebius/) — Nebius AI Cloud deployment (GPU inference for detector arms). Not started.
- [docker/](docker/) — container images for the API and perception. Not started.

Secrets (Nebius, NVIDIA API keys) are read from the environment on the server side only. They are never
committed and never sent to the web app or the simulator.
