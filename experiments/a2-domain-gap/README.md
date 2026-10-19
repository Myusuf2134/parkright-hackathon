# A2 perception domain-gap research

Offline tooling for explaining why the pinned NVIDIA SSD300 recognizes real COCO-like
photographs but not ParkRight renderer frames. It imports the existing A0 detector but
does not modify its configuration, thresholds, preprocessing, provider, or API path.
`OPEN` remains disabled.

## Inputs

The analyzer accepts the existing A1 `parkright-evaluation-v1` browser export directly:

```sh
uv run --frozen --all-packages --all-extras python experiments/a2-domain-gap/analyze.py \
  --input /path/to/experiments/vertical-slice/runs/evaluation/dataset.json \
  --calibration packages/shared/calibration/cam-01.json \
  --ssd-source "$HOME/.cache/parkright/nvidia-ssd" \
  --ssd-weights "$HOME/.cache/parkright/nvidia-ssd.pt" \
  --real-control experiments/a2-domain-gap/output/bus.jpg \
  --output experiments/a2-domain-gap/output
```

Generated images and full raw reports belong in `output/`, which is ignored. Small,
reviewed report extracts live in `reports/`.

### Claude dataset handoff

No simulator import is required. Point `--input` at a JSON manifest with this exact
shape; image paths are relative to the manifest:

```json
{
  "schema": "parkright-a2-dataset-v1",
  "frames": [
    {
      "frame_id": "unique-stable-id",
      "image_path": "images/frame-000001.jpg",
      "width": 1280,
      "height": 720,
      "split": "train-or-validation-or-test",
      "seed": 4242,
      "preset": "clear_day",
      "objects": [
        {
          "object_id": "stable-id",
          "class": "car",
          "bbox_xyxy": [100, 200, 180, 260],
          "space_id": "A1",
          "occluded": false
        }
      ]
    }
  ]
}
```

`bbox_xyxy` is an axis-aligned box in source-image pixels (`x1,y1,x2,y2`). Empty
frames have an empty `objects` array. The held-out split must be by seed/scene sequence,
not adjacent frames. Extra manifest keys are allowed. Until that manifest exists, A1
object sizes are estimated conservatively by pixel-differencing each occupied frame
against its matched empty frame; those extents include vehicle shadows.

## Scope and interpretation

- Raw SSD results use the existing A0 detector floor (0.01) and NMS (0.5).
- Controlled preprocessing variants operate on copies only.
- Local crops are a scale diagnosis, not a deployable parking detector.
- Optional torchvision alternatives use their documented pretrained weights and
  default score filtering. They are standard PyTorch models that can run on NVIDIA
  CUDA/Nebius, but are not integrated into ParkRight.
- No result here is a held-out accuracy claim.
