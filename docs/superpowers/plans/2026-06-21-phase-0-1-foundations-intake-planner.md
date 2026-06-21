# Phase 0 + Phase 1: Foundations, Intake & Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the text-only personalization core — parse a résumé + job description into a strict `IntakeProfile`, then generate a personalized `QuestionPlan` grounded on curated competency maps, for SDE and AI Engineer roles.

**Architecture:** A Python backend with Pydantic data contracts mirroring the TypeScript interfaces, a thin mockable Claude-on-Bedrock client, two LangGraph nodes (Intake → Planner), and local JSON seed data for competency maps / rubrics / exemplars. Cloud infra (AgentCore, Aurora, Cognito) is deferred to later-phase plans.

**Tech Stack:** Python 3.12, Pydantic v2 + pydantic-settings, anthropic[bedrock], LangGraph, pytest, python-dotenv.

---

## File Structure

```
backend/
  pyproject.toml            # deps + tooling
  .env.example              # documented env vars (no secrets committed)
  config/
    settings.py             # env-driven settings (model IDs, region)
  models/
    contracts.py            # IntakeProfile, QuestionPlan, AnswerEvaluation, MemoryProfile
    question_data.py        # CompetencyMap, Rubric, QuestionExemplar
  llm/
    client.py               # LLMClient wrapper over AnthropicBedrock (mockable)
    json_utils.py           # tolerant JSON extraction from model output
  agents/
    intake.py               # Intake Agent
    planner.py              # Planner Agent
  graph/
    session_start.py        # LangGraph wiring Intake -> Planner
  prompts/
    intake.md               # Intake system prompt
    planner.md              # Planner system prompt
  data/
    competencies/
      sde.json
      ai_engineer.json
  cli/
    run_session_start.py    # manual end-to-end runner (text)
  evals/
    golden/
      sde_backend_candidate.json
    test_session_start_eval.py  # gated real-LLM eval (env-flagged)
tests/
  test_contracts.py
  test_question_data.py
  test_llm_client.py
  test_intake_agent.py
  test_planner_agent.py
  test_session_start_graph.py
```

---

## PHASE 0 — FOUNDATIONS

### Task 1: Python project scaffold

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/tests/__init__.py`
- Create: `backend/conftest.py`

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "interviewai-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "anthropic[bedrock]>=0.40",
  "langgraph>=0.2",
  "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "pytest-cov>=5.0"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests", "evals"]
addopts = "-q"
```

- [ ] **Step 2: Create `backend/.env.example`**

```bash
# Bedrock / AWS
AWS_REGION=us-east-1
# Model IDs are Bedrock inference-profile IDs — CONFIRM exact values in the
# Bedrock console for your region; these are env-overridable defaults.
INTERVIEWAI_INTAKE_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
INTERVIEWAI_PLANNER_MODEL=us.anthropic.claude-opus-4-8-v1:0
# Set to 1 to run gated real-LLM eval tests
INTERVIEWAI_RUN_LLM_EVALS=0
```

- [ ] **Step 3: Create empty `backend/tests/__init__.py`** (empty file).

- [ ] **Step 4: Create `backend/conftest.py`**

```python
import os
import pytest


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    # Tests must never depend on a developer's real AWS creds.
    monkeypatch.setenv("AWS_REGION", "us-east-1")
```

- [ ] **Step 5: Install and verify**

Run:
```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest
```
Expected: pytest runs and reports "no tests ran" (exit 5) — environment works.

- [ ] **Step 6: Commit**

```bash
git add backend/pyproject.toml backend/.env.example backend/tests/__init__.py backend/conftest.py
git commit -m "chore: scaffold python backend project"
```

---

### Task 2: Settings module

**Files:**
- Create: `backend/config/__init__.py` (empty)
- Create: `backend/config/settings.py`
- Test: `backend/tests/test_settings.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_settings.py`

