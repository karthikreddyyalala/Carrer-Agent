import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
  justRestored: boolean;

  loadMemory: () => Promise<void>;
  start: (input: { resumeText: string; jdText: string; role: string }) => Promise<void>;
  submitAnswer: (text: string) => Promise<void>;
  clearRestored: () => void;
  reset: () => void;
}

// UUID message ids so rehydrating a saved session never collides with new
// messages generated after the resume.
const mkId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function currentQuestion(plan: QuestionPlan | null, idx: number): PlannedQuestion | null {
  return plan?.questions[idx] ?? null;
}

function hasMemory(m: MemoryProfile | null): boolean {
  return !!m && m.recurringWeaknesses.length > 0;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
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
      justRestored: false,

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
          justRestored: false,
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

        const isLast = state.currentIdx === state.plan!.questions.length - 1;
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

      clearRestored: () => set({ justRestored: false }),

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
          justRestored: false,
        }),
    }),
    {
      name: "crucible.session.v1",
      storage: createJSONStorage(() => localStorage),
      // Persist only session data, never the action fns. Transient statuses
      // are corrected at save time: a reload during "thinking" (request in
      // flight, now lost) resumes as "live" so the answer can be resubmitted;
      // "starting" (no plan yet) falls back to "idle".
      partialize: (s) => ({
        status:
          s.status === "thinking" ? "live" : s.status === "starting" ? "idle" : s.status,
        role: s.role,
        profile: s.profile,
        plan: s.plan,
        currentIdx: s.currentIdx,
        followUpCount: s.followUpCount,
        messages: s.messages,
        evaluations: s.evaluations,
        priorMemory: s.priorMemory,
        updatedMemory: s.updatedMemory,
      }),
      onRehydrateStorage: () => (state) => {
        // Flag a mid-interview resume so the UI can acknowledge it.
        if (state && state.status === "live" && state.messages.length > 0) {
          state.justRestored = true;
        }
      },
    }
  )
);
