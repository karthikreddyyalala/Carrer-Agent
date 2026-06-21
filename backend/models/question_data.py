from typing import Literal
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Competency(_Base):
    area: str
    weight: float


class CompetencyMap(_Base):
    role: str
    competencies: list[Competency]


class Rubric(_Base):
    criteria: dict[str, str]


class QuestionExemplar(_Base):
    id: str
    role: str
    competency: str
    type: Literal["behavioral", "technical", "system_design"]
    difficulty: Literal[1, 2, 3, 4, 5]
    prompt: str
    ideal_answer_points: list[str]
    follow_up_hooks: list[str]
    rubric: Rubric
