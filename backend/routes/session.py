from datetime import date
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from auth import current_sub

from config.settings import Settings
from models.contracts import (
    AnswerEvaluation,
    IntakeProfile,
    InterviewDecision,
    MemoryProfile,
    PlannedQuestion,
    QuestionPlan,
    SessionRecord,
    SessionSummary,
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
    mode: Literal["full", "behavioral", "technical", "system_design"] = "full"
    level: Literal["junior", "mid", "senior"] = "mid"


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
    # Optional so older clients keep working; when present, a reviewable
    # SessionRecord is persisted alongside the updated memory.
    session_id: str | None = None
    mode: str = "full"
    level: str = "mid"
    questions: list[PlannedQuestion] = []


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
    def get_memory(candidate_id: str, sub: str | None = Depends(current_sub)) -> MemoryProfile:
        # When authenticated, the token's sub wins over any client-supplied id,
        # so a user can only ever read their own memory.
        cid = sub or candidate_id
        return store.get_memory(cid) or _empty_memory(cid)

    @router.post("/session/start")
    def start(req: StartSessionRequest, sub: str | None = Depends(current_sub)) -> StartSessionResponse:
        cid = sub or req.candidate_id
        prior = store.get_memory(cid) or _empty_memory(cid)
        result = start_graph.invoke(
            {
                "session_id": str(uuid4()),
                "resume_text": req.resume_text,
                "jd_text": req.jd_text,
                "role_key": req.role,
                "mode": req.mode,
                "level": req.level,
                "memory": prior,
            }
        )
        return StartSessionResponse(profile=result["profile"], plan=result["plan"])

    @router.post("/session/turn")
    def turn(req: TurnRequest, _sub: str | None = Depends(current_sub)) -> TurnResponse:
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
    def finalize(req: FinalizeRequest, sub: str | None = Depends(current_sub)) -> MemoryProfile:
        cid = sub or req.candidate_id
        today = date.today().isoformat()
        existing = store.get_memory(cid) or _empty_memory(cid)
        updated = memory_agent.run(
            candidate_id=cid,
            session_date=today,
            evaluations=req.evaluations,
            existing_memory=existing,
        )
        store.put_memory(updated)

        # Persist a reviewable record of this session when the client sent the
        # session id + questions (newer clients). Older payloads just update
        # memory, unchanged.
        if req.session_id:
            store.put_session(
                SessionRecord(
                    session_id=req.session_id,
                    candidate_id=cid,
                    date=today,
                    mode=req.mode,
                    level=req.level,
                    questions=req.questions,
                    evaluations=req.evaluations,
                )
            )
        return updated

    @router.get("/sessions")
    def list_sessions(sub: str | None = Depends(current_sub)) -> list[SessionSummary]:
        cid = sub or "local-dev"
        return store.list_sessions(cid)

    @router.get("/sessions/{session_id}")
    def get_session(session_id: str, sub: str | None = Depends(current_sub)) -> SessionRecord:
        cid = sub or "local-dev"
        record = store.get_session(cid, session_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Session not found.")
        return record

    return router
