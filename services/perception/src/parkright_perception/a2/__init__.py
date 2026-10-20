"""A2 pixel-only Faster R-CNN detector, fine-tuned on the offline simulator dataset.

Only the detector differs from A0: occupancy is still decided by the calibrated
space mapper (A0Provider) with the same thresholds and OPEN disabled.
"""
