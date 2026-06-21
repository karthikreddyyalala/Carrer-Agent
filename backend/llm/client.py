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
                   schema: type[T], max_tokens: int = 2000) -> T:
        client = self._ensure_client()
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = message.content[0].text
        return schema.model_validate(extract_json(text))
