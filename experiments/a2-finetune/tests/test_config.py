from a2_finetune.config import ExperimentConfig, load_config


def test_config_is_deterministic_and_mapping_is_explicit(tmp_path):
    config = ExperimentConfig()
    path = tmp_path / "config.json"
    config.write(path)
    loaded = load_config(path)
    assert loaded.sha256() == config.sha256()
    assert loaded.mapping() == {
        "sedan": 1,
        "suv": 1,
        "hatchback": 1,
        "van": 1,
        "pickup": 2,
    }
    assert loaded.target_box == "bbox_visible"
    assert loaded.allow_open is False

