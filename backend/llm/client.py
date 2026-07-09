from typing import TYPE_CHECKING, Any, TypeVar
from pydantic import BaseModel
from llm.json_utils import extract_json

if TYPE_CHECKING:
    from anthropic import AnthropicBedrock

T = TypeVar("T", bound=BaseModel)


class LLMClient:
    """Thin, mockable wrapper over Claude on Bedrock.

    Pass a custom `client` in tests; in production it lazily builds an
    AnthropicBedrock client so importing this module never needs AWS creds.
    """

    def __init__(self, client: "AnthropicBedrock | Any | None" = None, region: str = "us-east-1"):
        self._client = client
        self._region = region

    def _ensure_client(self):
        if self._client is None:
            from anthropic import AnthropicBedrock
            self._client = AnthropicBedrock(aws_region=self._region)
        return self._client

    def structured(self, *, model: str, system: str, user: str,
                   schema: type[T], max_tokens: int = 2000,
                   max_retries: int = 2) -> T:
        """Call the model and validate its output into `schema`.

        A single malformed response (unparseable JSON or wrong shape) must not
        kill a live interview turn. On a parse/validation failure we retry up to
        `max_retries` times, appending an explicit correction instruction so the
        model returns strict JSON. Only the final failure propagates.
        """
        client = self._ensure_client()
        base_user = user
        last_error: Exception | None = None

        for attempt in range(max_retries + 1):
            prompt = base_user
            if attempt > 0:
                prompt = (
                    f"{base_user}\n\n"
                    "IMPORTANT: Your previous response could not be parsed. "
                    "Respond with ONLY a single valid JSON object matching the "
                    "required schema. No prose, no markdown fences, no trailing text."
                )
            try:
                message = client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = message.content[0].text
                return schema.model_validate(extract_json(text))
            except Exception as e:  # noqa: BLE001 — network/parse/validation, retry
                last_error = e

        assert last_error is not None
        raise last_error
