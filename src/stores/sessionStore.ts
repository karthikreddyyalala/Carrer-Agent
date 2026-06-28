import { create } from "zustand";
import type {
  AnswerEvaluation,
  IntakeProfile,
  MemoryProfile,
  PlannedQuestion,
  QuestionPlan,
} from "@/types/contracts";
import { api } from "@/lib/api";
import { getCandidateId } from "@/lib/identity";

export type Speaker = "interviewer" | "candidate";
export type MessageKind = "question" | "answer" | "follow_up";

export interface ChatMessage {
  id: string;
  speaker: Speaker;
  kind: MessageKind;
  text: string;
  questionId: string;
  weighted?: boolean;
}

export type SessionStatus = "idle" | "starting" | "live" | "thinking" | "complete";

interface SessionState {
  status: SessionStatus;
  role: string;
  profile: IntakeProfile | null;
  plan: QuestionPlan | null;
  currentIdx: number;
  followUpCount: number;
  messages: ChatMessage[];
  evaluations: AnswerEvaluation[];
  priorMemory: MemoryProfile | null;
  updatedMemory: MemoryProfile | null;

  loadMemory: () => Promise<void>;
  start: (input: { resumeText: string; jdText: string; role: string }) => Promise<void>;
  submitAnswer: (text: string) => Promise<void>;
  reset: () => void;
}

let messageSeq = 0;
const mkId = () => `m${messageSeq++}`;

function currentQuestion(plan: QuestionPlan | null, idx: number): PlannedQuestion | null {
  return plan?.questions[idx] ?? null;
}

function hasMemory(m: MemoryProfile | null): boolean {
  return !!m && m.recurringWeaknesses.length > 0;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: "idle",
  role: "sde",
  profile: null,
  plan: null,
  currentIdx: 0,
  followUpCount: 0,
  messages: [],
  evaluations: [],
  priorMemory: null,
  updatedMemory: null,

  loadMemory: async () => {
    const memory = await api.getMemory(getCandidateId());
    set({ priorMemory: hasMemory(memory) ? memory : null });
  },

  start: async ({ resumeText, jdText, role }) => {
    set({ status: "starting", role, messages: [], evaluations: [], updatedMemory: null });
    const candidateId = getCandidateId();
    const prior = await api.getMemory(candidateId);
    const { profile, plan } = await api.startSession({ resumeText, jdText, role, candidateId });
    const first = plan.questions[0];
    set({
      status: "live",
      profile,
      plan,
      priorMemory: hasMemory(prior) ? prior : null,
      currentIdx: 0,
      followUpCount: 0,
      messages: [
        {
          id: mkId(),
          speaker: "interviewer",
          kind: "question",
          text: first.prompt,
          questionId: first.id,
          weighted: first.weightedFromWeakness,
        },
      ],
    });
  },

  submitAnswer: async (text) => {
    const state = get();
    const question = currentQuestion(state.plan, state.currentIdx);
    if (!question || state.status !== "live") return;

    set({
      status: "thinking",
      messages: [
        ...state.messages,
        { id: mkId(), speaker: "candidate", kind: "answer", text, questionId: question.id },
      ],
    });

    const isLast = state.currentIdx === (state.plan!.questions.length - 1);
    const { decision, evaluation } = await api.submitAnswer({
      question,
      answer: text,
      followUpCount: state.followUpCount,
      isLast,
    });

    if (decision.action === "follow_up" && decision.followUpPrompt) {
      set((s) => ({
        status: "live",
        followUpCount: s.followUpCount + 1,
        messages: [
          ...s.messages,
          {
            id: mkId(),
            speaker: "interviewer",
            kind: "follow_up",
            text: decision.followUpPrompt!,
            questionId: question.id,
          },
        ],
      }));
      return;
    }

    // advance or complete — record evaluation
    const evals = evaluation ? [...state.evaluations, evaluation] : state.evaluations;

    if (decision.action === "complete") {
      // Backend persists the aggregated memory (DynamoDB in real mode,
      // localStorage in mock mode) — it's the source of truth now.
      const updated = await api.finalizeSession({
        candidateId: getCandidateId(),
        evaluations: evals,
      });
      set({ status: "complete", evaluations: evals, updatedMemory: updated });
      return;
    }

    const nextIdx = state.currentIdx + 1;
    const next = state.plan!.questions[nextIdx];
    set((s) => ({
      status: "live",
      currentIdx: nextIdx,
      followUpCount: 0,
      evaluations: evals,
      messages: [
        ...s.messages,
        {
          id: mkId(),
          speaker: "interviewer",
          kind: "question",
          text: next.prompt,
          questionId: next.id,
          weighted: next.weightedFromWeakness,
        },
      ],
    }));
  },

  reset: () =>
    set({
      status: "idle",
      profile: null,
      plan: null,
      currentIdx: 0,
      followUpCount: 0,
      messages: [],
      evaluations: [],
      updatedMemory: null,
    }),
}));
