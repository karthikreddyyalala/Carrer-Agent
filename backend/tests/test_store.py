from models.contracts import (
    AnswerEvaluation,
    MemoryProfile,
    PlannedQuestion,
    RecurringWeakness,
    SessionRecord,
    TrendPoint,
)
from store.in_memory import InMemoryStore


def _record(candidate_id: str, session_id: str, *, survived: int = 1, total: int = 2,
            mode: str = "full", level: str = "mid", date: str = "2026-07-10") -> SessionRecord:
    evals = [
        AnswerEvaluation(
            questionId=f"q{i}",
            transcript=f"Q: question {i}\nA: answer {i}",
            rubricScores={"structure": 3.0},
            weaknessTags=[] if i < survived else ["vague-impact"],
            followUpCount=0,
            wouldSurviveRealInterview=i < survived,
            survivalReasoning="reasoning",
        )
        for i in range(total)
    ]
    questions = [
        PlannedQuestion(id=f"q{i}", type="behavioral", prompt=f"question {i}",
                        targetDifficulty=3, weightedFromWeakness=False)
        for i in range(total)
    ]
    return SessionRecord(
        sessionId=session_id, candidateId=candidate_id, date=date,
        mode=mode, level=level, questions=questions, evaluations=evals,
    )


def _profile(candidate_id: str) -> MemoryProfile:
    return MemoryProfile(
        candidateId=candidate_id,
        recurringWeaknesses=[RecurringWeakness(tag="no-edge-cases", frequency=2, lastSeen="2026-06-22")],
        improvementTrend=[TrendPoint(sessionDate="2026-06-22", avgScore=3.25)],
        strongAreas=["ownership"],
    )


def test_in_memory_round_trip():
    store = InMemoryStore()
    assert store.get_memory("cand-1") is None

    store.put_memory(_profile("cand-1"))
    loaded = store.get_memory("cand-1")
    assert loaded is not None
    assert loaded.candidate_id == "cand-1"
    assert loaded.recurring_weaknesses[0].frequency == 2
    assert loaded.improvement_trend[0].avg_score == 3.25


def test_in_memory_isolates_candidates():
    store = InMemoryStore()
    store.put_memory(_profile("cand-1"))
    assert store.get_memory("cand-2") is None


def test_in_memory_overwrites_on_put():
    store = InMemoryStore()
    store.put_memory(_profile("cand-1"))
    updated = _profile("cand-1")
    updated.recurring_weaknesses[0].frequency = 9
    store.put_memory(updated)
    assert store.get_memory("cand-1").recurring_weaknesses[0].frequency == 9


def test_put_and_get_session_round_trip():
    store = InMemoryStore()
    assert store.get_session("cand-1", "s1") is None

    store.put_session(_record("cand-1", "s1", survived=2, total=3))
    loaded = store.get_session("cand-1", "s1")
    assert loaded is not None
    assert loaded.session_id == "s1"
    assert len(loaded.questions) == 3
    assert len(loaded.evaluations) == 3
    assert loaded.evaluations[0].transcript.startswith("Q: question 0")


def test_list_sessions_returns_summaries_newest_first():
    store = InMemoryStore()
    store.put_session(_record("cand-1", "s1", survived=1, total=2, date="2026-07-01"))
    store.put_session(_record("cand-1", "s2", survived=3, total=3, date="2026-07-05"))

    summaries = store.list_sessions("cand-1")
    assert [s.session_id for s in summaries] == ["s2", "s1"]  # newest first
    assert summaries[0].survived == 3 and summaries[0].total == 3
    assert summaries[1].mode == "full" and summaries[1].level == "mid"


def test_list_sessions_isolates_candidates():
    store = InMemoryStore()
    store.put_session(_record("cand-1", "s1"))
    assert store.list_sessions("cand-2") == []
    assert store.get_session("cand-2", "s1") is None


def test_sessions_and_memory_do_not_collide():
    store = InMemoryStore()
    store.put_memory(_profile("cand-1"))
    store.put_session(_record("cand-1", "s1"))
    assert store.get_memory("cand-1") is not None
    assert len(store.list_sessions("cand-1")) == 1


# --- DynamoMemoryStore with an in-memory table double ---------------------

class _FakeTable:
    """Minimal boto3 Table stand-in: get_item / put_item on a dict keyed by PK."""

    def __init__(self):
        self.items: dict[str, dict] = {}

    def get_item(self, Key):
        item = self.items.get(Key["candidateId"])
        return {"Item": item} if item is not None else {}

    def put_item(self, Item):
        self.items[Item["candidateId"]] = Item


class _FakeResource:
    def __init__(self, table):
        self._table = table

    def Table(self, _name):
        return self._table


def _dynamo_store():
    from store.dynamo import DynamoMemoryStore
    return DynamoMemoryStore(table_name="t", region="us-west-2", resource=_FakeResource(_FakeTable()))


def test_dynamo_session_round_trip_and_index():
    store = _dynamo_store()
    assert store.get_session("cand-1", "s1") is None
    assert store.list_sessions("cand-1") == []

    store.put_session(_record("cand-1", "s1", survived=1, total=2, date="2026-07-01"))
    store.put_session(_record("cand-1", "s2", survived=3, total=3, date="2026-07-05"))

    listed = store.list_sessions("cand-1")
    assert [s.session_id for s in listed] == ["s2", "s1"]
    assert listed[0].survived == 3 and listed[0].total == 3

    full = store.get_session("cand-1", "s2")
    assert full is not None and len(full.questions) == 3


def test_dynamo_sessions_do_not_collide_with_memory():
    store = _dynamo_store()
    store.put_memory(_profile("cand-1"))
    store.put_session(_record("cand-1", "s1"))
    assert store.get_memory("cand-1") is not None
    assert store.get_memory("cand-1").candidate_id == "cand-1"
    assert len(store.list_sessions("cand-1")) == 1


def test_dynamo_reput_session_updates_index_without_duplicates():
    store = _dynamo_store()
    store.put_session(_record("cand-1", "s1", survived=1, total=2))
    store.put_session(_record("cand-1", "s1", survived=2, total=2))  # same id, re-put
    listed = store.list_sessions("cand-1")
    assert len(listed) == 1
    assert listed[0].survived == 2
