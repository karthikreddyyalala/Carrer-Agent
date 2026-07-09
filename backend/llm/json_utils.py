import json
import re

_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)
_DECODER = json.JSONDecoder()


def extract_json(text: str) -> dict | list:
    """Pull the first complete JSON object/array out of model output.

    Handles the messy realities of LLM output: fenced blocks, leading prose,
    and — critically — trailing content after the JSON (an explanation line, a
    second object, or prose containing braces). `raw_decode` parses the first
    complete JSON value and ignores everything after it, so a model that adds
    commentary after the JSON no longer crashes the turn.
    """
    fenced = _FENCE.search(text)
    if fenced:
        # Fenced content is already isolated; parse it directly.
        return json.loads(fenced.group(1))

    stripped = text.strip()
    # Scan for the first position that begins a JSON value and decode from there,
    # stopping at the end of that first complete value.
    for i, ch in enumerate(stripped):
        if ch in "{[":
            try:
                obj, _end = _DECODER.raw_decode(stripped, i)
                return obj
            except json.JSONDecodeError:
                continue

    raise ValueError("no JSON object or array found in model output")
