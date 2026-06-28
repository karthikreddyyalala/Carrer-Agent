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
from store.base import MemoryStore


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StartSessionRequest(_Base):
    resume_text: str
    jd_text: str
    role: str
    candidate_id: str = "local-dev"


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
    candidate_id: str = "local-dev"
    evaluations: list[AnswerEvaluation]


def _empty_memory(candidate_id: str) -> MemoryProfile:
    return MemoryProfile(
        candidate_id=candidate_id,
        recurring_weaknesses=[],
        improvement_trend=[],
        strong_areas=[],
    )


def build_session_router(*, llm, settings: Settings, store: MemoryStore) -> APIRouter:
    router = APIRouter(prefix="/api")

    start_graph = build_session_start_graph(
        llm=llm,
        intake_model=settings.intake_model,
        planner_model=settings.planner_model,
    )
    interviewer = InterviewerAgent(llm=llm, model=settings.interviewer_model)
    evaluator = EvaluatorAgent(llm=llm, model=settings.evaluator_model)
    memory_agent = MemoryAgent(llm=llm, model=settings.memory_model)

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/memory/{candidate_id}")
    def get_memory(candidate_id: str) -> MemoryProfile:
        # Always return a profile (empty if none yet) so the client can render
        # weak-spot UI without special-casing 404s.
        return store.get_memory(candidate_id) or _empty_memory(candidate_id)

    @router.post("/session/start")
    def start(req: StartSessionRequest) -> StartSessionResponse:
        prior = store.get_memory(req.candidate_id) or _empty_memory(req.candidate_id)
        result = start_graph.invoke(
            {
                "session_id": str(uuid4()),
                "resume_text": req.resume_text,
                "jd_text": req.jd_text,
                "role_key": req.role,
                "memory": prior,
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
        existing = store.get_memory(req.candidate_id) or _empty_memory(req.candidate_id)
        updated = memory_agent.run(
            candidate_id=req.candidate_id,
            session_date=date.today().isoformat(),
            evaluations=req.evaluations,
            existing_memory=existing,
        )
        store.put_memory(updated)
        return updated

    return router
