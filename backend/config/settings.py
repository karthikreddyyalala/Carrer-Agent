from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INTERVIEWAI_", env_file=".env", extra="ignore")

    aws_region: str = "us-east-1"
    intake_model: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    planner_model: str = "us.anthropic.claude-opus-4-8-v1:0"
    run_llm_evals: bool = False
