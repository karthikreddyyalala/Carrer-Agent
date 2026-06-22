# Phase 2: Interviewer + Evaluator Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the text-only "push back" interview loop — an Interviewer Agent that probes vague answers and an Evaluator Agent that scores each answer with `wouldSurviveRealInterview`, wired together in a LangGraph per-turn graph.

**Architecture:** Two new agents (Interviewer, Evaluator) follow the same pattern as Phase 1: a strict-JSON system prompt in `prompts/`, a thin agent class that calls `LLMClient.structured()`, and LangGraph nodes that compose them into a turn-by-turn state machine. One graph invocation = one candidate answer processed. The caller (CLI or later FastAPI) loops over turns. Cloud infra and voice/avatar remain deferred.

**Tech Stack:** Python 3.12, Pydantic v2, LangGraph, anthropic[bedrock] (same as Phase 1). All tests use fake LLMs — no AWS credentials needed for the unit suite.

---

## File Structure

```
backend/
  models/
    contracts.py          ← MODIFY: add InterviewDecision
  prompts/
    evaluator.md          ← CREATE: Evaluator system prompt
    interviewer.md        ← CREATE: Interviewer system prompt
  agents/
    evaluator.py          ← CREATE: EvaluatorAgent
    interviewer.py        ← CREATE: InterviewerAgent
  graph/
    interview_turn.py     ← CREATE: per-turn LangGraph
  cli/
    run_interview.py      ← CREATE: interactive CLI text loop
  evals/
    golden/
      interview_turn_cases.json  ← CREATE: vague/concrete/scripted cases
    test_interview_turn_eval.py  ← CREATE: gated behavioral eval
  tests/
    test_contracts.py           ← MODIFY: add InterviewDecision test
    test_evaluator_agent.py     ← CREATE
    test_interviewer_agent.py   ← CREATE
    test_interview_turn_graph.py ← CREATE
```

---

## TASK 1: Add InterviewDecision to data contracts

**Files:**
- Modify: `backend/models/contracts.py`
- Modify: `backend/tests/test_contracts.py`

- [ ] **Step 1: Write the failing test**

Add this to `backend/tests/test_contracts.py`:

```python
from models.contracts import InterviewDecision


def test_interview_decision_follow_up():
    d = InterviewDecision(
        action="follow_up",
        followUpPrompt="You said you optimized the query — what was the before/after latency?",
        currentQuestionId="q1",
    )
    assert d.action == "follow_up"
    assert d.follow_up_prompt is not None
    assert d.current_question_id == "q1"


def test_interview_decision_advance_has_no_prompt():
    d = InterviewDecision(
        action="advance",
        followUpPrompt=None,
        currentQuestionId="q2",
    )
    assert d.action == "advance"
    assert d.follow_up_prompt is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_contracts.py -v -k "interview_decision"`
Expected: FAIL with `ImportError: cannot import name 'InterviewDecision'`

- [ ] **Step 3: Add InterviewDecision to `backend/models/contracts.py`**

Append to the bottom of the existing file (after `MemoryProfile`):

```python
class InterviewDecision(_Base):
    action: Literal["follow_up", "advance", "complete"]
    follow_up_prompt: str | None = None
    current_question_id: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_contracts.py -v -k "interview_decision"`
Expected: PASS (2 passed)

- [ ] **Step 5: Run full suite to confirm nothing regressed**

Run: `pytest -q`
Expected: 16 passed, 1 skipped

- [ ] **Step 6: Commit**

```bash
git add backend/models/contracts.py backend/tests/test_contracts.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: add InterviewDecision contract" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## TASK 2: Evaluator Agent

**Files:**
- Create: `backend/prompts/evaluator.md`
- Create: `backend/agents/evaluator.py`
- Create: `backend/tests/test_evaluator_agent.py`

- [ ] **Step 1: Create `backend/prompts/evaluator.md`**

```markdown
You are the Evaluator Agent for a mock-interview platform.

Your ONLY job: score a candidate's answer and output a single JSON AnswerEvaluation.
Output STRICT JSON only — no prose, no markdown fences.

Input you receive:
- Question ID, type, difficulty, and prompt
- The candidate's full answer transcript
- The number of follow-up probes already asked (followUpCount)

Rubric by question type (score each criterion 0-5):

BEHAVIORAL (type: "behavioral"):
  structure    — Did they use STAR format (Situation, Task, Action, Result)?
  specificity  — Concrete real example, not hypothetical?
  impact       — Quantified or clearly described outcome?
  ownership    — Personal agency shown ("I did" not "we just did")?

