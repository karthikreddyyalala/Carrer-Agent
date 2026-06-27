from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INTERVIEWAI_", env_file=".env", extra="ignore")

    aws_region: str = "us-east-1"

    # Per-agent models. Cheap structured work runs on Haiku; the two agents
    # that carry the product (push-back + survival verdict) run on Sonnet.
    # Opus is intentionally avoided by default — ~5x the cost for marginal
    # gain here. Override any of these via INTERVIEWAI_<NAME> in .env.
    haiku_model: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    sonnet_model: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

    intake_model: str = haiku_model
    planner_model: str = haiku_model
    interviewer_model: str = sonnet_model
    evaluator_model: str = sonnet_model
    memory_model: str = haiku_model

    run_llm_evals: bool = False
