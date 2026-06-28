"""FastAPI application factory for the Crucible interview pipeline.

Run locally (from backend/ with venv active and AWS creds in .env):
    uvicorn app:app --reload --port 8000

Tests inject a fake LLM via create_app(llm=...), so importing this module
never touches AWS. The real app builds an LLMClient that lazily connects to
Bedrock only on the first agent call.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import Settings
from llm.client import LLMClient
from routes.session import build_session_router
from store.base import MemoryStore
from store.in_memory import InMemoryStore


def _build_store(settings: Settings) -> MemoryStore:
    if settings.persistence == "dynamodb":
        from store.dynamo import DynamoMemoryStore

        return DynamoMemoryStore(table_name=settings.memory_table, region=settings.aws_region)
    return InMemoryStore()


def create_app(
    *, llm=None, settings: Settings | None = None, store: MemoryStore | None = None
) -> FastAPI:
    settings = settings or Settings()
    llm = llm if llm is not None else LLMClient(region=settings.aws_region)
    store = store if store is not None else _build_store(settings)

    app = FastAPI(title="Crucible API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(build_session_router(llm=llm, settings=settings, store=store))
    return app


app = create_app()
