from datetime import date
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from config.settings import Settings
from models.contracts import (
    AnswerEvaluation,
    IntakeProfile,
    InterviewDecision,
    MemoryProfile,
    PlannedQuestion,
    QuestionPlan,
)
from agents.evaluator import EvaluatorAgent
from agents.interviewer import InterviewerAgent
from agents.memory import MemoryAgent
from graph.session_start import build_session_start_graph


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StartSessionRequest(_Base):
    resume_text: str
    jd_text: str
    role: str
    prior_memory: MemoryProfile | None = None


class StartSessionResponse(_Base):
    profile: IntakeProfile
    plan: QuestionPlan


class TurnRequest(_Base):
    question: PlannedQuestion
    answer: str
    follow_up_count: int
    is_last: bool


class TurnResponse(_Base):
    decision: InterviewDecision
    evaluation: AnswerEvaluation | None = None


class FinalizeRequest(_Base):
    evaluations: list[AnswerEvaluation]
    prior_memory: MemoryProfile | None = None


def _empty_memory() -> MemoryProfile:
    return MemoryProfile(
        candidate_id="local-dev",
        recurring_weaknesses=[],
        improvement_trend=[],
        strong_areas=[],
    )


def build_session_router(*, llm, settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/api")

    start_graph = build_session_start_graph(
        llm=llm,
        intake_model=settings.intake_model,
        planner_model=settings.planner_model,
    )
    interviewer = InterviewerAgent(llm=llm, model=settings.planner_model)
    evaluator = EvaluatorAgent(llm=llm, model=settings.planner_model)
    memory_agent = MemoryAgent(llm=llm, model=settings.planner_model)

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.post("/session/start")
    def start(req: StartSessionRequest) -> StartSessionResponse:
        result = start_graph.invoke(
            {
                "session_id": str(uuid4()),
                "resume_text": req.resume_text,
                "jd_text": req.jd_text,
                "role_key": req.role,
                "memory": req.prior_memory or _empty_memory(),
            }
        )
        return StartSessionResponse(profile=result["profile"], plan=result["plan"])

    @router.post("/session/turn")
    def turn(req: TurnRequest) -> TurnResponse:
        decision = interviewer.run_turn(
            question=req.question,
            candidate_answer=req.answer,
            follow_up_count=req.follow_up_count,
            is_last_question=req.is_last,
        )
        if decision.action == "follow_up":
            return TurnResponse(decision=decision)

        evaluation = evaluator.run(
            question=req.question,
            transcript=req.answer,
            follow_up_count=req.follow_up_count,
        )
        return TurnResponse(decision=decision, evaluation=evaluation)

    @router.post("/session/finalize")
    def finalize(req: FinalizeRequest) -> MemoryProfile:
        existing = req.prior_memory or _empty_memory()
        return memory_agent.run(
            candidate_id=existing.candidate_id,
            session_date=date.today().isoformat(),
            evaluations=req.evaluations,
            existing_memory=existing,
        )

    return router
