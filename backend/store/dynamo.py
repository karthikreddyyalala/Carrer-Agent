from typing import Any

from models.contracts import MemoryProfile


class DynamoMemoryStore:
    """DynamoDB-backed memory store.

    The MemoryProfile is stored as a single JSON string attribute. This avoids
    DynamoDB's float/Decimal friction entirely (rubric scores and avgScore are
    floats) and keeps reads/writes a clean Pydantic round-trip.

    Table schema: partition key `candidateId` (S).
    """

    def __init__(self, table_name: str, region: str, resource: Any = None) -> None:
        if resource is None:
            import boto3

            resource = boto3.resource("dynamodb", region_name=region)
        self._table = resource.Table(table_name)

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
