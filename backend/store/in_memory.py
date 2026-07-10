from models.contracts import MemoryProfile, SessionRecord, SessionSummary


class InMemoryStore:
    """Process-local store. Used by tests and local dev without DynamoDB."""

    def __init__(self) -> None:
        self._mem: dict[str, MemoryProfile] = {}
        # candidate_id -> {session_id -> SessionRecord}
        self._sessions: dict[str, dict[str, SessionRecord]] = {}

    def get_memory(self, candidate_id: str) -> MemoryProfile | None:
        return self._mem.get(candidate_id)

    def put_memory(self, profile: MemoryProfile) -> None:
        self._mem[profile.candidate_id] = profile

    def put_session(self, record: SessionRecord) -> None:
        self._sessions.setdefault(record.candidate_id, {})[record.session_id] = record

    def list_sessions(self, candidate_id: str) -> list[SessionSummary]:
        records = self._sessions.get(candidate_id, {}).values()
        summaries = [r.summary() for r in records]
        # Newest first — by date, then session_id as a stable tiebreaker.
        summaries.sort(key=lambda s: (s.date, s.session_id), reverse=True)
        return summaries

    def get_session(self, candidate_id: str, session_id: str) -> SessionRecord | None:
        return self._sessions.get(candidate_id, {}).get(session_id)