TECHNICAL (type: "technical"):
  correctness    — Is the core answer technically accurate?
  depth          — Do they explain WHY, not just WHAT?
  edge_cases     — Did they identify failure modes or boundary conditions?
  communication  — Could a non-expert follow the explanation?

SYSTEM_DESIGN (type: "system_design"):
  requirements  — Did they clarify scope before designing?
  scalability   — Did they reason about scale and bottlenecks?
  tradeoffs     — Did they name tradeoffs explicitly?
  depth         — Did they go beyond surface-level components?

Output schema (camelCase keys):
- questionId: string  (echo the Question ID you received)
- transcript: string  (echo the exact answer you received)
- rubricScores: object  (keys = criteria for the question type, values = 0-5 float)
- weaknessTags: string[]  (pick from: vague-impact, no-edge-cases, rambling,
    no-star-structure, no-ownership, incorrect-core, shallow-depth,
    no-tradeoffs, no-requirements-clarification, over-specified)
- followUpCount: number  (echo the value you received)
- wouldSurviveRealInterview: boolean
- survivalReasoning: string  (1-2 sentences: EXACTLY why it would or would not
    survive a real interviewer's follow-up. Name the specific strength or weakness.
    "Good answer" or "Weak answer" alone is NOT acceptable.)

Hard rules:
- wouldSurviveRealInterview = true ONLY if ALL rubric scores are >= 3.
- Never inflate scores. A score of 3 is "acceptable but forgettable". 5 is exceptional.
- survivalReasoning must reference a specific criterion or quote from the answer.
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_evaluator_agent.py`

```python
from agents.evaluator import EvaluatorAgent
from models.contracts import PlannedQuestion


class _FakeLLM:
    def __init__(self, payload: dict):
        self._payload = payload
        self.last: dict = {}

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        self.last = {"model": model, "system": system, "user": user}
        return schema.model_validate(self._payload)


_Q_TECHNICAL = PlannedQuestion(
    id="q-tech-1", type="technical",
    prompt="Explain how Floyd's algorithm detects a cycle in a linked list.",
    targetDifficulty=3, weightedFromWeakness=False,
)

_EVAL_PAYLOAD_WEAK = {
    "questionId": "q-tech-1",
    "transcript": "You can track nodes you've seen.",
    "rubricScores": {"correctness": 2.0, "depth": 1.0, "edge_cases": 0.0, "communication": 2.0},
    "weaknessTags": ["shallow-depth", "no-edge-cases"],
    "followUpCount": 1,
    "wouldSurviveRealInterview": False,
    "survivalReasoning": "Answer names no algorithm and skips edge cases entirely.",
}

_EVAL_PAYLOAD_STRONG = {
    "questionId": "q-tech-1",
    "transcript": "Floyd's algorithm uses two pointers...",
    "rubricScores": {"correctness": 5.0, "depth": 4.0, "edge_cases": 4.0, "communication": 4.0},
    "weaknessTags": [],
    "followUpCount": 0,
    "wouldSurviveRealInterview": True,
    "survivalReasoning": "Candidate named Floyd's algorithm, explained the two-pointer invariant, and addressed the empty-list edge case.",
}


def test_evaluator_passes_question_and_transcript_to_llm():
    llm = _FakeLLM(_EVAL_PAYLOAD_WEAK)
    agent = EvaluatorAgent(llm=llm, model="eval-model")
    ev = agent.run(question=_Q_TECHNICAL, transcript="You can track nodes.", follow_up_count=1)

    assert ev.question_id == "q-tech-1"
    assert ev.would_survive_real_interview is False
    assert "q-tech-1" in llm.last["user"]
    assert "Floyd" in llm.last["user"]
    assert "You can track nodes." in llm.last["user"]
    assert "1" in llm.last["user"]  # follow_up_count forwarded
    assert llm.last["model"] == "eval-model"


def test_evaluator_strong_answer_survives():
    llm = _FakeLLM(_EVAL_PAYLOAD_STRONG)
    agent = EvaluatorAgent(llm=llm, model="eval-model")
    ev = agent.run(question=_Q_TECHNICAL, transcript="Floyd's algorithm uses two pointers...", follow_up_count=0)

    assert ev.would_survive_real_interview is True
    assert ev.survival_reasoning  # non-empty reasoning required
    assert not ev.weakness_tags
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_evaluator_agent.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.evaluator'`

