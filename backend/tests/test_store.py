from models.contracts import MemoryProfile, RecurringWeakness, TrendPoint
from store.in_memory import InMemoryStore


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
