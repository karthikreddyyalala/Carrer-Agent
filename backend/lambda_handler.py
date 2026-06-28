"""AWS Lambda entrypoint.

Wraps the FastAPI app with Mangum so it runs behind API Gateway (HTTP API).
The same `app` object serves uvicorn locally and Lambda in production — no
code divergence between environments.
"""
from mangum import Mangum

from app import app

_asgi = Mangum(app, lifespan="off")


def handler(event, context):
    # Some API Gateway HTTP API (payload v2) events omit requestContext.http.sourceIp,
    # which Mangum's v2 handler dereferences unconditionally. Backfill a placeholder
    # so a missing client IP can never 500 the whole request.
    http = event.get("requestContext", {}).get("http")
    if isinstance(http, dict):
        http.setdefault("sourceIp", "0.0.0.0")
    return _asgi(event, context)
