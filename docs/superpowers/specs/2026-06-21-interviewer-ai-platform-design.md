# Interviewer.ai — Platform Design Spec

**Date:** 2026-06-21
**Status:** Approved for planning
**Owner:** Karthik

## 1. Summary

An AI mock-interview platform with a realistic lip-synced video avatar, a five-agent
reasoning pipeline, resume/JD personalization, and cross-session memory that reshapes
future interviews around the candidate's recurring weak spots.

Two differentiators carry the product:

1. **Cross-session adaptive memory** — the next session is rebuilt to attack the
   previous session's specific failure patterns, not just show a score trend.
2. **An interviewer that pushes back** — it probes vague answers with "why/how"
   instead of validating them, and reports `wouldSurviveRealInterview` rather than a
   lone numeric score.

The avatar is the most demoable layer but the most replaceable; it ships last and never
blocks the agent pipeline.

## 2. Goals / Non-goals

**Goals (MVP):**
- Five-agent LangGraph pipeline with strict schema'd I/O between every agent.
- Personalized question generation grounded on curated rubrics, for **SDE** and
  **AI Engineer** roles.
- Cross-session memory that demonstrably targets prior weaknesses (the 2-session test).
- Realtime voice interview, then a lip-synced talking-head avatar (C tier).
- Per-agent accuracy eval harness; reliability under disconnects.

**Non-goals (MVP):**
- Full-body / hand-gesturing avatar (v2 upgrade only).
- More than two roles at launch (architecture supports adding roles cheaply later).
- Scraped third-party question banks (legal + quality reasons; we generate instead).
- Bedrock AgentCore Gateway/Identity, Step Functions, Nova Sonic — known, deferred.

## 3. Architecture

```
React + TS + Vite (frontend)
        |  REST + WebSocket
API Gateway (WebSocket)  +  FastAPI on App Runner
        |
LangGraph 5-agent graph  --hosted on-->  AgentCore Runtime
        |                                     |
   Claude on Bedrock                     AgentCore Memory (cross-session)
        |
Voice: Pipecat orchestrates Deepgram (STT) + ElevenLabs (TTS)
Avatar: Tavus (lip-synced head, C tier)

Data:   Aurora Serverless v2 (Postgres + pgvector) — app + relational
Auth:   Cognito
Q-data: Bedrock Knowledge Bases (competency maps, rubrics, exemplars)
Files:  S3 (resumes, JDs, audio, transcripts)
Ops:    Secrets Manager, CloudWatch, IAM
```

Detailed diagrams live in `docs/diagrams/*.mmd` (Miro-importable).

## 4. The five agents

Each agent has exactly one job; no raw LLM text passes between agents — only schema-valid
objects. Contracts are defined in the project `CLAUDE.md` (`IntakeProfile`,
`QuestionPlan`, `AnswerEvaluation`, `MemoryProfile`) and mirrored as Pydantic models.

1. **Intake Agent** — resume + JD → `IntakeProfile` (skills, experience, project depth,
   resume-to-JD gaps). Strict JSON only. Model tier: Haiku (cheap, structured).
2. **Planner Agent** — `IntakeProfile` + `MemoryProfile` → ordered `QuestionPlan`, weak
   areas weighted higher. Runs once at session start. Retrieves rubrics/exemplars from
   the Knowledge Base and generates fresh, personalized questions.
3. **Interviewer Agent** — realtime conversational agent. Asks, listens, then decides
   follow-up / push back / move on. Hard requirement: probe vague answers at least once
   with "why/how" before advancing; never say "great answer" unless the rubric is met.
   Model tier: Opus.
4. **Evaluator Agent** — scores each answer against the rubric, emits `AnswerEvaluation`
   including `weaknessTags`, `wouldSurviveRealInterview`, and `survivalReasoning`.
   Never prose-only. Model tier: Opus.
5. **Memory Agent** — retrieval/write layer (not a chat agent). Aggregates
   `AnswerEvaluation` records into a `MemoryProfile` (recurring weaknesses + frequency,
   improvement trend, strong areas). AgentCore Memory provides the storage/recall
   substrate; the aggregation + Planner-reweighting logic is custom and owned by us —
   this is the differentiator and is never delegated to generic managed memory.

## 5. Question-data strategy

We generate questions; we do not bank them. Curated, durable data per role:

- **Competency map** — the areas a role must cover + weights.
- **Rubrics** — what a strong answer contains per competency/difficulty. The Evaluator
  scores against these. This is the primary asset.
- **Exemplars** — ~15 seed questions per role with ideal-answer points + follow-up hooks,
  used as few-shot grounding, never served verbatim.

Seeding approach: **hybrid** — Claude generates competency maps + rubrics; a human
hand-edits ~15 exemplars per role for quality. Stored in Bedrock Knowledge Bases for
retrieval by the Planner. Starting roles: **SDE** and **AI Engineer**. New roles = one
competency map + a handful of rubrics/exemplars; generation scales the rest.

Legal: no scraping of LeetCode / Glassdoor / copyrighted prep books.

## 6. AWS services (curated)

Core now: Bedrock, AgentCore Runtime, AgentCore Memory, App Runner, API Gateway
(WebSocket), Lambda, S3, Secrets Manager, CloudWatch, IAM, Cognito, Aurora Serverless v2
(pgvector), Bedrock Knowledge Bases.
Add when needed: EventBridge + SQS (post-session memory job), Amplify (frontend deploy).
Deferred/optional: Bedrock Guardrails, Step Functions, Nova Sonic, Transcribe/Polly.

## 7. Testing & accuracy strategy

Accuracy is a first-class requirement, enforced by a per-agent **eval harness** with
golden cases:

- **Intake/Planner:** sample resumes + JDs with human-rated expected profiles and
  question relevance; pass only above an agreed bar.
- **Interviewer:** scripted good / vague / wrong answers — verify it probes vague answers
  and does not validate weak ones.
- **Evaluator:** verify rubric scores and `wouldSurviveRealInterview` track human
  judgment on a labeled answer set.
- **Memory (differentiator test):** run two sessions back-to-back; assert session 2's plan
  provably weights session 1's weak areas.
- **Voice:** transcript accuracy, barge-in, latency budget.
- **Avatar:** lip-sync fidelity, A/V sync, static-portrait fallback.
- **Reliability:** kill the connection mid-session; assert autosave and no lost progress.

Technique: LLM-as-judge for subjective quality, regression tests on every prompt change,
schema validation on every agent boundary.

## 8. Build order (each phase gated by its test)

0. Foundations — repo, schemas, IAM, Secrets Manager, CI.
1. Intake + Planner + question data (text only).
2. Interviewer + Evaluator (text only).
3. Memory Agent + AgentCore Memory (run the 2-session test).
4. Voice — Pipecat + Deepgram + ElevenLabs.
5. Avatar — Tavus lip-sync (C tier) with static-portrait fallback.
6. Frontend, dashboard, deploy, reliability/disconnect handling.

No phase advances until its test gate passes.

## 9. Key risks

- **Over-scope / never finishing** — mitigated by phased, test-gated build; text before
  voice before avatar.
- **AgentCore newness** — AWS setup/IAM friction; mitigated by isolating it behind the
  Memory Agent interface so it can be swapped if it blocks.
- **Avatar realism creep** — full-body/hand gestures explicitly deferred to v2.
- **Agent quality drift** — mitigated by the eval harness + prompt regression tests.

## 10. Open questions (non-blocking)

- Exact pass bars for each eval gate (set during Phase 1).
- Voice transport detail (Pipecat + API Gateway WS vs LiveKit) — revisit at Phase 4.
