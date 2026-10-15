# Detector arms

Each arm is a way of training the occupancy detector. All of them are served to the backend the same
way: as a `PerceptionProvider` (services/perception) that turns one JPEG frame into one
`SpaceInference` per watched space. The camera contract never changes between arms.

| Arm | Training data |
| --- | --- |
| [a0-baseline](a0-baseline/) | Baseline model, no adverse-condition training |
| [a1-augmentation](a1-augmentation/) | Classic image augmentation (blur, noise, brightness, synthetic rain) |
| [a2-simulator](a2-simulator/) | Frames rendered by our simulator under adverse presets |
| [a3-cosmos](a3-cosmos/) | NVIDIA Cosmos-generated synthetic adverse conditions |

Every arm is scored on the same held-out simulator sessions by [evaluation/](../evaluation/), against
ground truth that the arm itself never sees at inference time.

Weights, datasets and run outputs are not committed (see `.gitignore`).
