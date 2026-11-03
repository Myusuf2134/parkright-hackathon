/**
 * A university as data, so a second campus is a new file rather than new code. Parking availability
 * never lives here: these records say where a garage is, and availability sources say what is known.
 */
export interface LatLng { lat: number; lng: number }

export interface Provenance {
  /** OSM object this came from, e.g. "way/162877497". */
  osm: string;
}

export interface CampusEntrance extends LatLng {
  osmNode: number;
  /** inbound: a one-way driveway flows in. mapped: an entrance exists, traffic direction unknown. */
  kind: 'inbound' | 'mapped';
  /** Which side of the garage, from its centre. */
  side: string;
  maxHeight: string | null;
}

/** A door on a garage's footprint with a walkable way attached. Mapped, not surveyed. */
export interface CampusDoor extends LatLng { osmNode: number; side: string }

export interface CampusGarage extends LatLng, Provenance {
  id: string;
  name: string;
  short: string;
  terms: string;
  address: string | null;
  capacity: number | null;
  osmOperator: string | null;
  entrances: CampusEntrance[];
  pedestrianDoors: CampusDoor[];
  /** [lng, lat] outline. */
  footprint: [number, number][];
}

export interface CampusBuilding extends LatLng, Provenance {
  id: string;
  name: string;
  short: string;
  terms: string;
  address: string | null;
  doors: (LatLng & { osmNode: number })[];
}

export interface Campus {
  id: string;
  name: string;
  center: LatLng;
  zoom: number;
  source: string;
  retrieved: string;
  garages: CampusGarage[];
  buildings: CampusBuilding[];
  /** Which garage a demo-fixture candidate, or a simulated facility, stands in for. */
  links: { candidates: Record<string, string> };
}

/** Where a car should be sent: the first mapped entrance, or null when none is mapped. */
export const primaryEntrance = (g: CampusGarage): CampusEntrance | null => g.entrances[0] ?? null;
