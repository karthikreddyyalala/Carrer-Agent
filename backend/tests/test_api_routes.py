import pytest
from fastapi.testclient import TestClient

import auth
from app import create_app
from store.in_memory import InMemoryStore


@pytest.fixture(autouse=True)
def _clear_auth_cache():
    auth._settings.cache_clear()
    yield
    auth._settings.cache_clear()


class _FakeLLM:
    """Returns a canned payload selected by the requested schema name."""

    def __init__(self, payloads: dict):
        self._payloads = payloads

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        return schema.model_validate(self._payloads[schema.__name__])


_INTAKE = {
    "candidateSkills": ["Go", "Postgres"],
    "yearsExperience": 4,
    "projectHighlights": [
        {"title": "Pricing engine", "description": "Cut p99 latency", "technologies": ["Go"]}
    ],
    "targetRole": "Software Engineer",
    "targetCompany": "Stripe",
    "jdRequirements": ["distributed systems"],
    "resumeToJdGaps": ["thin incident postmortem evidence"],
}

_PLAN = {
    "sessionId": "sess-1",
    "questions": [
        {
            "id": "q0",
            "type": "behavioral",
            "prompt": "Tell me about a deadline you owned.",
            "targetDifficulty": 3,
            "weightedFromWeakness": False,
        }
    ],
}

_DECISION_FOLLOW_UP = {
    "action": "follow_up",
    "followUpPrompt": "What did YOU specifically do?",
    "currentQuestionId": "q0",
}

_DECISION_ADVANCE = {
    "action": "advance",
    "followUpPrompt": None,
    "currentQuestionId": "q0",
}

_EVAL = {
    "questionId": "q0",
    "transcript": "I led a 4-person team and cut latency 80%.",
    "rubricScores": {"structure": 4.0, "specificity": 4.0, "impact": 4.0, "ownership": 4.0},
    "weaknessTags": [],
    "followUpCount": 1,
    "wouldSurviveRealInterview": True,
    "survivalReasoning": "Specific, quantified, clear ownership.",
}

_MEMORY = {
    "candidateId": "local-dev",
    "recurringWeaknesses": [{"tag": "no-edge-cases", "frequency": 1, "lastSeen": "2026-06-22"}],
    "improvementTrend": [{"sessionDate": "2026-06-22", "avgScore": 4.0}],
    "strongAreas": ["ownership"],
}

_QUESTION_BODY = {
    "id": "q0",
    "type": "behavioral",
    "prompt": "Tell me about a deadline you owned.",
    "targetDifficulty": 3,
    "weightedFromWeakness": False,
}


def _client(payloads: dict, store: InMemoryStore | None = None) -> TestClient:
    return TestClient(create_app(llm=_FakeLLM(payloads), store=store or InMemoryStore()))


