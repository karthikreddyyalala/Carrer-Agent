// Single seam between UI and backend. Defaults to the local mockEngine so the
// product demos without AWS; set VITE_USE_MOCK=false (with the FastAPI backend
// running) to hit the real five-agent pipeline through the Vite /api proxy.
// In real mode the backend is the source of truth for cross-session memory
// (DynamoDB); in mock mode localStorage stands in for it.

import type {
  AnswerEvaluation,
  IntakeProfile,
  InterviewDecision,
  MemoryProfile,
  PlannedQuestion,
  QuestionPlan,
} from "@/types/contracts";
import { mockEngine } from "./mockEngine";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const MOCK_MEMORY_KEY = "crucible.memory.v1";

const latency = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readMockMemory(candidateId: string): MemoryProfile | null {
  try {
    const raw = localStorage.getItem(MOCK_MEMORY_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as MemoryProfile;
    return m.candidateId === candidateId ? m : null;
  } catch {
    return null;
  }
}

function writeMockMemory(profile: MemoryProfile): void {
  try {
    localStorage.setItem(MOCK_MEMORY_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function emptyMemory(candidateId: string): MemoryProfile {
  return { candidateId, recurringWeaknesses: [], improvementTrend: [], strongAreas: [] };
}

export interface StartSessionResult {
  profile: IntakeProfile;
  plan: QuestionPlan;
}

export interface TurnResult {
  decision: InterviewDecision;
  evaluation?: AnswerEvaluation;
}

export const api = {
  async getMemory(candidateId: string): Promise<MemoryProfile> {
    if (USE_MOCK) {
      return readMockMemory(candidateId) ?? emptyMemory(candidateId);
    }
    const res = await fetch(`/api/memory/${encodeURIComponent(candidateId)}`);
    return res.json();
  },

  async startSession(input: {
    resumeText: string;
    jdText: string;
    role: string;
    candidateId: string;
  }): Promise<StartSessionResult> {
    if (USE_MOCK) {
      await latency(1400);
      return mockEngine.buildSession(input.role);
    }
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  },

  async submitAnswer(input: {
    question: PlannedQuestion;
    answer: string;
    followUpCount: number;
    isLast: boolean;
  }): Promise<TurnResult> {
    if (USE_MOCK) {
      await latency(1100);
      return mockEngine.decide(input.question, input.answer, input.followUpCount, input.isLast);
    }
    const res = await fetch("/api/session/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  },

  async finalizeSession(input: {
    candidateId: string;
    evaluations: AnswerEvaluation[];
  }): Promise<MemoryProfile> {
    if (USE_MOCK) {
      await latency(900);
      const today = new Date().toISOString().slice(0, 10);
      const prior = readMockMemory(input.candidateId);
      const updated = mockEngine.aggregate(input.evaluations, today, prior);
      updated.candidateId = input.candidateId;
      writeMockMemory(updated);
      return updated;
    }
    const res = await fetch("/api/session/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  },
};
