import json

from a2_finetune.dataset import sha256_file


def test_checkpoint_provenance_hashes_exact_bytes(tmp_path):
    checkpoint = tmp_path / "model.pt"
    checkpoint.write_bytes(b"not-a-real-checkpoint")
    metadata = {"checkpoint_sha256": sha256_file(checkpoint), "checkpoint_size_bytes": checkpoint.stat().st_size}
    restored = json.loads(json.dumps(metadata))
    assert restored["checkpoint_sha256"] == "ae55dbbffb220a59413867b208b396e9ae342b3299cca016febe9ecb83166cca"
    assert restored["checkpoint_size_bytes"] == 21
