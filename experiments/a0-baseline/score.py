"""Offline evaluation only. Imports no provider; cannot feed labels into inference.

Input JSON: {"predictions": [canonical OccupancyObservation, ...],
             "ground_truth": [canonical GroundTruthFrame, ...]}.
Exact join on camera/session/seq/space. Missing predictions count as UNCERTAIN.
"""

import argparse
import json
from collections import Counter
from pathlib import Path


def score(data):
    predictions = {}
    for p in data["predictions"]:
        key = (p["camera_id"], p["session_id"], p["frame_seq"], p["space_id"])
        if key in predictions:
            raise ValueError(f"duplicate prediction: {key}")
        if p["state"] not in ("OPEN", "OCCUPIED", "UNCERTAIN"):
            raise ValueError("noncanonical prediction")
        predictions[key] = p["state"]
    matrix = {
        truth: {s: 0 for s in ("OPEN", "OCCUPIED", "UNCERTAIN")}
        for truth in ("empty", "occupied")
    }
    seen = set()
    missing = 0
    for frame in data["ground_truth"]:
        for space in frame["spaces"]:
            key = (
                frame["camera_id"],
                frame["session_id"],
                frame["seq"],
                space["space_id"],
            )
            if key in seen:
                raise ValueError(f"duplicate ground truth: {key}")
            seen.add(key)
            if space["truth"] not in matrix:
                raise ValueError("invalid ground truth")
            missing += key not in predictions
            matrix[space["truth"]][predictions.get(key, "UNCERTAIN")] += 1
    totals = Counter(
        {
            s: sum(row[s] for row in matrix.values())
            for s in ("OPEN", "OCCUPIED", "UNCERTAIN")
        }
    )
    n = len(seen)

    def ratio(a, b):
        return a / b if b else None

    return {
        "samples": n,
        "accuracy": ratio(matrix["empty"]["OPEN"] + matrix["occupied"]["OCCUPIED"], n),
        "open_precision": ratio(matrix["empty"]["OPEN"], totals["OPEN"]),
        "open_recall": ratio(matrix["empty"]["OPEN"], sum(matrix["empty"].values())),
        "occupied_precision": ratio(matrix["occupied"]["OCCUPIED"], totals["OCCUPIED"]),
        "occupied_recall": ratio(
            matrix["occupied"]["OCCUPIED"], sum(matrix["occupied"].values())
        ),
        "uncertain_rate": ratio(totals["UNCERTAIN"], n),
        "false_open_count": matrix["occupied"]["OPEN"],
        "false_open_rate_among_occupied": ratio(
            matrix["occupied"]["OPEN"], sum(matrix["occupied"].values())
        ),
        "missing_predictions": missing,
        "unmatched_predictions": len(set(predictions) - seen),
        "confusion_matrix": matrix,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    print(json.dumps(score(json.loads(args.dataset.read_text())), indent=2))
