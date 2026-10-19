# ParkRight A2 perception/domain-gap report

## Decision

**Outcome B: a stronger zero-shot, NVIDIA-CUDA-compatible detector materially
outperforms SSD300 on the same simulator pixels.** Torchvision Faster R-CNN
ResNet-50-FPN-v2 detects a vehicle in all 13 positive frames, versus SSD300 producing
no settled-frame vehicle score above 0.053. This does not make Faster R-CNN ready for
production: at the unchanged A0 confidence (0.65) and polygon-coverage (0.45) gates,
only 37/116 occupied space instances pass. The next step is evaluation on Claude's
canonical labeled dataset, not a threshold reduction, production integration, or
training.

The evidence does not support simulator graphics work as the first response. Scale and
preprocessing contribute, but neither explains the failure by itself. The main issue is
SSD300's learned feature/domain mismatch with the renderer's simple vehicles.

## Dataset and method

- Replayed all 18 A1 evaluation frames: 16 settled combinations (two seeds, day/night,
  0/4/10/12 occupied), one occlusion case, and one transition.
- Thirteen frames contain occupied-space ground truth; five are empty/transition cases.
- Images are 1280×720 JPEGs. Source bundle SHA-256 is recorded in
  `reports/baseline-summary.json`.
- SSD raw detections use the unchanged A0 detector floor of 0.01 and NMS of 0.5.
- Difference-derived object sizes compare occupied frames with matched empty frames.
  They include shadows and are a proxy until exact exported boxes arrive.
- Alternative-model space metrics are diagnostic. "Any overlap" is deliberately
  separated from the unchanged A0 0.65-confidence/0.45-coverage gate.

## SSD300 baseline

- 12,940 raw class detections at the existing 0.01 floor; 128 have vehicle classes.
- 105/128 vehicle scores are 0.01–0.02; 21 are 0.02–0.05.
- No frame has a vehicle score at or above 0.65.
- Highest score across all frames is 0.435, from the transition frame rather than a
  settled positive case.
- Settled/positive copied frames peak at 0.053; their median top score is 0.0218.
- Warm replay latency: mean 90.3 ms, median 89.2 ms, p95 118.1 ms on CPU.
- In 116 occupied calibrated regions, the highest raw class is keyboard (56), chair
  (33), cell phone (13), book (11), traffic light (2), or bed (1)—never a vehicle.
- The photographic control remains healthy: bus 0.974, with the pinned model identity
  and the expected checkpoint/source hashes.

These results locate the failure inside classification features, before occupancy
postprocessing. Lowering the occupancy threshold would mainly promote noise.

## Preprocessing audit

The production A0 path is internally consistent:

- Pillow decodes JPEG and explicitly converts to RGB; observed frames are RGB without
  alpha or EXIF orientation.
- Source pixels are uint8 `[0,255]`, converted to HWC float32, normalized to `[-1,1]`,
  transposed to NCHW RGB, and passed to SSD300.
- The entire 1280×720 frame is resized to 300×300 with bilinear interpolation.
- There is no RGB/BGR swap, unexpected value range, dtype error, center crop, or alpha
  leak.
- The full-frame stretch magnifies the vertical dimension 1.7778× relative to the
  horizontal dimension. This is real distortion, but letterboxing does not close the
  confidence gap.
- Production does not apply EXIF transpose. That is irrelevant to these generated
  frames because they have no EXIF orientation, but should be documented for future
  real-camera inputs.

## Object scale

Difference-derived vehicle-plus-shadow extents after SSD resize are approximately:

- Far row: median 37.7×38.8 px and 1.67% of the source image.
- Near row: median 77.1×96.3 px and 8.20% of the source image.
- SSD300's smallest nominal anchor scale is 21 px; none of the difference extents is
  narrower than that.
- Width versus raw vehicle confidence has Pearson `r = 0.004`, effectively no
  relationship in this small set.
- Far regions contain a raw vehicle candidate in 46/70 cases, versus 14/46 near cases;
  all scores remain extremely weak.

Small/distant cars are therefore not the dominant explanation. The real control bus is
much larger (about 285×153 px at SSD input), so absolute scale helps explain the
photographic-control contrast, but it does not explain SSD's failure on the large near
simulator vehicles.

