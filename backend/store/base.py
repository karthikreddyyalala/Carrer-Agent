from typing import Protocol

from models.contracts import MemoryProfile


class MemoryStore(Protocol):
    """Persistence seam for cross-session memory.

    The whole product differentiator (memory that reshapes future sessions)
    depends on this surviving past a single browser, so it lives behind a
    swappable interface: InMemoryStore for tests/local, DynamoMemoryStore in
    production.
    """

    def get_memory(self, candidate_id: str) -> MemoryProfile | None: ...

    def put_memory(self, profile: MemoryProfile) -> None: ...
