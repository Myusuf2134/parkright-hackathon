"""Writes the JSON Schema bundle (schema/contracts.schema.json) and shared constants
(schema/constants.json) from the Pydantic models. TypeScript is generated from these.

    uv run python packages/contracts/scripts/export_schema.py [--check]
"""

import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

import parkright_contracts as c

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schema"

MODELS = [
    c.FrameMetadata,
    c.FrameIngestResult,
    c.OccupancyObservation,
    c.ParkingSpace,
    c.OccupancyUpdateMessage,
    c.FacilitySnapshotMessage,
    c.Facility,
    c.FacilityOccupancy,
    c.Level,
    c.Camera,
    c.FacilityConfig,
    c.GroundTruthRecord,
    c.EnvironmentPreset,
]


def _strip_titles(node: object, keep: bool = False) -> object:
    """Pydantic titles every property; generators turn those into noise types. Keep model titles only."""
    if isinstance(node, dict):
        return {k: _strip_titles(v, keep=k == "$defs") for k, v in node.items() if keep or k != "title" or not isinstance(v, str)}
    if isinstance(node, list):
        return [_strip_titles(v) for v in node]
    return node


def render() -> dict[str, str]:
    _, bundle = models_json_schema([(m, "serialization") for m in MODELS], title="ParkRight contracts")
    defs = {name: {"title": name, **_strip_titles(schema)} for name, schema in bundle["$defs"].items()}
    bundle = {"title": bundle["title"], "$defs": defs}
    constants = {
        "FRAME_CONTRACT_VERSION": c.FRAME_CONTRACT_VERSION,
        "FRAME_METADATA_PART": c.FRAME_METADATA_PART,
        "FRAME_IMAGE_PART": c.FRAME_IMAGE_PART,
        "FRAME_CONTENT_TYPE": c.FRAME_CONTENT_TYPE,
        "FRAME_MAX_BYTES": c.FRAME_MAX_BYTES,
        "FRAME_METADATA_MAX_BYTES": c.FRAME_METADATA_MAX_BYTES,
        "MIN_OPEN_CONFIDENCE": c.MIN_OPEN_CONFIDENCE,
        "IDENTIFIER_PATTERN": c.IDENTIFIER_PATTERN,
    }
    dump = lambda o: json.dumps(o, indent=2, sort_keys=True) + "\n"  # noqa: E731
    return {"contracts.schema.json": dump(bundle), "constants.json": dump(constants)}


def main() -> int:
    files = render()
    if "--check" in sys.argv:
        stale = [n for n, text in files.items() if not (SCHEMA_DIR / n).exists() or (SCHEMA_DIR / n).read_text() != text]
        if stale:
            print(f"out of date: {', '.join(stale)} — run packages/contracts/scripts/export_schema.py", file=sys.stderr)
            return 1
        return 0
    SCHEMA_DIR.mkdir(exist_ok=True)
    for name, text in files.items():
        (SCHEMA_DIR / name).write_text(text)
    print(f"wrote {', '.join(files)} to {SCHEMA_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
