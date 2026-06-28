from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INTERVIEWAI_", env_file=".env", extra="ignore")

    aws_region: str = "us-west-2"

    # Per-agent models, all verified available in this account/region.
    # Cheap structured work runs on Haiku; the agents that carry the product
    # (question plan, push-back, survival verdict) run on Sonnet 4.6. Opus is
    # intentionally avoided — ~5x the cost for marginal gain here. Override
    # any of these via INTERVIEWAI_<NAME> in .env.
    haiku_model: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    sonnet_model: str = "us.anthropic.claude-sonnet-4-6"

    intake_model: str = haiku_model
    planner_model: str = sonnet_model
    interviewer_model: str = sonnet_model
    evaluator_model: str = sonnet_model
    memory_model: str = haiku_model

    # Persistence. "memory" keeps everything in-process (tests, local dev with
    # no AWS tables). "dynamodb" persists MemoryProfile across sessions/devices.
    persistence: str = "memory"
    memory_table: str = "crucible-memory"

    # Comma-separated allowed browser origins for CORS. Localhost for dev; add
    # the deployed frontend origin (CloudFront domain) via INTERVIEWAI_CORS_ORIGINS.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    run_llm_evals: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