```python
from config.settings import Settings


def test_defaults_present():
    s = Settings()
    assert s.intake_model
    assert s.planner_model
    assert s.aws_region == "us-east-1"


def test_env_override(monkeypatch):
    monkeypatch.setenv("INTERVIEWAI_PLANNER_MODEL", "custom-model-id")
    s = Settings()
    assert s.planner_model == "custom-model-id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_settings.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'config.settings'`

- [ ] **Step 3: Create `backend/config/__init__.py`** (empty), then write `backend/config/settings.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INTERVIEWAI_", env_file=".env", extra="ignore")

    aws_region: str = "us-east-1"
    intake_model: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    planner_model: str = "us.anthropic.claude-opus-4-8-v1:0"
    run_llm_evals: bool = False
```

Note: `aws_region` reads `INTERVIEWAI_AWS_REGION`; the plain `AWS_REGION` is consumed by the AWS SDK separately. Keep both in `.env.example`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_settings.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/config tests/test_settings.py
git commit -m "feat: add env-driven settings"
```

---

### Task 3: Core data contracts

**Files:**
- Create: `backend/models/__init__.py` (empty)
- Create: `backend/models/contracts.py`
- Test: `backend/tests/test_contracts.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_contracts.py`

```python
from models.contracts import (
    IntakeProfile, ProjectHighlight, QuestionPlan, PlannedQuestion,
    AnswerEvaluation, MemoryProfile,
)


def test_intake_profile_camelcase_roundtrip():
    payload = {
        "candidateSkills": ["python", "aws"],
        "yearsExperience": 4.5,
        "projectHighlights": [
            {"title": "Billing", "description": "Rewrote billing", "technologies": ["python"]}
        ],
        "targetRole": "SDE",
        "jdRequirements": ["distributed systems"],
        "resumeToJdGaps": ["no kafka experience"],
    }
    profile = IntakeProfile.model_validate(payload)
    assert profile.years_experience == 4.5
    assert profile.project_highlights[0].title == "Billing"
    # Serializes back to camelCase for the TS frontend
    assert profile.model_dump(by_alias=True)["candidateSkills"] == ["python", "aws"]


def test_planned_question_difficulty_bounds():
    q = PlannedQuestion(
        id="q1", type="technical", prompt="Explain a deadlock",
        targetDifficulty=3, weightedFromWeakness=False,
    )
    assert q.target_difficulty == 3


def test_answer_evaluation_requires_survival_fields():
    ev = AnswerEvaluation(
        questionId="q1", transcript="...", rubricScores={"depth": 2},
        weaknessTags=["vague-impact"], followUpCount=1,
        wouldSurviveRealInterview=False, survivalReasoning="No concrete metrics given.",
    )
    assert ev.would_survive_real_interview is False
    assert ev.survival_reasoning
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_contracts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'models.contracts'`

- [ ] **Step 3: Create `backend/models/__init__.py`** (empty), then write `backend/models/contracts.py`

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_contracts.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/models tests/test_contracts.py
git commit -m "feat: add core pydantic data contracts"
```

---

### Task 4: LLM client (mockable Bedrock wrapper)

**Files:**
- Create: `backend/llm/__init__.py` (empty)
- Create: `backend/llm/json_utils.py`
- Create: `backend/llm/client.py`
- Test: `backend/tests/test_llm_client.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_llm_client.py`

```python
from pydantic import BaseModel
from llm.client import LLMClient
from llm.json_utils import extract_json


class _Shape(BaseModel):
    name: str
    count: int


class _FakeMessage:
    def __init__(self, text):
        self.content = [type("Block", (), {"text": text})()]


class _FakeClient:
    def __init__(self, text):
        self._text = text
        self.calls = []

    @property
    def messages(self):
        outer = self

        class _M:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return _FakeMessage(outer._text)
        return _M()


def test_extract_json_handles_fenced_block():
    raw = 'here you go:\n```json\n{"a": 1}\n```\nthanks'
    assert extract_json(raw) == {"a": 1}


def test_structured_validates_into_schema():
    fake = _FakeClient('{"name": "widget", "count": 3}')
    client = LLMClient(client=fake)
    result = client.structured(
        model="m", system="s", user="u", schema=_Shape,
    )
    assert result.name == "widget" and result.count == 3
    assert fake.calls[0]["model"] == "m"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_llm_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'llm.client'`

