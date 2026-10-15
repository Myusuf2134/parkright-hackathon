"""Canonical ParkRight wire contracts. JSON Schema in ../../schema, TypeScript in ../../ts."""

from .evaluation import EnvironmentPreset, GroundTruthLabel, GroundTruthRecord, GroundTruthSpace
from .facility import (
    Camera,
    CameraConfig,
    Facility,
    FacilityConfig,
    FacilityOccupancy,
    Level,
    LevelConfig,
    SpaceConfig,
)
from .geometry import Point, Rect
from .frame import (
    FRAME_CONTENT_TYPE,
    FRAME_CONTRACT_VERSION,
    FRAME_IMAGE_PART,
    FRAME_MAX_BYTES,
    FRAME_METADATA_MAX_BYTES,
    FRAME_METADATA_PART,
    FrameIngestResult,
    FrameMetadata,
    FrameOutcome,
    looks_like_jpeg,
)
from .ids import IDENTIFIER_PATTERN, CameraId, FacilityId, Identifier, LevelId, SessionId, SpaceId, Timestamp
from .occupancy import (
    MIN_OPEN_CONFIDENCE,
    FrameRef,
    ModelRef,
    OccupancyChange,
    OccupancyCounts,
    OccupancyObservation,
    OccupancyState,
    OccupancyUpdateMessage,
    ParkingSpace,
    SpaceDesignation,
    count_states,
    is_confirmed_available,
    safe_state,
)
from .realtime import FacilitySnapshotMessage, RealtimeMessage

