from typing import Literal
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ProjectHighlight(_Base):
    title: str
    description: str
    technologies: list[str]


class IntakeProfile(_Base):
    candidate_skills: list[str]
    years_experience: float
    project_highlights: list[ProjectHighlight]
    target_role: str
    target_company: str | None = None
    jd_requirements: list[str]
    resume_to_jd_gaps: list[str]


class PlannedQuestion(_Base):
    id: str
    type: Literal["behavioral", "technical", "system_design"]
    prompt: str
    target_difficulty: Literal[1, 2, 3, 4, 5]
    weighted_from_weakness: bool


class QuestionPlan(_Base):
    session_id: str
    questions: list[PlannedQuestion]


class AnswerEvaluation(_Base):
    question_id: str
    transcript: str
    rubric_scores: dict[str, int]
    weakness_tags: list[str]
    follow_up_count: int
    would_survive_real_interview: bool
    survival_reasoning: str


class RecurringWeakness(_Base):
    tag: str
    frequency: int
    last_seen: str


class TrendPoint(_Base):
    session_date: str
    avg_score: float


class MemoryProfile(_Base):
    candidate_id: str
    recurring_weaknesses: list[RecurringWeakness]
    improvement_trend: list[TrendPoint]
    strong_areas: list[str]
