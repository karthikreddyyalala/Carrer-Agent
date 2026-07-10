from typing import Protocol

from models.contracts import MemoryProfile, SessionRecord, SessionSummary


class MemoryStore(Protocol):
    """Persistence seam for cross-session memory.

    The whole product differentiator (memory that reshapes future sessions)
    depends on this surviving past a single browser, so it lives behind a
    swappable interface: InMemoryStore for tests/local, DynamoMemoryStore in
    production.
    """

    def get_memory(self, candidate_id: str) -> MemoryProfile | None: ...

    def put_memory(self, profile: MemoryProfile) -> None: ...

    # Per-session records power the dashboard's reviewable session history.
    def put_session(self, record: SessionRecord) -> None: ...

    def list_sessions(self, candidate_id: str) -> list[SessionSummary]: ...

    def get_session(self, candidate_id: str, session_id: str) -> SessionRecord | None: ...
