"""EVALUATION-ONLY positive empty-space evidence. OPEN REMAINS DISABLED.

Computes, per calibrated space, whether there is enough *positive* evidence that the bay
is empty (``open_ready``) from production inputs only: the JPEG pixels, the calibration
polygons, the detector's boxes and the detector/calibration/frame status. It never sees
simulator ground truth and never changes occupancy: nothing in the production frame path
imports this package (pinned by tests), and production state stays OCCUPIED/UNCERTAIN
with ``allow_open`` false.
"""

from .frame import EmptyReference, EvidenceConfig, FrameContext, SpaceFrameEvidence, ViewGeometry, frame_evidence
from .temporal import SpaceOpenEvidence, TemporalTracker

__all__ = [
    "EmptyReference", "EvidenceConfig", "FrameContext", "SpaceFrameEvidence", "SpaceOpenEvidence", "TemporalTracker", "ViewGeometry", "frame_evidence",
]
