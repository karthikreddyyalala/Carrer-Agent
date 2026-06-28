from models.contracts import MemoryProfile


class InMemoryStore:
    """Process-local store. Used by tests and local dev without DynamoDB."""

    def __init__(self) -> None:
        self._mem: dict[str, MemoryProfile] = {}

    def get_memory(self, candidate_id: str) -> MemoryProfile | None:
        return self._mem.get(candidate_id)

    def put_memory(self, profile: MemoryProfile) -> None:
        self._mem[profile.candidate_id] = profile
