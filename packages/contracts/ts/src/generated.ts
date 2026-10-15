/* Generated from packages/contracts/schema/contracts.schema.json — do not edit. Run `npm run contracts:generate`. */

/**
 * Who may legally park in a space. Drivers are only offered spaces they may use.
 */
export type SpaceDesignation = 'standard' | 'accessible' | 'ev' | 'reserved';
/**
 * UNCERTAIN whenever evidence is missing, weak or stale.
 */
export type OccupancyState = 'OPEN' | 'OCCUPIED' | 'UNCERTAIN';
/**
 * Who may legally park in a space. Drivers are only offered spaces they may use.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "SpaceDesignation".
 */
export type SpaceDesignation1 = 'standard' | 'accessible' | 'ev' | 'reserved';
/**
 * OPEN: the camera saw the space and it is empty.
 * OCCUPIED: the camera saw a vehicle in the space.
 * UNCERTAIN: anything else — no model, weak evidence, obstruction, stale data,
 * camera silent. UNCERTAIN is never presented as availability.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "OccupancyState".
 */
export type OccupancyState1 = 'OPEN' | 'OCCUPIED' | 'UNCERTAIN';
/**
 * accepted: new frame; perception ran; parking state updated.
 * duplicate: same (camera, session, seq) already processed. Nothing done; safe to retry.
 * out_of_order: seq lower than one already processed in this session. Dropped.
 * stale: in order, but captured too long ago. seq recorded; state untouched.
 * superseded_session: from a session this camera has since replaced. Dropped.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FrameOutcome".
 */
export type FrameOutcome = 'accepted' | 'duplicate' | 'out_of_order' | 'stale' | 'superseded_session';
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "GroundTruthLabel".
 */
export type GroundTruthLabel = 'occupied' | 'empty';

export interface ParkRightContracts {}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "Camera".
 */
export interface Camera {
  camera_id: string;
  facility_id: string;
  kind: 'virtual' | 'physical';
  last_frame_at: string | null;
  level_id: string;
  name: string;
  /**
   * A frame arrived within the staleness window.
   */
  online: boolean;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "CameraConfig".
 */
export interface CameraConfig {
  camera_id: string;
  kind: 'virtual' | 'physical';
  level_id: string;
  name: string;
  /**
   * Space outlines in this camera's image (calibration). Empty until the view is fixed.
   */
  polygons?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$".
     */
    [k: string]: Point[];
  };
  /**
   * @minItems 1
   */
  watches: [string, ...string[]];
}
/**
 * Normalised 0…1, origin top-left.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "Point".
 */