- [ ] **Step 3: Create `backend/llm/__init__.py`** (empty), then `backend/llm/json_utils.py`

```python
import json
import re

_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)


def extract_json(text: str):
    """Pull the first JSON object/array out of model output, fenced or raw."""
    match = _FENCE.search(text)
    candidate = match.group(1) if match else text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end != -1:
            return json.loads(candidate[start : end + 1])
        raise
```

- [ ] **Step 4: Write `backend/llm/client.py`**

```python
from typing import TypeVar
from pydantic import BaseModel
from llm.json_utils import extract_json

T = TypeVar("T", bound=BaseModel)


class LLMClient:
    """Thin, mockable wrapper over Claude on Bedrock.

    Pass a custom `client` in tests; in production it lazily builds an
    AnthropicBedrock client so importing this module never needs AWS creds.
    """

    def __init__(self, client=None, region: str = "us-east-1"):
        self._client = client
        self._region = region

    def _ensure_client(self):
        if self._client is None:
            from anthropic import AnthropicBedrock
            self._client = AnthropicBedrock(aws_region=self._region)
        return self._client

    def structured(self, *, model: str, system: str, user: str,
                   schema: type[T], max_tokens: int = 2000) -> T:
        client = self._ensure_client()
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = message.content[0].text
        return schema.model_validate(extract_json(text))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_llm_client.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/llm tests/test_llm_client.py
git commit -m "feat: add mockable bedrock llm client"
```

---

## PHASE 1 — INTAKE, PLANNER & QUESTION DATA

### Task 5: Question-data domain models

**Files:**
- Create: `backend/models/question_data.py`
- Test: `backend/tests/test_question_data.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_question_data.py`

```python
from models.question_data import CompetencyMap, Competency, Rubric, QuestionExemplar


def test_competency_map_loads_and_weights_sum_close_to_one():
    cm = CompetencyMap(
        role="SDE",
        competencies=[
            Competency(area="DSA", weight=0.5),
            Competency(area="System Design", weight=0.5),
        ],
    )
    assert cm.role == "SDE"
    assert abs(sum(c.weight for c in cm.competencies) - 1.0) < 1e-6


def test_exemplar_has_followups_and_rubric():
    ex = QuestionExemplar(
        id="ex1", role="SDE", competency="DSA", type="technical", difficulty=3,
        prompt="Detect a cycle in a linked list",
        ideal_answer_points=["Floyd's algorithm", "O(1) space"],
        follow_up_hooks=["What if the list is doubly linked?"],
        rubric=Rubric(criteria={"correctness": "names a valid O(1) approach"}),
    )
    assert "correctness" in ex.rubric.criteria
    assert ex.follow_up_hooks
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_question_data.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'models.question_data'`

- [ ] **Step 3: Write `backend/models/question_data.py`**

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Competency(_Base):
    area: str
    weight: float  # 0..1, should sum to ~1 across a map


class CompetencyMap(_Base):
    role: str
    competencies: list[Competency]


class Rubric(_Base):
    # criterion name -> what a strong answer must contain
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_question_data.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/models/question_data.py tests/test_question_data.py
git commit -m "feat: add question-data domain models"
```

---

### Task 6: Seed competency maps for SDE and AI Engineer

**Files:**
- Create: `backend/data/competencies/sde.json`
- Create: `backend/data/competencies/ai_engineer.json`
- Create: `backend/models/loader.py`
- Test: `backend/tests/test_loader.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_loader.py`

```python
from models.loader import load_competency_map


def test_load_sde_map():
    cm = load_competency_map("sde")
    assert cm.role == "SDE"
    assert any(c.area.lower().startswith("data structures") for c in cm.competencies)
    assert abs(sum(c.weight for c in cm.competencies) - 1.0) < 0.01