- [ ] **Step 4: Create `backend/agents/evaluator.py`**

```python
from pathlib import Path
from models.contracts import AnswerEvaluation, PlannedQuestion

_PROMPT = (Path(__file__).resolve().parent.parent / "prompts" / "evaluator.md").read_text()


class EvaluatorAgent:
    def __init__(self, llm, model: str):
        self._llm = llm
        self._model = model

    def run(self, *, question: PlannedQuestion, transcript: str, follow_up_count: int) -> AnswerEvaluation:
        user = (
            f"Question ID: {question.id}\n"
            f"Question Type: {question.type}\n"
            f"Difficulty: {question.target_difficulty}\n"
            f"Question: {question.prompt}\n\n"
            f"Candidate Answer:\n{transcript}\n\n"
            f"Follow-up count: {follow_up_count}"
        )
        return self._llm.structured(
            model=self._model, system=_PROMPT, user=user, schema=AnswerEvaluation,
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_evaluator_agent.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/evaluator.md backend/agents/evaluator.py backend/tests/test_evaluator_agent.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: add evaluator agent" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## TASK 3: Interviewer Agent

**Files:**
- Create: `backend/prompts/interviewer.md`
- Create: `backend/agents/interviewer.py`
- Create: `backend/tests/test_interviewer_agent.py`

- [ ] **Step 1: Create `backend/prompts/interviewer.md`**

```markdown
You are the Interviewer Agent for a mock-interview platform.

You have just received the candidate's answer to the current interview question.
Decide what happens next and output a single JSON InterviewDecision.
Output STRICT JSON only — no prose, no markdown fences.

Input you receive:
- The question asked (ID, type, difficulty, prompt)
- The candidate's answer transcript
- followUpCount: how many probing follow-ups have already been asked for this question
- isLastQuestion: true if this is the final question in the session

Decision rules (apply in order):
1. If followUpCount >= 2 → always output action="complete" (if isLastQuestion) or action="advance".
   Never follow up more than twice on one question.
2. If followUpCount < 2 AND the answer is vague, incomplete, or unproven → action="follow_up".
3. Otherwise (answer is concrete) → action="advance" or action="complete" (if isLastQuestion).

What counts as vague / incomplete:
- Behavioral: no concrete situation, no real outcome, no personal ownership ("we did it")
- Technical: correct label but no mechanism explained, no edge cases
- System design: jumps to components without clarifying scope or naming tradeoffs
- Any answer < 3 sentences with no specifics

What counts as concrete / sufficient:
- Behavioral: specific past situation + personal action + measurable outcome
- Technical: correct mechanism + at least one edge case or complexity addressed
- System design: scope stated + tradeoffs named + scale reasoning present

Output schema (camelCase):
- action: "follow_up" | "advance" | "complete"
- followUpPrompt: string | null  (required and non-null ONLY when action="follow_up")
- currentQuestionId: string  (echo the Question ID)

