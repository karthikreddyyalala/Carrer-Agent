# Interview Realism — Modes, Levels, Progressive Question Sizing

**Date:** 2026-06-28
**Status:** Approved (design)

## Problem

The deployed interviewer asks **compound, overwhelming questions** that cram 3–4 asks into one prompt. Two real examples from the live app:

- *Technical:* "Implement top-K symbols by notional with a min-heap, walk through DS choice, time complexity, AND PriorityQueue config."
- *Behavioral:* "Describe a situation where you took ownership... your approach to communicating trade-offs, how you ensured code quality, AND what you'd do differently to scale to five engineers in a regulated environment."

Web research (Tech Interview Handbook, MIT CAPD, ByteByteGo, Exponent) confirms real interviews do the opposite: **one focused ask, then progressive follow-ups.** "Probe with one follow-up — that's where memorizers get exposed."

## Goals

1. Questions open as a **single tight ask**; depth comes from the existing follow-up loop.
2. Add an interview **Mode** selector: `Full Mock` (mixed/adaptive, default) + focused `Behavioral` / `Technical` / `System Design` tracks.
3. Add a **Level**: `Junior` / `Mid` (default) / `Senior`, controlling both difficulty and how much is asked.
4. Preserve the differentiator: weak-spot memory weighting applies to every mode.

## Non-Goals

- Avatar/voice changes (tracked separately).
- Multi-round "full onsite" sequencing (deferred — option 3 from brainstorming).

## Design

### Data contract additions
`StartSessionRequest` (backend + TS types) gains:
- `mode: "full" | "behavioral" | "technical" | "system_design"` (default `"full"`)
- `level: "junior" | "mid" | "senior"` (default `"mid"`)

`PlannedQuestion` already carries `type` and `targetDifficulty` — no change.

### Level → difficulty mapping (Planner)
- Junior → targetDifficulty 1–2, smaller scope, more guided
- Mid → 2–4
- Senior → 4–5, broader, more open-ended

### Mode behavior (Planner)
- `full`: 5 questions, mixed types, **opens with a behavioral warm-up**, then technical/system_design; weak areas weighted.
- `behavioral` / `technical` / `system_design`: all 5 questions of that single type.

### Question sizing (the core fix — Planner prompt)
Every question is ONE focused, single-clause ask. Banned: multi-part questions joined by "and/also/additionally". The Planner no longer bakes in complexity/edge-case/tradeoff sub-asks — those are the Interviewer's job.

### Per-type follow-up arcs (Interviewer prompt)
The Interviewer drills the depth that used to be crammed into the question:
- **Behavioral:** STAR story → "what were you thinking?", "what would you do differently?", probe scope/impact/ownership.
- **Technical:** initial solution → "can we do better?" → complexity → edge cases.
- **System design:** "what would you clarify first?" → high-level → one component deep-dive (normal/failure/recovery) → tradeoffs.
Still capped at 2 follow-ups per question.

## Components touched

| File | Change |
|---|---|
| `backend/prompts/planner.md` | mode + level awareness; tight single-ask question generation |
| `backend/prompts/interviewer.md` | per-type progressive follow-up arcs |
| `backend/routes/session.py` | `StartSessionRequest` gains `mode`, `level`; passed into planner inputs |
| `backend/graph/session_start.py` | thread mode/level into planner node |
| `backend/agents/planner.py` | accept + inject mode/level into the prompt |
| `src/types/contracts.ts` | mode/level types |
| `src/lib/api.ts` + `src/stores/sessionStore.ts` | send mode/level on start |
| `src/pages/Setup.tsx` | Mode + Level selectors |

## Testing

- Planner unit test: a fake LLM call receives mode + level in the prompt; output validates as `QuestionPlan`.
- Mode test: `technical` mode → planner prompt instructs single-type; `full` → mixed.
- Interviewer test (existing) still passes; follow-up arc wording is prompt-only (covered by gated eval).
- Gated real-LLM eval: assert generated questions are single-clause (no " and " mega-asks) and difficulty matches level.

## Deploy

Backend prompt change → `deploy/build-lambda.sh` + `deploy/deploy-backend.sh`. Frontend change → `deploy/deploy-frontend.sh`. Both already scripted.
