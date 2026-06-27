import { create } from "zustand";
import type {
  AnswerEvaluation,
  IntakeProfile,
  MemoryProfile,
  PlannedQuestion,
  QuestionPlan,
} from "@/types/contracts";
import { api } from "@/lib/api";

const MEMORY_KEY = "crucible.memory.v1";

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

  loadMemory: () => void;
  start: (input: { resumeText: string; jdText: string; role: string }) => Promise<void>;
  submitAnswer: (text: string) => Promise<void>;
  reset: () => void;
}

let messageSeq = 0;
const mkId = () => `m${messageSeq++}`;

function currentQuestion(plan: QuestionPlan | null, idx: number): PlannedQuestion | null {
  return plan?.questions[idx] ?? null;
}

function loadStoredMemory(): MemoryProfile | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw ? (JSON.parse(raw) as MemoryProfile) : null;
  } catch {
    return null;
  }
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

  loadMemory: () => set({ priorMemory: loadStoredMemory() }),

  start: async ({ resumeText, jdText, role }) => {
    set({ status: "starting", role, messages: [], evaluations: [], updatedMemory: null });
    const prior = loadStoredMemory();
    const { profile, plan } = await api.startSession({ resumeText, jdText, role });
    const first = plan.questions[0];
    set({
      status: "live",
      profile,
      plan,
      priorMemory: prior,
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
      const updated = await api.finalizeSession({
        evaluations: evals,
        priorMemory: state.priorMemory,
      });
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(updated));
      } catch {
        /* storage may be unavailable; non-fatal */
      }
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
