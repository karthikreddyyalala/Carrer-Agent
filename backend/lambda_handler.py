"""AWS Lambda entrypoint.

Wraps the FastAPI app with Mangum so it runs behind a Lambda Function URL.
The same `app` object serves uvicorn locally and Lambda in production — no
code divergence between environments.
"""
from mangum import Mangum

from app import app

handler = Mangum(app, lifespan="off")