## Controlled image copies

No tested preprocessing change produces a score at or above 0.65:

- Baseline: max 0.053, median 0.0218.
- Aspect-preserving gray letterbox: max 0.337, median 0.0281.
- Bicubic or Lanczos pre-resize: max 0.064/0.068.
- Autocontrast, +20% contrast, +20% brightness, gamma 0.8/1.2: max 0.047–0.069.
- JPEG quality 50/95 round trips: max 0.061/0.052.
- 116 expanded object-local crops: max 0.266; zero pass 0.65.

Letterboxing and cropping demonstrate some sensitivity to geometry/scale, but their
best gains remain far below a trustworthy detector response. None is recommended for
production from this evidence.

## Real versus synthetic evidence

Compared with the real bus photograph, simulator frames have:

- About 3.4× lower mean edge strength (7.86 versus 26.74).
- About 4.3× lower density of strong edges (0.093 versus 0.402).
- Lower luminance variation (mean standard deviation 43.8 versus 68.0).
- Flat-shaded bodies, simplified wheels/windows, repeated hard-edged geometry, weak
  material texture, and stylized overhead perspective.
- Large low-texture parking/building regions that SSD misclassifies as indoor COCO
  objects such as keyboards and chairs.

The evidence ranks likely causes as: (1) feature/texture and shape domain mismatch,
(2) viewpoint/context mismatch, (3) 16:9-to-square distortion, and only then (4) small
far-object scale. Lighting changes scores but both day and night remain failures.

## Alternative pretrained models

Both alternatives use already-compatible PyTorch/torchvision tooling and can run on
NVIDIA CUDA/Nebius without changing ParkRight's contracts or architecture. They were
not integrated into the application.

- SSDLite320-MobileNet-V3: vehicles in 1/13 positive frames; 4/116 occupied spaces have
  any vehicle overlap; 0/116 pass the unchanged A0 gate; max 0.086; mean 78 ms CPU.
- Faster R-CNN ResNet-50-FPN-v2: vehicles in 13/13 positive frames; all 116 occupied
  space instances have some vehicle-box overlap; top scores reach 0.939. At the
  unchanged A0 gate, 37/116 occupied instances pass and 0/100 empty instances produce
  a qualified false OCCUPIED. Mean CPU latency is 3.07 s (p95 3.92 s).
- Faster R-CNN's top positive-frame vehicle is `truck` in 10 frames and `car` in 3,
  consistent with coarse rendered body shapes rather than exact subtype recognition.

The per-space numbers are not final precision/recall: large boxes can overlap adjacent
ROIs, and A1 lacks exact object boxes. They are sufficient to show a large, reproducible
model-family difference on identical pixels.

## Recommendation and Claude handoff

Do not change SSD thresholds, enable OPEN, or fine-tune yet. Preserve SSD300 as the A0
baseline and evaluate Faster R-CNN on the canonical dataset first. If its held-out
space recall and false-occupied/false-open behavior remain acceptable, pursue an A2
provider experiment on GPU. Its CPU latency is unsuitable for the current live target;
GPU measurement and possibly a lighter FPN detector would be required later.

Claude should make **no graphics change solely to rescue SSD300**. For the dataset
handoff, export:

- tight source-pixel `bbox_xyxy` for every visible vehicle;
- stable `frame_id` and `object_id`;
- COCO-compatible coarse class plus `space_id`;
- occlusion/truncation flags;
- width, height, seed, environment preset, and split;
- empty frames and difficult/occluded frames;
- train/validation/test separation by seed or scene sequence, never adjacent frames.

The exact accepted `parkright-a2-dataset-v1` manifest is documented in the adjacent
README. Run the analyzer by changing only `--input /path/to/manifest.json`.

## Limitations

- Eighteen frames and two seeds are diagnostic, not held-out accuracy evidence.
- A1 has occupancy labels but not exact object boxes; object scale uses image
  differencing and includes shadows.
- The real comparison contains one very large bus photograph, not a matched parking
  camera dataset.
- Alternative CPU timings are single-process workstation measurements.
- No CUDA/GPU benchmark, production provider integration, training, threshold change,
  OPEN classification, or Nebius work was performed.