def test_start_session_returns_profile_and_plan():
    client = _client({"IntakeProfile": _INTAKE, "QuestionPlan": _PLAN})
    res = client.post(
        "/api/session/start",
        json={"resumeText": "resume here", "jdText": "jd here", "role": "sde"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["profile"]["targetRole"] == "Software Engineer"
    assert body["profile"]["resumeToJdGaps"]  # camelCase preserved
    assert body["plan"]["questions"][0]["id"] == "q0"


def test_turn_follow_up_returns_no_evaluation():
    client = _client({"InterviewDecision": _DECISION_FOLLOW_UP})
    res = client.post(
        "/api/session/turn",
        json={
            "question": _QUESTION_BODY,
            "answer": "We just got it done.",
            "followUpCount": 0,
            "isLast": False,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["decision"]["action"] == "follow_up"
    assert body["decision"]["followUpPrompt"]
    assert body["evaluation"] is None


def test_turn_advance_returns_evaluation():
    client = _client({"InterviewDecision": _DECISION_ADVANCE, "AnswerEvaluation": _EVAL})
    res = client.post(
        "/api/session/turn",
        json={
            "question": _QUESTION_BODY,
            "answer": "I led a 4-person team and cut latency 80%.",
            "followUpCount": 1,
            "isLast": False,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["decision"]["action"] == "advance"
    assert body["evaluation"]["wouldSurviveRealInterview"] is True
    assert body["evaluation"]["survivalReasoning"]


def test_finalize_returns_memory_profile():
    client = _client({"MemoryProfile": _MEMORY})
    res = client.post(
        "/api/session/finalize",
        json={"evaluations": [_EVAL], "priorMemory": None},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["candidateId"] == "local-dev"
    assert body["recurringWeaknesses"][0]["tag"] == "no-edge-cases"
    assert body["improvementTrend"][0]["avgScore"] == 4.0


def test_healthcheck():
    client = _client({})
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_auth_required_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("INTERVIEWAI_AUTH_REQUIRED", "true")
    monkeypatch.setenv("INTERVIEWAI_COGNITO_USER_POOL_ID", "us-west-2_test")
    monkeypatch.setenv("INTERVIEWAI_COGNITO_CLIENT_ID", "testclient")
    auth._settings.cache_clear()
    client = _client({"IntakeProfile": _INTAKE, "QuestionPlan": _PLAN})
    res = client.post("/api/session/start",
                      json={"resumeText": "r", "jdText": "j", "role": "sde"})
    assert res.status_code == 401


def test_health_public_even_when_auth_required(monkeypatch):
    monkeypatch.setenv("INTERVIEWAI_AUTH_REQUIRED", "true")
    monkeypatch.setenv("INTERVIEWAI_COGNITO_USER_POOL_ID", "us-west-2_test")
    monkeypatch.setenv("INTERVIEWAI_COGNITO_CLIENT_ID", "testclient")
    auth._settings.cache_clear()
    client = _client({})
    res = client.get("/api/health")
    assert res.status_code == 200


def test_finalize_persists_memory_to_store():
    store = InMemoryStore()
    client = _client({"MemoryProfile": {**_MEMORY, "candidateId": "cand-xyz"}}, store=store)
    res = client.post(
        "/api/session/finalize",
        json={"candidateId": "cand-xyz", "evaluations": [_EVAL]},
    )
    assert res.status_code == 200
    # the aggregated profile is now durable in the store
    saved = store.get_memory("cand-xyz")
    assert saved is not None
    assert saved.recurring_weaknesses[0].tag == "no-edge-cases"


def test_get_memory_returns_persisted_profile():
    store = InMemoryStore()
    client = _client({"MemoryProfile": {**_MEMORY, "candidateId": "cand-abc"}}, store=store)
    # nothing yet -> empty profile, not 404
    empty = client.get("/api/memory/cand-abc")
    assert empty.status_code == 200
    assert empty.json()["candidateId"] == "cand-abc"
    assert empty.json()["recurringWeaknesses"] == []

    # after finalize it returns the saved profile
    client.post("/api/session/finalize", json={"candidateId": "cand-abc", "evaluations": [_EVAL]})
    loaded = client.get("/api/memory/cand-abc")
    assert loaded.status_code == 200
    assert loaded.json()["recurringWeaknesses"][0]["tag"] == "no-edge-cases"


def test_start_loads_prior_memory_from_store():
    """Planner must receive the candidate's persisted weaknesses, proving the
    cross-session loop is server-side, not browser-side."""
    store = InMemoryStore()
    captured: dict = {}

    class _CapturingLLM(_FakeLLM):
        def structured(self, *, model, system, user, schema, max_tokens=2000):
            if schema.__name__ == "QuestionPlan":
                captured["planner_user"] = user
            return super().structured(
                model=model, system=system, user=user, schema=schema, max_tokens=max_tokens
            )

    # seed a prior memory for this candidate
    from models.contracts import MemoryProfile

    store.put_memory(
        MemoryProfile.model_validate(
            {
                "candidateId": "returning",
                "recurringWeaknesses": [{"tag": "no-edge-cases", "frequency": 3, "lastSeen": "2026-06-01"}],
                "improvementTrend": [],
                "strongAreas": [],
            }
        )
    )

    app = create_app(llm=_CapturingLLM({"IntakeProfile": _INTAKE, "QuestionPlan": _PLAN}), store=store)
    client = TestClient(app)
    res = client.post(
        "/api/session/start",
        json={"resumeText": "r", "jdText": "j", "role": "sde", "candidateId": "returning"},
    )
    assert res.status_code == 200
    # the planner prompt carried the persisted weakness
    assert "no-edge-cases" in captured["planner_user"]
