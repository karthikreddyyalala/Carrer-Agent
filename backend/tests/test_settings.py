from config.settings import Settings


def test_defaults_present():
    s = Settings()
    assert s.intake_model
    assert s.planner_model
    assert s.aws_region == "us-east-1"


def test_env_override(monkeypatch):
    monkeypatch.setenv("INTERVIEWAI_PLANNER_MODEL", "custom-model-id")
    s = Settings()
    assert s.planner_model == "custom-model-id"
