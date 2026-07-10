import json
from typing import Any

from models.contracts import MemoryProfile, SessionRecord, SessionSummary


class DynamoMemoryStore:
    """DynamoDB-backed memory store.

    Everything is stored as a single JSON string attribute per item. This avoids
    DynamoDB's float/Decimal friction entirely (rubric scores and avgScore are
    floats) and keeps reads/writes a clean Pydantic round-trip.

    The table has only a partition key (`candidateId` S) and the runtime role is
    scoped to GetItem/PutItem, so session history is layered on with derived
    partition keys instead of a new table or a sort key:
      - memory profile:  candidateId
      - session index:   "{candidateId}#index"     -> JSON list of SessionSummary
      - full session:    "{candidateId}#session#{sessionId}" -> JSON SessionRecord
    The index item is summaries only (small), so it never approaches the 400KB
    item limit; full transcripts live in their own per-session items.
    """

    def __init__(self, table_name: str, region: str, resource: Any = None) -> None:
        if resource is None:
            import boto3

            resource = boto3.resource("dynamodb", region_name=region)
        self._table = resource.Table(table_name)

    @staticmethod
    def _index_key(candidate_id: str) -> str:
        return f"{candidate_id}#index"

    @staticmethod
    def _session_key(candidate_id: str, session_id: str) -> str:
        return f"{candidate_id}#session#{session_id}"

    def get_memory(self, candidate_id: str) -> MemoryProfile | None:
        resp = self._table.get_item(Key={"candidateId": candidate_id})
        item = resp.get("Item")
        if not item:
            return None
        return MemoryProfile.model_validate_json(item["profileJson"])

    def put_memory(self, profile: MemoryProfile) -> None:
        self._table.put_item(
            Item={
                "candidateId": profile.candidate_id,
                "profileJson": profile.model_dump_json(by_alias=True),
            }
        )

    def put_session(self, record: SessionRecord) -> None:
        # 1) full record in its own item
        self._table.put_item(
            Item={
                "candidateId": self._session_key(record.candidate_id, record.session_id),
                "recordJson": record.model_dump_json(by_alias=True),
            }
        )
        # 2) upsert the summary into the index item
        summaries = self._read_index(record.candidate_id)
        summaries = [s for s in summaries if s.session_id != record.session_id]
        summaries.append(record.summary())
        self._table.put_item(
            Item={
                "candidateId": self._index_key(record.candidate_id),
                "sessionsJson": json.dumps(
                    [s.model_dump(by_alias=True) for s in summaries]
                ),
            }
        )

    def _read_index(self, candidate_id: str) -> list[SessionSummary]:
        resp = self._table.get_item(Key={"candidateId": self._index_key(candidate_id)})
        item = resp.get("Item")
        if not item:
            return []
        return [SessionSummary.model_validate(s) for s in json.loads(item["sessionsJson"])]

    def list_sessions(self, candidate_id: str) -> list[SessionSummary]:
        summaries = self._read_index(candidate_id)
        summaries.sort(key=lambda s: (s.date, s.session_id), reverse=True)
        return summaries

    def get_session(self, candidate_id: str, session_id: str) -> SessionRecord | None:
        resp = self._table.get_item(
            Key={"candidateId": self._session_key(candidate_id, session_id)}
        )
        item = resp.get("Item")
        if not item:
            return None
        return SessionRecord.model_validate_json(item["recordJson"])