def test_load_ai_engineer_map():
    cm = load_competency_map("ai_engineer")
    assert cm.role == "AI Engineer"
    assert any("ml" in c.area.lower() or "model" in c.area.lower() for c in cm.competencies)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_loader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'models.loader'`

- [ ] **Step 3: Create `backend/data/competencies/sde.json`**

```json
{
  "role": "SDE",
  "competencies": [
    {"area": "Data Structures & Algorithms", "weight": 0.25},
    {"area": "Coding & Implementation Quality", "weight": 0.2},
    {"area": "System Design", "weight": 0.2},
    {"area": "Concurrency & CS Fundamentals", "weight": 0.15},
    {"area": "Debugging & Testing Reasoning", "weight": 0.1},
    {"area": "Behavioral & Ownership", "weight": 0.1}
  ]
}
```

- [ ] **Step 4: Create `backend/data/competencies/ai_engineer.json`**

```json
{
  "role": "AI Engineer",
  "competencies": [
    {"area": "ML Fundamentals", "weight": 0.2},
    {"area": "LLM / Prompting / RAG / Agents", "weight": 0.2},
    {"area": "Data Pipelines & Feature Engineering", "weight": 0.15},
    {"area": "MLOps / Deployment / Monitoring", "weight": 0.15},
    {"area": "Python Coding & Math/Stats", "weight": 0.15},
    {"area": "ML System Design & Behavioral", "weight": 0.15}
  ]
}
```

- [ ] **Step 5: Write `backend/models/loader.py`**

```python
import json
from pathlib import Path
from models.question_data import CompetencyMap

_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "competencies"


def load_competency_map(role_key: str) -> CompetencyMap:
    path = _DATA_DIR / f"{role_key}.json"
    if not path.exists():
        raise FileNotFoundError(f"No competency map for role '{role_key}' at {path}")
    return CompetencyMap.model_validate(json.loads(path.read_text()))
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_loader.py -v`
Expected: PASS (2 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/data backend/models/loader.py tests/test_loader.py
git commit -m "feat: add seed competency maps for sde and ai engineer"
```

---

### Task 7: Intake Agent

**Files:**
- Create: `backend/prompts/intake.md`
- Create: `backend/agents/__init__.py` (empty)
- Create: `backend/agents/intake.py`
- Test: `backend/tests/test_intake_agent.py`

- [ ] **Step 1: Create `backend/prompts/intake.md`**

```markdown
You are the Intake Agent for a mock-interview platform.

Your ONLY job: read a candidate's résumé and a job description, and output a single
JSON object describing the candidate and the gaps between their résumé and the JD.

Output STRICT JSON only — no prose, no markdown fences. Schema (camelCase keys):
- candidateSkills: string[]
- yearsExperience: number
- projectHighlights: { title, description, technologies: string[] }[]
- targetRole: string
- targetCompany: string | null
- jdRequirements: string[]   (the concrete requirements pulled from the JD)
- resumeToJdGaps: string[]    (requirements with weak or no evidence in the résumé)

Rules:
- Be specific in resumeToJdGaps. "No demonstrated Kafka experience" beats "lacks skills".
- If years of experience is ambiguous, estimate conservatively from dated roles.
- Never invent projects or skills not present in the résumé.
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_intake_agent.py`

```python
import json
from agents.intake import IntakeAgent


class _FakeLLM:
    def __init__(self, payload):
        self._payload = payload
        self.last = None

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        self.last = {"model": model, "system": system, "user": user}
        return schema.model_validate(self._payload)


def test_intake_produces_profile_and_passes_inputs():
    payload = {
        "candidateSkills": ["python", "fastapi"],
        "yearsExperience": 3.0,
        "projectHighlights": [
            {"title": "API", "description": "Built API", "technologies": ["fastapi"]}
        ],
        "targetRole": "SDE",
        "targetCompany": None,
        "jdRequirements": ["distributed systems", "kafka"],
        "resumeToJdGaps": ["No demonstrated Kafka experience"],
    }
    llm = _FakeLLM(payload)
    agent = IntakeAgent(llm=llm, model="intake-model")
    profile = agent.run(resume_text="resume...", jd_text="jd...")

    assert profile.target_role == "SDE"
    assert "No demonstrated Kafka experience" in profile.resume_to_jd_gaps
    # prompt + both inputs were forwarded
    assert "resume..." in llm.last["user"] and "jd..." in llm.last["user"]
    assert llm.last["model"] == "intake-model"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_intake_agent.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.intake'`