Rules for followUpPrompt when action="follow_up":
- Must target the SPECIFIC gap in the answer (quote or reference the candidate's wording)
- Must be a single direct question, max 1 sentence
- BANNED openers: "Great answer", "Good point", "Can you tell me more?", "Interesting"
- GOOD examples:
    "You said you 'made the team stay focused' — what specific process or tool did you use?"
    "You mentioned caching but didn't address what happens on a cache miss — walk me through that."
    "What's the time complexity of the approach you just described?"
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_interviewer_agent.py`

```python
from agents.interviewer import InterviewerAgent
from models.contracts import PlannedQuestion

_Q = PlannedQuestion(
    id="q-beh-1", type="behavioral",
    prompt="Tell me about a time you led a project under a tight deadline.",
    targetDifficulty=3, weightedFromWeakness=False,
)

_VAGUE_ANSWER = "Yeah we had a tight deadline and I made sure the team stayed focused and we got it done."
_CONCRETE_ANSWER = (
    "At Fintech Corp in 2023 I led a 4-person team to ship a KYC module in 3 weeks instead of 6. "
    "I unblocked the critical path by pairing directly on the slowest service for 2 days. "
    "We shipped on day 19 with zero P1 bugs. Customer onboarding latency dropped from 48h to 4h."
)


class _FakeLLM:
    def __init__(self, payload: dict):
        self._payload = payload
        self.last: dict = {}

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        self.last = {"model": model, "user": user}
        return schema.model_validate(self._payload)


def test_interviewer_forwards_context_to_llm():
    llm = _FakeLLM({
        "action": "follow_up",
        "followUpPrompt": "You said 'stayed focused' — what specific action did you personally take?",
        "currentQuestionId": "q-beh-1",
    })
    agent = InterviewerAgent(llm=llm, model="iv-model")
    decision = agent.run_turn(question=_Q, candidate_answer=_VAGUE_ANSWER,
                               follow_up_count=0, is_last_question=False)

    assert decision.action == "follow_up"
    assert decision.follow_up_prompt is not None
    assert "q-beh-1" in llm.last["user"]
    assert _VAGUE_ANSWER in llm.last["user"]
    assert "followUpCount: 0" in llm.last["user"]
    assert llm.last["model"] == "iv-model"


def test_interviewer_advance_on_max_followups():
    """When follow_up_count >= 2, agent must NOT follow up regardless of answer quality."""
    llm = _FakeLLM({
        "action": "advance",
        "followUpPrompt": None,
        "currentQuestionId": "q-beh-1",
    })
    agent = InterviewerAgent(llm=llm, model="iv-model")
    decision = agent.run_turn(question=_Q, candidate_answer=_VAGUE_ANSWER,
                               follow_up_count=2, is_last_question=False)

    assert decision.action == "advance"
    assert decision.follow_up_prompt is None
    # follow_up_count surfaced in prompt so model obeys the rule
    assert "followUpCount: 2" in llm.last["user"]


def test_interviewer_complete_on_last_question():
    llm = _FakeLLM({
        "action": "complete",
        "followUpPrompt": None,
        "currentQuestionId": "q-beh-1",
    })
    agent = InterviewerAgent(llm=llm, model="iv-model")
    decision = agent.run_turn(question=_Q, candidate_answer=_CONCRETE_ANSWER,
                               follow_up_count=0, is_last_question=True)

    assert decision.action == "complete"
    assert "isLastQuestion: true" in llm.last["user"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_interviewer_agent.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.interviewer'`

- [ ] **Step 4: Create `backend/agents/interviewer.py`**

```python
from pathlib import Path
from models.contracts import InterviewDecision, PlannedQuestion

_PROMPT = (Path(__file__).resolve().parent.parent / "prompts" / "interviewer.md").read_text()


class InterviewerAgent:
    def __init__(self, llm, model: str):
        self._llm = llm
        self._model = model

    def run_turn(
        self,
        *,
        question: PlannedQuestion,
        candidate_answer: str,
        follow_up_count: int,
        is_last_question: bool,
    ) -> InterviewDecision:
        user = (
            f"Question ID: {question.id}\n"
            f"Question Type: {question.type}\n"
            f"Difficulty: {question.target_difficulty}\n"
            f"Question: {question.prompt}\n\n"
            f"Candidate Answer:\n{candidate_answer}\n\n"
            f"followUpCount: {follow_up_count}\n"
            f"isLastQuestion: {'true' if is_last_question else 'false'}"
        )
        return self._llm.structured(
            model=self._model, system=_PROMPT, user=user, schema=InterviewDecision,
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_interviewer_agent.py -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: 21 passed, 1 skipped

- [ ] **Step 7: Commit**

```bash
git add backend/prompts/interviewer.md backend/agents/interviewer.py backend/tests/test_interviewer_agent.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: add interviewer agent" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## TASK 4: Interview turn LangGraph

**Files:**
- Create: `backend/graph/interview_turn.py`
- Create: `backend/tests/test_interview_turn_graph.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_interview_turn_graph.py`

```python
from graph.interview_turn import build_interview_turn_graph, InterviewTurnState
from models.contracts import (
    AnswerEvaluation, InterviewDecision, PlannedQuestion, QuestionPlan,
)


class _ScriptedLLM:
    """Pops payloads in order — first call returns payload[0], second returns payload[1]."""
    def __init__(self, *payloads: dict):
        self._payloads = list(payloads)

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        return schema.model_validate(self._payloads.pop(0))


def _plan(n: int = 2) -> QuestionPlan:
    return QuestionPlan(
        sessionId="sess-t",
        questions=[
            PlannedQuestion(id=f"q{i}", type="technical",
                            prompt=f"Q{i}", targetDifficulty=3, weightedFromWeakness=False)
            for i in range(n)
        ],
    )


_FOLLOW_UP_DECISION = {
    "action": "follow_up",
    "followUpPrompt": "What was the time complexity?",
    "currentQuestionId": "q0",
}

_ADVANCE_DECISION = {
    "action": "advance",
    "followUpPrompt": None,
    "currentQuestionId": "q0",
}

_COMPLETE_DECISION = {
    "action": "complete",
    "followUpPrompt": None,
    "currentQuestionId": "q1",
}

_EVAL = {
    "questionId": "q0", "transcript": "some answer",
    "rubricScores": {"correctness": 4.0}, "weaknessTags": [],
    "followUpCount": 0, "wouldSurviveRealInterview": True,
    "survivalReasoning": "Answer was correct and specific.",
}


def test_follow_up_action_returns_prompt_without_evaluating():
    """When interviewer says follow_up, evaluator must NOT be called."""
    llm = _ScriptedLLM(_FOLLOW_UP_DECISION)  # only 1 payload — if evaluator fires, it'll explode
    graph = build_interview_turn_graph(llm=llm, interviewer_model="iv", evaluator_model="ev")

    state: InterviewTurnState = {
        "plan": _plan(),
        "current_question_idx": 0,
        "follow_up_count": 0,
        "candidate_answer": "It runs fast.",
        "evaluations": [],
    }
    result = graph.invoke(state)

    assert result["decision"].action == "follow_up"
    assert result["decision"].follow_up_prompt == "What was the time complexity?"
    assert result.get("evaluation") is None
    assert result["follow_up_count"] == 1  # incremented


def test_advance_action_triggers_evaluator_and_advances_idx():
    """advance → evaluator runs → current_question_idx increments."""
    llm = _ScriptedLLM(_ADVANCE_DECISION, _EVAL)
    graph = build_interview_turn_graph(llm=llm, interviewer_model="iv", evaluator_model="ev")

    state: InterviewTurnState = {
        "plan": _plan(),
        "current_question_idx": 0,
        "follow_up_count": 1,
        "candidate_answer": "Floyd's uses two pointers...",
        "evaluations": [],
    }
    result = graph.invoke(state)

    assert result["decision"].action == "advance"
    assert isinstance(result["evaluation"], AnswerEvaluation)
    assert result["evaluation"].would_survive_real_interview is True
    assert len(result["evaluations"]) == 1
    assert result["current_question_idx"] == 1
    assert result["follow_up_count"] == 0  # reset for next question


def test_complete_action_sets_session_complete_flag():
    """complete → evaluator runs → session_complete=True."""
    llm = _ScriptedLLM(_COMPLETE_DECISION, {**_EVAL, "questionId": "q1"})
    graph = build_interview_turn_graph(llm=llm, interviewer_model="iv", evaluator_model="ev")

    state: InterviewTurnState = {
        "plan": _plan(),
        "current_question_idx": 1,
        "follow_up_count": 0,
        "candidate_answer": "Floyd's uses two pointers...",
        "evaluations": [],
    }
    result = graph.invoke(state)

    assert result["session_complete"] is True
    assert len(result["evaluations"]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_interview_turn_graph.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'graph.interview_turn'`

- [ ] **Step 3: Create `backend/graph/interview_turn.py`**

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from models.contracts import (
    AnswerEvaluation, InterviewDecision, QuestionPlan,
)
from agents.evaluator import EvaluatorAgent
from agents.interviewer import InterviewerAgent


class InterviewTurnState(TypedDict, total=False):
    plan: QuestionPlan
    current_question_idx: int
    follow_up_count: int
    candidate_answer: str
    decision: InterviewDecision
    evaluation: AnswerEvaluation | None
    evaluations: list[AnswerEvaluation]
    session_complete: bool


def build_interview_turn_graph(*, llm, interviewer_model: str, evaluator_model: str):
    interviewer = InterviewerAgent(llm=llm, model=interviewer_model)
    evaluator = EvaluatorAgent(llm=llm, model=evaluator_model)

    def interviewer_node(state: InterviewTurnState) -> InterviewTurnState:
        idx = state["current_question_idx"]
        questions = state["plan"].questions
        question = questions[idx]
        is_last = idx == len(questions) - 1

        decision = interviewer.run_turn(
            question=question,
            candidate_answer=state["candidate_answer"],
            follow_up_count=state["follow_up_count"],
            is_last_question=is_last,
        )
        updates: InterviewTurnState = {"decision": decision}
        if decision.action == "follow_up":
            updates["follow_up_count"] = state["follow_up_count"] + 1
        return updates

    def evaluator_node(state: InterviewTurnState) -> InterviewTurnState:
        idx = state["current_question_idx"]
        question = state["plan"].questions[idx]

        evaluation = evaluator.run(
            question=question,
            transcript=state["candidate_answer"],
            follow_up_count=state["follow_up_count"],
        )
        prior = list(state.get("evaluations") or [])
        action = state["decision"].action
        return {
            "evaluation": evaluation,
            "evaluations": [*prior, evaluation],
            "current_question_idx": idx + 1 if action == "advance" else idx,
            "follow_up_count": 0,
            "session_complete": action == "complete",
        }

    def route_after_interviewer(state: InterviewTurnState) -> str:
        return "evaluator" if state["decision"].action in ("advance", "complete") else END

    g = StateGraph(InterviewTurnState)
    g.add_node("interviewer", interviewer_node)
    g.add_node("evaluator", evaluator_node)
    g.add_edge(START, "interviewer")
    g.add_conditional_edges("interviewer", route_after_interviewer, {"evaluator": "evaluator", END: END})
    g.add_edge("evaluator", END)
    return g.compile()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_interview_turn_graph.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: 24 passed, 1 skipped

- [ ] **Step 6: Commit**

```bash
git add backend/graph/interview_turn.py backend/tests/test_interview_turn_graph.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: wire interviewer and evaluator via langgraph" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## TASK 5: Interactive CLI text loop

**Files:**
- Create: `backend/cli/run_interview.py`

- [ ] **Step 1: Create `backend/cli/run_interview.py`**

```python
"""Text-mode interview loop. Runs a full session in the terminal.

Usage (from backend/ with venv active):
    python -m cli.run_interview --resume path/to/resume.txt \
        --jd path/to/jd.txt --role sde
"""
import argparse
import uuid

from config.settings import Settings
from llm.client import LLMClient
from models.contracts import MemoryProfile
from graph.session_start import build_session_start_graph
from graph.interview_turn import build_interview_turn_graph, InterviewTurnState


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", required=True)
    parser.add_argument("--jd", required=True)
    parser.add_argument("--role", default="sde")
    args = parser.parse_args()

    settings = Settings()
    llm = LLMClient(region=settings.aws_region)

    # Phase 1: build the question plan
    session_graph = build_session_start_graph(
        llm=llm, intake_model=settings.intake_model, planner_model=settings.planner_model,
    )
    session_result = session_graph.invoke({
        "session_id": str(uuid.uuid4()),
        "resume_text": open(args.resume).read(),
        "jd_text": open(args.jd).read(),
        "role_key": args.role,
        "memory": MemoryProfile(
            candidateId="local-dev", recurringWeaknesses=[], improvementTrend=[], strongAreas=[],
        ),
    })
    plan = session_result["plan"]

    print(f"\n{'='*60}")
    print(f"Interview ready — {len(plan.questions)} questions")
    print(f"{'='*60}\n")

    # Phase 2: run turns
    turn_graph = build_interview_turn_graph(
        llm=llm,
        interviewer_model=settings.planner_model,   # Opus for quality
        evaluator_model=settings.planner_model,
    )

    state: InterviewTurnState = {
        "plan": plan,
        "current_question_idx": 0,
        "follow_up_count": 0,
        "candidate_answer": "",
        "evaluations": [],
    }

    # Ask the first question
    current_q = plan.questions[0]
    print(f"[Q1/{len(plan.questions)}] {current_q.prompt}\n")

    while True:
        answer = input("You: ").strip()
        if not answer:
            continue

        state["candidate_answer"] = answer
        state = dict(state)  # copy before mutation
        result = turn_graph.invoke(state)
        state.update(result)

        decision = result["decision"]

        if decision.action == "follow_up":
            print(f"\nInterviewer: {decision.follow_up_prompt}\n")

        elif decision.action in ("advance", "complete"):
            ev = result.get("evaluation")
            if ev:
                survived = "PASS" if ev.would_survive_real_interview else "FAIL"
                print(f"\n[{survived}] {ev.survival_reasoning}")
                scores_str = ", ".join(f"{k}={v}" for k, v in ev.rubric_scores.items())
                print(f"Scores: {scores_str}")
                if ev.weakness_tags:
                    print(f"Weaknesses: {', '.join(ev.weakness_tags)}")
                print()

            if decision.action == "complete" or result.get("session_complete"):
                print(f"\n{'='*60}")
                print("Session complete.")
                total = len(result.get("evaluations") or [])
                passed = sum(1 for e in (result.get("evaluations") or [])
                             if e.would_survive_real_interview)
                print(f"Results: {passed}/{total} answers would survive a real interview.")
                print(f"{'='*60}\n")
                break

            # next question
            next_idx = result["current_question_idx"]
            if next_idx < len(plan.questions):
                next_q = plan.questions[next_idx]
                print(f"[Q{next_idx + 1}/{len(plan.questions)}] {next_q.prompt}\n")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-check import**

Run: `python -c "import cli.run_interview"` (from `backend/` with venv active)
Expected: clean import, no error.

- [ ] **Step 3: Commit**

```bash
git add backend/cli/run_interview.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: add interactive text interview cli" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## TASK 6: Gated behavioral eval harness

**Files:**
- Create: `backend/evals/golden/interview_turn_cases.json`
- Create: `backend/evals/test_interview_turn_eval.py`

- [ ] **Step 1: Create `backend/evals/golden/interview_turn_cases.json`**

```json
[
  {
    "case": "vague_behavioral_gets_followup",
    "question": {
      "id": "q-beh-vague", "type": "behavioral",
      "prompt": "Tell me about a time you led a project under a tight deadline.",
      "targetDifficulty": 3, "weightedFromWeakness": false
    },
    "candidate_answer": "Yeah we had a tight deadline and I made sure the team stayed focused and we got it done on time.",
    "follow_up_count": 0,
    "is_last_question": false,
    "expect_action": "follow_up",
    "expect_would_survive": null
  },
  {
    "case": "concrete_behavioral_advances",
    "question": {
      "id": "q-beh-concrete", "type": "behavioral",
      "prompt": "Tell me about a time you led a project under a tight deadline.",
      "targetDifficulty": 3, "weightedFromWeakness": false
    },
    "candidate_answer": "At Fintech Corp in 2023 I led a 4-person team to ship a KYC verification module in 3 weeks instead of the planned 6. The critical blocker was a slow data-normalisation service. I paired directly with the engineer owning it for 2 days and we cut its p99 latency from 4 seconds to 180ms. We shipped on day 19 with zero P1 bugs and customer onboarding time dropped from 48 hours to 4 hours.",
    "follow_up_count": 0,
    "is_last_question": false,
    "expect_action": "advance",
    "expect_would_survive": null
  },
  {
    "case": "vague_technical_evaluated_as_fail",
    "question": {
      "id": "q-tech-vague", "type": "technical",
      "prompt": "Explain how Floyd's cycle-detection algorithm works.",
      "targetDifficulty": 2, "weightedFromWeakness": false
    },
    "candidate_answer": "You basically keep two pointers and move them and if they meet you know there's a cycle.",
    "follow_up_count": 2,
    "is_last_question": false,
    "expect_action": "advance",
    "expect_would_survive": false
  },
  {
    "case": "strong_technical_evaluated_as_pass",
    "question": {
      "id": "q-tech-strong", "type": "technical",
      "prompt": "Explain how Floyd's cycle-detection algorithm works.",
      "targetDifficulty": 2, "weightedFromWeakness": false
    },
    "candidate_answer": "Floyd's algorithm uses two pointers, slow and fast, starting at head. Slow advances one node per step, fast advances two. If there is a cycle, fast will eventually lap slow and they will point to the same node — this is the cycle-detection invariant. If fast reaches null the list is acyclic. Time complexity O(n), space O(1) since we use no extra storage. An edge case is an empty list or a list of one node with no self-pointer, both of which terminate immediately when fast.next is null.",
    "follow_up_count": 0,
    "is_last_question": false,
    "expect_action": "advance",
    "expect_would_survive": true
  }
]
```

- [ ] **Step 2: Create `backend/evals/test_interview_turn_eval.py`**

```python
import json
import os
from pathlib import Path

import pytest

from config.settings import Settings
from llm.client import LLMClient
from models.contracts import PlannedQuestion
from agents.interviewer import InterviewerAgent
from agents.evaluator import EvaluatorAgent

_CASES_FILE = Path(__file__).parent / "golden" / "interview_turn_cases.json"

pytestmark = pytest.mark.skipif(
    os.getenv("INTERVIEWAI_RUN_LLM_EVALS", "0") != "1",
    reason="Set INTERVIEWAI_RUN_LLM_EVALS=1 to run real-LLM evals (costs money).",
)


@pytest.fixture(scope="module")
def agents():
    settings = Settings()
    llm = LLMClient(region=settings.aws_region)
    return {
        "interviewer": InterviewerAgent(llm=llm, model=settings.planner_model),
        "evaluator": EvaluatorAgent(llm=llm, model=settings.planner_model),
    }


@pytest.mark.parametrize("case", json.loads(_CASES_FILE.read_text()))
def test_interview_turn_behavior(case, agents):
    question = PlannedQuestion.model_validate(case["question"])
    interviewer: InterviewerAgent = agents["interviewer"]
    evaluator: EvaluatorAgent = agents["evaluator"]

    decision = interviewer.run_turn(
        question=question,
        candidate_answer=case["candidate_answer"],
        follow_up_count=case["follow_up_count"],
        is_last_question=case["is_last_question"],
    )

    assert decision.action == case["expect_action"], (
        f"[{case['case']}] expected action={case['expect_action']!r} "
        f"but got {decision.action!r}. "
        f"follow_up_prompt={decision.follow_up_prompt!r}"
    )

    if decision.action == "follow_up":
        assert decision.follow_up_prompt, f"[{case['case']}] follow_up_prompt must be non-empty"
        assert len(decision.follow_up_prompt) > 10, "follow_up_prompt too short to be meaningful"

    # For cases that advance, also check evaluator judgment
    if case["expect_would_survive"] is not None:
        evaluation = evaluator.run(
            question=question,
            transcript=case["candidate_answer"],
            follow_up_count=case["follow_up_count"],
        )
        assert evaluation.would_survive_real_interview == case["expect_would_survive"], (
            f"[{case['case']}] wouldSurviveRealInterview expected "
            f"{case['expect_would_survive']} but got {evaluation.would_survive_real_interview}. "
            f"Reasoning: {evaluation.survival_reasoning}"
        )
        assert evaluation.survival_reasoning, "survivalReasoning must not be empty"
```

- [ ] **Step 3: Run (should skip by default)**

Run: `pytest evals/test_interview_turn_eval.py -v`
Expected: 4 tests SKIPPED (real-LLM gate off)

- [ ] **Step 4: Run full suite**

Run: `pytest -q`
Expected: 24 passed, 5 skipped (1 original + 4 new)

- [ ] **Step 5: Commit**

```bash
git add backend/evals/golden/interview_turn_cases.json backend/evals/test_interview_turn_eval.py
git -c user.name='Karthik' -c user.email='karthikreddyy386@gmail.com' commit -m "feat: add gated behavioral eval harness for interview turn" --author='Karthik <karthikreddyy386@gmail.com>'
```

---

## Self-Review

**Spec coverage (Phase 2 scope):**
- Interviewer Agent with "push back on vague answers" instruction → Task 3 + prompt. ✓
- "Never say great answer unless rubric met" → enforced in interviewer.md. ✓
- Probe with "why/how" at least once per answer → follow_up_count < 2 gate in agent + prompt. ✓
- Evaluator Agent with rubric scoring → Task 2 + prompt. ✓
- `wouldSurviveRealInterview` bool + `survivalReasoning` non-empty string → AnswerEvaluation contract (Phase 1) + evaluator prompt. ✓
- Schema validation at every agent boundary (no raw text between agents) → LLMClient.structured() enforces this for both agents. ✓
- Per-turn LangGraph → Task 4. ✓
- follow_up → no evaluator call; advance/complete → evaluator runs → idx increments → follow_up_count resets → session_complete flag. ✓
- Accuracy eval harness: vague gets follow_up, concrete advances, vague evaluated as fail, strong as pass. ✓
- Deferred (correctly out of scope): Memory Agent aggregation, AgentCore, voice (Pipecat/Deepgram/ElevenLabs), avatar (Tavus). ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete and runnable.

**Type consistency:**
- `InterviewerAgent.run_turn(question, candidate_answer, follow_up_count, is_last_question)` — called identically in tests, graph nodes, CLI, and eval harness.
- `EvaluatorAgent.run(question, transcript, follow_up_count)` — called identically in tests, graph node, and eval harness.
- `InterviewTurnState` keys (`plan`, `current_question_idx`, `follow_up_count`, `candidate_answer`, `evaluations`, `decision`, `evaluation`, `session_complete`) — consistent across graph definition, tests, and CLI.
- `build_interview_turn_graph(llm, interviewer_model, evaluator_model)` — consistent in tests and CLI.
