/**
 * ParkRight contracts for TypeScript (web app, simulator).
 * Types are generated from the Python models; constants come from the same source.
 */
import constants from '../../schema/constants.json' with { type: 'json' };
import type { OccupancyState } from './generated.ts';

export type * from './generated.ts';

export const {
  FRAME_CONTRACT_VERSION,
  FRAME_METADATA_PART,
  FRAME_IMAGE_PART,
  FRAME_CONTENT_TYPE,
  FRAME_MAX_BYTES,
  FRAME_METADATA_MAX_BYTES,
  MIN_OPEN_CONFIDENCE,
  IDENTIFIER_PATTERN,
} = constants;

export const IDENTIFIER = new RegExp(IDENTIFIER_PATTERN);

/** The only predicate a driver UI should use to offer a space. UNCERTAIN is never availability. */
export function isConfirmedAvailable(space: { current_state: OccupancyState; stale: boolean }): boolean {
  return space.current_state === 'OPEN' && !space.stale;
}
