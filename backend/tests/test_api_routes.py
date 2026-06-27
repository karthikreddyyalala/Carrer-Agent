from fastapi.testclient import TestClient

from app import create_app


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


def _client(payloads: dict) -> TestClient:
    return TestClient(create_app(llm=_FakeLLM(payloads)))


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
