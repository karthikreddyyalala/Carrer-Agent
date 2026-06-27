// Single seam between UI and backend. Today it resolves against the local
// mockEngine; flip USE_MOCK to false once backend/routes/ is live and the
// fetch branches will take over. Signatures match the agent contracts.

import type {
  AnswerEvaluation,
  IntakeProfile,
  InterviewDecision,
  MemoryProfile,
  PlannedQuestion,
  QuestionPlan,
} from "@/types/contracts";
import { mockEngine } from "./mockEngine";

// Defaults to the local mock so the product demos without AWS. Set
// VITE_USE_MOCK=false (with the FastAPI backend running) to hit the real
// five-agent pipeline through the Vite /api proxy.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

const latency = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StartSessionResult {
  profile: IntakeProfile;
  plan: QuestionPlan;
}

export interface TurnResult {
  decision: InterviewDecision;
  evaluation?: AnswerEvaluation;
}

export const api = {
  async startSession(input: {
    resumeText: string;
    jdText: string;
    role: string;
    priorMemory: MemoryProfile | null;
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
    evaluations: AnswerEvaluation[];
    priorMemory: MemoryProfile | null;
  }): Promise<MemoryProfile> {
    const today = new Date().toISOString().slice(0, 10);
    if (USE_MOCK) {
      await latency(900);
      return mockEngine.aggregate(input.evaluations, today, input.priorMemory);
    }
    const res = await fetch("/api/session/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  },
};
