# Model eligibility: UNVERIFIED

Audit date: 2026-10-19. This is a model eligibility check, not a claim that the entire submission meets every rule.

The organizer's [official rules, Project Requirements](https://nebiusglobalaihackathon.devpost.com/rules) require a working application running on Nebius Token Factory or Nebius AI Cloud and using at least one NVIDIA open-source model. The rules also distinguish tracks; the Physical AI description names Nemotron, GROOT, Cosmos and Sonic. The [official FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) permits simulation-based Physical AI demonstrations but retains the platform/model requirements.

A2 uses torchvision Faster R-CNN ResNet-50-FPN-v2 initialized from torchvision COCO_V1 weights and then fine-tuned locally. Neither official challenge source explicitly identifies those torchvision weights as a qualifying NVIDIA model. CUDA compatibility is not proof of NVIDIA model provenance. Running this checkpoint on Nebius would establish platform usage, not automatically model eligibility.

Exact organizer confirmation needed: Does torchvision FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1 (and its ParkRight fine-tune) satisfy the NVIDIA open-source-model requirement? If not, must ParkRight meaningfully use a separately qualifying NVIDIA-provided model, and which Physical AI track requirements apply to this simulation-based parking application?

No eligibility approval has been obtained. No model replacement, additional model integration, or organizer contact was performed. Retain A2 on technical merit while seeking clarification separately.
