# A2 model provenance and compliance note

- Architecture: Faster R-CNN ResNet-50-FPN-v2.
- Implementation: official torchvision `fasterrcnn_resnet50_fpn_v2`.
- Installed versions: PyTorch 2.14.1 and torchvision 0.29.1.
- Initialization: `FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1`.
- Official weights URL:
  `https://download.pytorch.org/models/fasterrcnn_resnet50_fpn_v2_coco-dd69338a.pth`.
- Source-weight SHA-256:
  `dd69338a24b8d7381807e247652bdc356325bcbaf1cd3e092e00e0a1a58706bf`.
- Source-weight size: 175,221,657 bytes.
- Upstream recipe: `https://github.com/pytorch/vision/pull/5763`.
- Upstream reported reference metric: COCO val2017 box mAP 46.7.
- torchvision package license metadata: BSD; the installed distribution includes
  its license at `torchvision-0.29.1.dist-info/LICENSE`.
- Pretraining dataset: COCO. Individual COCO images retain their respective source
  licenses; this report does not assert a blanket license over the dataset or
  pretrained parameter artifact beyond upstream distribution facts.

PyTorch Faster R-CNN supports CUDA execution on NVIDIA GPUs, but this experiment
was run on CPU because the available Apple M2 machine exposes neither CUDA nor
MPS to this environment. CUDA compatibility does **not** by itself establish that
this is an NVIDIA-provided/open model under the Nebius × NVIDIA hackathon rules.
Eligibility needs a separate rules review; this work makes no compliance claim.

The fine-tuned checkpoint is stored outside Git. Its path, checksum, byte size,
dataset checksum, training commit, configuration hash, and selected validation
metric are recorded after training and freezing.

