import pytest


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    # Tests must never depend on a developer's real AWS creds.
    monkeypatch.setenv("AWS_REGION", "us-east-1")