- [ ] **Step 4: Create `backend/agents/__init__.py`** (empty), then write `backend/agents/intake.py`

```python
from pathlib import Path
from models.contracts import IntakeProfile

_PROMPT = (Path(__file__).resolve().parent.parent / "prompts" / "intake.md").read_text()


class IntakeAgent:
    def __init__(self, llm, model: str):
        self._llm = llm
        self._model = model

    def run(self, *, resume_text: str, jd_text: str) -> IntakeProfile:
        user = f"RESUME:\n{resume_text}\n\nJOB DESCRIPTION:\n{jd_text}"
        return self._llm.structured(
            model=self._model, system=_PROMPT, user=user, schema=IntakeProfile,
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_intake_agent.py -v`
Expected: PASS (1 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/intake.md backend/agents tests/test_intake_agent.py
git commit -m "feat: add intake agent"
```

---

### Task 8: Planner Agent

**Files:**
- Create: `backend/prompts/planner.md`
- Create: `backend/agents/planner.py`
- Test: `backend/tests/test_planner_agent.py`

- [ ] **Step 1: Create `backend/prompts/planner.md`**

```markdown
You are the Planner Agent for a mock-interview platform.

Inputs you receive in the user message:
- IntakeProfile (candidate skills, experience, résumé-to-JD gaps, target role)
- MemoryProfile (recurring weaknesses from past sessions; may be empty)
- The role's competency map (areas + weights)

Your ONLY job: output a single JSON QuestionPlan. Output STRICT JSON only.

Schema (camelCase):
- sessionId: string  (use the provided sessionId verbatim)
- questions: { id, type, prompt, targetDifficulty (1-5), weightedFromWeakness (bool) }[]

Rules:
- Generate 5 questions covering the competency map, biased toward résumé-to-JD gaps.
- For every recurring weakness in MemoryProfile, include at least one question with
  weightedFromWeakness=true and a higher targetDifficulty than you otherwise would.
- type must be one of: behavioral, technical, system_design.
- Questions must be specific to THIS candidate's background, not generic.
- Do not exceed difficulty 5 or go below 1.
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_planner_agent.py`

```python
from agents.planner import PlannerAgent
from models.contracts import IntakeProfile, MemoryProfile, RecurringWeakness
from models.loader import load_competency_map


class _FakeLLM:
    def __init__(self, payload):
        self._payload = payload
        self.last = None

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        self.last = {"user": user, "model": model}
        return schema.model_validate(self._payload)


def _profile():
    return IntakeProfile(
        candidateSkills=["python"], yearsExperience=3.0, projectHighlights=[],
        targetRole="SDE", jdRequirements=["kafka"], resumeToJdGaps=["no kafka"],
    )


def test_planner_returns_plan_with_session_id():
    payload = {
        "sessionId": "sess-1",
        "questions": [
            {"id": "q1", "type": "technical", "prompt": "Explain kafka partitions",
             "targetDifficulty": 4, "weightedFromWeakness": True},
        ],
    }
    llm = _FakeLLM(payload)
    agent = PlannerAgent(llm=llm, model="planner-model")
    mem = MemoryProfile(
        candidateId="c1",
        recurringWeaknesses=[RecurringWeakness(tag="vague-impact", frequency=3, lastSeen="2026-06-01")],
        improvementTrend=[], strongAreas=[],
    )
    plan = agent.run(
        session_id="sess-1", profile=_profile(), memory=mem,
        competency_map=load_competency_map("sde"),
    )
    assert plan.session_id == "sess-1"
    assert plan.questions[0].weighted_from_weakness is True
    # weakness tag was surfaced to the model
    assert "vague-impact" in llm.last["user"]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_planner_agent.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agents.planner'`

- [ ] **Step 4: Write `backend/agents/planner.py`**

```python
from pathlib import Path
from models.contracts import IntakeProfile, MemoryProfile, QuestionPlan
from models.question_data import CompetencyMap

_PROMPT = (Path(__file__).resolve().parent.parent / "prompts" / "planner.md").read_text()


class PlannerAgent:
    def __init__(self, llm, model: str):
        self._llm = llm
        self._model = model

    def run(self, *, session_id: str, profile: IntakeProfile,
            memory: MemoryProfile, competency_map: CompetencyMap) -> QuestionPlan:
        user = (
            f"sessionId: {session_id}\n\n"
            f"IntakeProfile:\n{profile.model_dump_json(by_alias=True, indent=2)}\n\n"
            f"MemoryProfile:\n{memory.model_dump_json(by_alias=True, indent=2)}\n\n"
            f"CompetencyMap:\n{competency_map.model_dump_json(by_alias=True, indent=2)}"
        )
        return self._llm.structured(
            model=self._model, system=_PROMPT, user=user, schema=QuestionPlan,
        )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_planner_agent.py -v`
Expected: PASS (1 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/planner.md backend/agents/planner.py tests/test_planner_agent.py
git commit -m "feat: add planner agent"
```

---

### Task 9: LangGraph wiring (Intake → Planner)

**Files:**
- Create: `backend/graph/__init__.py` (empty)
- Create: `backend/graph/session_start.py`
- Test: `backend/tests/test_session_start_graph.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_session_start_graph.py`

```python
from graph.session_start import build_session_start_graph
from models.contracts import IntakeProfile, MemoryProfile, QuestionPlan


class _ScriptedLLM:
    """Returns the intake payload first, the plan payload second."""
    def __init__(self, intake_payload, plan_payload):
        self._payloads = [intake_payload, plan_payload]

    def structured(self, *, model, system, user, schema, max_tokens=2000):
        return schema.model_validate(self._payloads.pop(0))


def test_graph_runs_intake_then_planner():
    intake_payload = {
        "candidateSkills": ["python"], "yearsExperience": 3.0, "projectHighlights": [],
        "targetRole": "SDE", "targetCompany": None,
        "jdRequirements": ["kafka"], "resumeToJdGaps": ["no kafka"],
    }
    plan_payload = {
        "sessionId": "sess-9",
        "questions": [{"id": "q1", "type": "technical", "prompt": "kafka?",
                       "targetDifficulty": 3, "weightedFromWeakness": False}],
    }
    graph = build_session_start_graph(
        llm=_ScriptedLLM(intake_payload, plan_payload),
        intake_model="im", planner_model="pm",
    )
    result = graph.invoke({
        "session_id": "sess-9",
        "resume_text": "resume",
        "jd_text": "jd",
        "role_key": "sde",
        "memory": MemoryProfile(candidateId="c1", recurringWeaknesses=[],
                                improvementTrend=[], strongAreas=[]),
    })
    assert isinstance(result["profile"], IntakeProfile)
    assert isinstance(result["plan"], QuestionPlan)
    assert result["plan"].session_id == "sess-9"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session_start_graph.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'graph.session_start'`

- [ ] **Step 3: Create `backend/graph/__init__.py`** (empty), then write `backend/graph/session_start.py`

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from models.contracts import IntakeProfile, MemoryProfile, QuestionPlan
from models.loader import load_competency_map
from agents.intake import IntakeAgent
from agents.planner import PlannerAgent


class SessionStartState(TypedDict, total=False):
    session_id: str
    resume_text: str
    jd_text: str
    role_key: str
    memory: MemoryProfile
    profile: IntakeProfile
    plan: QuestionPlan


def build_session_start_graph(*, llm, intake_model: str, planner_model: str):
    intake = IntakeAgent(llm=llm, model=intake_model)
    planner = PlannerAgent(llm=llm, model=planner_model)

    def intake_node(state: SessionStartState) -> SessionStartState:
        profile = intake.run(resume_text=state["resume_text"], jd_text=state["jd_text"])
        return {"profile": profile}

    def planner_node(state: SessionStartState) -> SessionStartState:
        plan = planner.run(
            session_id=state["session_id"],
            profile=state["profile"],
            memory=state["memory"],
            competency_map=load_competency_map(state["role_key"]),
        )
        return {"plan": plan}

    g = StateGraph(SessionStartState)
    g.add_node("intake", intake_node)
    g.add_node("planner", planner_node)
    g.add_edge(START, "intake")
    g.add_edge("intake", "planner")
    g.add_edge("planner", END)
    return g.compile()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_session_start_graph.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/graph tests/test_session_start_graph.py
git commit -m "feat: wire intake to planner via langgraph"
```

---

### Task 10: CLI runner for manual end-to-end validation

**Files:**
- Create: `backend/cli/__init__.py` (empty)
- Create: `backend/cli/run_session_start.py`

- [ ] **Step 1: Create `backend/cli/__init__.py`** (empty), then write `backend/cli/run_session_start.py`

```python
"""Manual runner: real Claude-on-Bedrock call to eyeball personalization quality.

Usage:
    python -m cli.run_session_start --resume path/to/resume.txt \
        --jd path/to/jd.txt --role sde
"""
import argparse
import uuid

from config.settings import Settings
from llm.client import LLMClient
from models.contracts import MemoryProfile
from graph.session_start import build_session_start_graph


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", required=True)
    parser.add_argument("--jd", required=True)
    parser.add_argument("--role", default="sde")
    args = parser.parse_args()

    settings = Settings()
    llm = LLMClient(region=settings.aws_region)
    graph = build_session_start_graph(
        llm=llm, intake_model=settings.intake_model, planner_model=settings.planner_model,
    )

    empty_memory = MemoryProfile(
        candidateId="local-dev", recurringWeaknesses=[], improvementTrend=[], strongAreas=[],
    )
    result = graph.invoke({
        "session_id": str(uuid.uuid4()),
        "resume_text": open(args.resume).read(),
        "jd_text": open(args.jd).read(),
        "role_key": args.role,
        "memory": empty_memory,
    })

    print("\n=== IntakeProfile ===")
    print(result["profile"].model_dump_json(by_alias=True, indent=2))
    print("\n=== QuestionPlan ===")
    print(result["plan"].model_dump_json(by_alias=True, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-check the CLI wiring without calling Bedrock**

Run: `python -c "import cli.run_session_start"` (from `backend/`)
Expected: imports cleanly, no error.

- [ ] **Step 3: Commit**

```bash
git add backend/cli
git commit -m "feat: add manual session-start cli runner"
```

---

### Task 11: Gated real-LLM eval harness

**Files:**
- Create: `backend/evals/__init__.py` (empty)
- Create: `backend/evals/golden/sde_backend_candidate.json`
- Create: `backend/evals/test_session_start_eval.py`

- [ ] **Step 1: Create `backend/evals/golden/sde_backend_candidate.json`**

```json
{
  "role_key": "sde",
  "resume_text": "Maya Okonkwo. 4 years backend engineer at a fintech. Built a payments reconciliation service in Python/FastAPI on AWS Lambda. Owns Postgres schema. No Kafka or streaming experience. Mentored 2 juniors.",
  "jd_text": "Senior SDE. Must have: distributed systems, event streaming with Kafka, high-throughput services, on-call ownership. Nice to have: Go.",
  "expect_gap_substrings": ["kafka"],
  "expect_min_questions": 4
}
```

- [ ] **Step 2: Create `backend/evals/__init__.py`** (empty), then write `backend/evals/test_session_start_eval.py`

```python
import json
import os
import uuid
from pathlib import Path

import pytest

from config.settings import Settings
from llm.client import LLMClient
from models.contracts import MemoryProfile
from graph.session_start import build_session_start_graph

_GOLDEN = Path(__file__).parent / "golden"

pytestmark = pytest.mark.skipif(
    os.getenv("INTERVIEWAI_RUN_LLM_EVALS", "0") != "1",
    reason="Set INTERVIEWAI_RUN_LLM_EVALS=1 to run real-LLM evals (costs money).",
)


@pytest.mark.parametrize("case_file", list(_GOLDEN.glob("*.json")))
def test_session_start_quality(case_file):
    case = json.loads(case_file.read_text())
    settings = Settings()
    llm = LLMClient(region=settings.aws_region)
    graph = build_session_start_graph(
        llm=llm, intake_model=settings.intake_model, planner_model=settings.planner_model,
    )
    result = graph.invoke({
        "session_id": str(uuid.uuid4()),
        "resume_text": case["resume_text"],
        "jd_text": case["jd_text"],
        "role_key": case["role_key"],
        "memory": MemoryProfile(candidateId="eval", recurringWeaknesses=[],
                                improvementTrend=[], strongAreas=[]),
    })

    gaps_joined = " ".join(result["profile"].resume_to_jd_gaps).lower()
    for needle in case["expect_gap_substrings"]:
        assert needle in gaps_joined, f"expected gap '{needle}' missing: {gaps_joined}"

    assert len(result["plan"].questions) >= case["expect_min_questions"]
    for q in result["plan"].questions:
        assert 1 <= q.target_difficulty <= 5
```

- [ ] **Step 3: Run (gated — should skip by default)**

Run: `pytest evals/test_session_start_eval.py -v`
Expected: SKIPPED (real-LLM evals gated off).

Optional real run (requires AWS creds + Bedrock access, costs money):
Run: `INTERVIEWAI_RUN_LLM_EVALS=1 pytest evals/test_session_start_eval.py -v`
Expected: PASS — gaps include "kafka", plan has >= 4 questions, difficulties in range.

- [ ] **Step 4: Run the full suite**

Run: `pytest`
Expected: all unit tests PASS, eval test SKIPPED.

- [ ] **Step 5: Commit**

```bash
git add backend/evals
git commit -m "feat: add gated real-llm eval harness for session start"
```

---

## Self-Review

**Spec coverage (Phase 0 + Phase 1 scope only):**
- Data contracts (IntakeProfile, QuestionPlan, AnswerEvaluation, MemoryProfile) → Task 3. ✓
- Mockable Claude-on-Bedrock client, model tiers via settings → Tasks 2, 4. ✓
- Question data: competency maps + rubric/exemplar models, SDE + AI Engineer → Tasks 5, 6. ✓
- Intake Agent (strict JSON, gap extraction) → Task 7. ✓
- Planner Agent (weights weaknesses, generates personalized questions) → Task 8. ✓
- LangGraph orchestration (no raw text between agents — schema objects only) → Task 9. ✓
- Eval harness / accuracy gate for Phase 1 → Tasks 10, 11. ✓
- Deferred to later-phase plans (correctly out of scope here): Interviewer/Evaluator/Memory
  agents, AgentCore Runtime + Memory, voice (Pipecat), avatar (Tavus), Aurora/Cognito,
  rubric/exemplar move into Bedrock Knowledge Bases, FastAPI routes + WebSocket.

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code.

**Type consistency:** `LLMClient.structured(model, system, user, schema, max_tokens)` is
called identically by `IntakeAgent`, `PlannerAgent`, and both fakes. Pydantic camelCase
aliases are used consistently in every fixture payload. `build_session_start_graph` keys
(`profile`, `plan`, `memory`, `role_key`, `session_id`) match the CLI and eval callers.

**Out-of-scope note:** Bedrock model IDs in `.env.example` are defaults to confirm in the
Bedrock console; they are env-overridable and never hardcoded in agent code.
