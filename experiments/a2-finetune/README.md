# ParkRight A2 fine-tuning

This directory contains offline research tooling only. It does not modify A0,
production thresholds, parking calibration, or the production OPEN policy.

## Frozen starting decision

- Model: torchvision `fasterrcnn_resnet50_fpn_v2` initialized from
  `FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1`.
- Target: `bbox_visible` from each canonical label JSON.
- Mapping: sedan, SUV, hatchback, and van become `car`; pickup becomes `truck`.
  Original simulator categories remain in label files and validation reports.
- Reason for collapse: parking occupancy needs vehicle localization, the simulator
  bodies are visually similar, and two targets retain the useful pickup/truck
  distinction without fragmenting 5,042 training instances across five newly
  initialized output classes.
- Evaluation gates remain A0's 0.65 confidence and 0.45 ROI coverage. `allow_open`
  is false. AP is computed independently across score rankings.
- The backbone is frozen for this conservative CPU run; RPN and ROI heads train.
  Input images remain RGB `[0,1]` tensors and torchvision performs its documented
  aspect-preserving resize/normalization. Train-only augmentation is a horizontal
  flip, ±12% brightness/contrast, rare mild blur, and rare JPEG quality 78–95.

The code requires the repository's locked `ssd` optional dependencies:

```bash
uv sync --frozen --all-packages --all-extras
```

## Split safety

`load_records(..., "test")` fails unless supplied a freeze JSON matching the
manifest checksum. Training and validation commands never accept TEST. Only
`freeze.py`, after checking the selected checkpoint and its validation report,
creates this unlock record. Test output must be written outside git and run once.

The canonical manifest is JSONL. Each record points to an image and label JSON;
the loader expects `1280×720` JPEGs, `bbox_visible` XYXY pixel boxes, an original
vehicle class, split/subset/family/kind/environment/seed metadata, and space
polygons/truth in the label. It does not import simulator code.

## Commands

```bash
DATASET="$HOME/.cache/parkright/datasets/a2-sim-v1-b569da957c"
ARTIFACTS="$HOME/.cache/parkright/models/a2-fasterrcnn"

.venv/bin/python experiments/a2-finetune/validate_dataset.py \
  --manifest "$DATASET/manifest.jsonl" \
  --output experiments/a2-finetune/output/dataset-validation.json

.venv/bin/python experiments/a2-finetune/train.py \
  --manifest "$DATASET/manifest.jsonl" --artifacts "$ARTIFACTS"

.venv/bin/python experiments/a2-finetune/evaluate.py \
  --manifest "$DATASET/manifest.jsonl" --checkpoint "$ARTIFACTS/best.pt" \
  --split validation --output "$ARTIFACTS/validation.json"

.venv/bin/python experiments/a2-finetune/freeze.py \
  --manifest "$DATASET/manifest.jsonl" --checkpoint "$ARTIFACTS/best.pt" \
  --validation "$ARTIFACTS/validation.json" --output "$ARTIFACTS/frozen.json"

# Run exactly once after reviewing the frozen record.
.venv/bin/python experiments/a2-finetune/evaluate.py \
  --manifest "$DATASET/manifest.jsonl" --checkpoint "$ARTIFACTS/best.pt" \
  --split test --test-unlock "$ARTIFACTS/frozen.json" \
  --output "$ARTIFACTS/test.json"
```

Model binaries and prediction collections stay under `~/.cache/parkright` and
are never committed. Small final summaries and exact checksums are published in
this directory after the held-out run.

