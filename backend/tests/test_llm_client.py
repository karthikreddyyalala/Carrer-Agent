from pydantic import BaseModel
from llm.client import LLMClient
from llm.json_utils import extract_json


class _Shape(BaseModel):
    name: str
    count: int


class _FakeMessage:
    def __init__(self, text):
        self.content = [type("Block", (), {"text": text})()]


class _FakeClient:
    def __init__(self, text):
        self._text = text
        self.calls = []

    @property
    def messages(self):
        outer = self

        class _M:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return _FakeMessage(outer._text)
        return _M()


def test_extract_json_handles_fenced_block():
    raw = 'here you go:\n```json\n{"a": 1}\n```\nthanks'
    assert extract_json(raw) == {"a": 1}


def test_structured_validates_into_schema():
    fake = _FakeClient('{"name": "widget", "count": 3}')
    client = LLMClient(client=fake)
    result = client.structured(
        model="m", system="s", user="u", schema=_Shape,
    )
    assert result.name == "widget" and result.count == 3
    assert fake.calls[0]["model"] == "m"