export interface Point {
  x: number;
  y: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "EnvironmentPreset".
 */
export interface EnvironmentPreset {
  /**
   * 0 = none, 1 = the most severe the simulator renders.
   */
  intensity: number;
  lighting: 'day' | 'dusk' | 'night';
  name: string;
  preset_id: string;
  weather: 'clear' | 'overcast' | 'rain' | 'fog' | 'snow';
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "Facility".
 */
export interface Facility {
  address: string | null;
  cameras: Camera[];
  counts: OccupancyCounts;
  facility_id: string;
  /**
   * True for a virtual environment. Always label it as such.
   */
  is_simulated: boolean;
  levels: Level[];
  /**
   * Only set for a real, surveyed location (x=longitude, y=latitude).
   */
  location: Point | null;
  name: string;
  updated_at: string | null;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "OccupancyCounts".
 */
export interface OccupancyCounts {
  occupied: number;
  open: number;
  total: number;
  uncertain: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "Level".
 */
export interface Level {
  facility_id: string;
  level_id: string;
  name: string;
  ordinal: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FacilityConfig".
 */
export interface FacilityConfig {
  address?: string | null;
  /**
   * @minItems 1
   */
  cameras: [CameraConfig, ...CameraConfig[]];
  facility_id: string;
  is_simulated: boolean;
  /**
   * @minItems 1
   */
  levels: [LevelConfig, ...LevelConfig[]];
  name: string;
  /**
   * @minItems 1
   */
  spaces: [SpaceConfig, ...SpaceConfig[]];
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "LevelConfig".
 */
export interface LevelConfig {
  level_id: string;
  name: string;
  ordinal?: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "SpaceConfig".
 */
export interface SpaceConfig {
  designation?: SpaceDesignation;
  level_id: string;
  plan: Rect;
  space_id: string;
}
/**
 * Where the space sits on the level plan.
 */
export interface Rect {
  h: number;
  w: number;
  x: number;
  y: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FacilityOccupancy".
 */
export interface FacilityOccupancy {
  counts: OccupancyCounts;
  facility_id: string;
  generated_at: string;
  spaces: ParkingSpace[];
}
/**
 * Current belief about one space, as served to clients.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "ParkingSpace".
 */
export interface ParkingSpace {
  confidence: number | null;
  current_state: OccupancyState;
  designation: SpaceDesignation1;
  facility_id: string;
  frame_seq: number | null;
  /**
   * Server time of the last frame that observed this space. Null = never observed.
   */
  last_observed_at: string | null;
  level_id: string;
  model: ModelRef | null;
  plan: Rect1;
  source_camera_id: string | null;
  space_id: string;
  /**
   * True when current_state is UNCERTAIN only because the evidence is too old.
   */
  stale: boolean;
}
/**
 * Which perception implementation produced an observation (e.g. A0 baseline, A3 Cosmos).
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "ModelRef".
 */
export interface ModelRef {
  provider: string;
  version: string;
}
/**
 * Where the space sits on its level plan (normalised, origin top-left).
 */
export interface Rect1 {
  h: number;
  w: number;
  x: number;
  y: number;
}
/**
 * Sent once on connect: the whole current state, so clients never start from partial data.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FacilitySnapshotMessage".
 */
export interface FacilitySnapshotMessage {
  facility: Facility;
  spaces: ParkingSpace[];
  type: 'facility_snapshot';
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FrameIngestResult".
 */
export interface FrameIngestResult {
  camera_id: string;
  /**
   * Spaces whose driver-visible state changed.
   */
  changed: number;
  detail: string | null;
  /**
   * seq values skipped since the previous processed frame.
   */
  gap: number;
  model: ModelRef | null;
  /**
   * Empty unless outcome is accepted.
   */
  observations: OccupancyObservation[];
  outcome: FrameOutcome;
  seq: number;
  session_id: string;
}
/**
 * One space, as inferred from one camera frame. Produced only by the perception pipeline.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "OccupancyObservation".
 */
export interface OccupancyObservation {
  camera_id: string;
  captured_at: string;
  /**
   * The model's score for `state`, or null when no model scored it.
   */
  confidence: number | null;
  frame_seq: number;
  model: ModelRef;
  session_id: string;
  sim_time_ms: number;
  space_id: string;
  state: OccupancyState1;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FrameMetadata".
 */
export interface FrameMetadata {
  camera_id: string;
  /**
   * Wall-clock capture time. Used only for staleness, never for ordering.
   */
  captured_at: string;
  /**
   * Strictly increasing within (camera_id, session_id). Gaps allowed.
   */
  seq: number;
  /**
   * One run of this camera's stream. Change it whenever seq restarts.
   */
  session_id: string;
  /**
   * Simulation clock, ms. Non-decreasing within a session.
   */
  sim_time_ms: number;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "FrameRef".
 */
export interface FrameRef {
  camera_id: string;
  received_at: string;
  seq: number;
  session_id: string;
}
/**
 * What the simulator knows was true when it rendered frame ``seq``.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "GroundTruthRecord".
 */
export interface GroundTruthRecord {
  camera_id: string;
  environment_preset: string | null;
  seq: number;
  session_id: string;
  sim_time_ms: number;
  /**
   * @minItems 1
   * @maxItems 500
   */
  spaces: [GroundTruthSpace, ...GroundTruthSpace[]];
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "GroundTruthSpace".
 */
export interface GroundTruthSpace {
  space_id: string;
  truth: GroundTruthLabel;
}
/**
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "OccupancyChange".
 */
export interface OccupancyChange {
  confidence: number | null;
  level_id: string;
  previous_state: OccupancyState1;
  reason: 'observation' | 'stale';
  source_camera_id: string | null;
  space_id: string;
  state: OccupancyState1;
}
/**
 * Realtime: sent after every accepted frame (changes may be empty) and when evidence goes stale.
 * Carries every space, so a client replaces its state instead of merging.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "OccupancyUpdateMessage".
 */
export interface OccupancyUpdateMessage {
  changes: OccupancyChange[];
  counts: OccupancyCounts;
  facility_id: string;
  /**
   * The frame that caused this update; null for staleness.
   */
  frame: FrameRef | null;
  published_at: string;
  spaces: ParkingSpace[];
  type: 'occupancy_update';
}
/**
 * Normalised 0…1, origin top-left.
 *
 * This interface was referenced by `ParkRightContracts`'s JSON-Schema
 * via the `definition` "Rect".
 */
export interface Rect2 {
  h: number;
  w: number;
  x: number;
  y: number;
}
