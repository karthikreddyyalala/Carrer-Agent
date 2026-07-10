import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AnswerEvaluation,
  IntakeProfile,
  InterviewDecision,
  InterviewLevel,
  InterviewMode,
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

export type SessionStatus = "idle" | "starting" | "live" | "thinking" | "wrapping" | "complete";

interface SessionState {
  status: SessionStatus;
  role: string;
  mode: InterviewMode;
  level: InterviewLevel;
  profile: IntakeProfile | null;
  plan: QuestionPlan | null;
  currentIdx: number;
  followUpCount: number;
  messages: ChatMessage[];
  evaluations: AnswerEvaluation[];
  priorMemory: MemoryProfile | null;
  updatedMemory: MemoryProfile | null;
  justRestored: boolean;
  turnError: string | null;

  loadMemory: () => Promise<void>;
  start: (input: {
    resumeText: string;
    jdText: string;
    role: string;
    mode: InterviewMode;
    level: InterviewLevel;
  }) => Promise<void>;
  submitAnswer: (text: string) => Promise<void>;
  clearRestored: () => void;
  clearTurnError: () => void;
  reset: () => void;
}

const TRANSITIONS = [
  "Okay. Moving on.",
  "Got it — let me shift gears.",
  "Understood. Next question:",
  "Makes sense. Let's keep going.",
  "Right. Next one:",
];

function pickTransition(): string {
  return TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)];
}

function greetingText(mode: InterviewMode, level: InterviewLevel, count: number): string {
  const modeDesc: Record<InterviewMode, string> = {
    full: `a mix of ${count} behavioral, technical, and system design`,
    behavioral: `${count} behavioral`,
    technical: `${count} technical`,
    system_design: `${count} system design`,
  };
  return `Hi — good to have you here. We'll work through ${modeDesc[mode]} questions at the ${level} level. I'll push back if an answer needs more depth — that's intentional, not a penalty. Let's start.`;
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
      mode: "full",
      level: "mid",
      profile: null,
      plan: null,
      currentIdx: 0,
      followUpCount: 0,
      messages: [],
      evaluations: [],
      priorMemory: null,
      updatedMemory: null,
      justRestored: false,
      turnError: null,

      loadMemory: async () => {
        const memory = await api.getMemory(getCandidateId());
        set({ priorMemory: hasMemory(memory) ? memory : null });
      },

      start: async ({ resumeText, jdText, role, mode, level }) => {
        set({ status: "starting", role, mode, level, messages: [], evaluations: [], updatedMemory: null });
        try {
        const candidateId = getCandidateId();
        const prior = await api.getMemory(candidateId);
        const { profile, plan } = await api.startSession({
          resumeText,
          jdText,
          role,
          candidateId,
          mode,
          level,
        });
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
              text: greetingText(mode, level, plan.questions.length),
              questionId: "intro",
            },
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
        } catch (e) {
          set({ status: "idle" });
          throw e;
        }
      },

      submitAnswer: async (text) => {
        const state = get();
        const question = currentQuestion(state.plan, state.currentIdx);
        if (!question || state.status !== "live") return;

        set({
          status: "thinking",
          turnError: null,
          messages: [
            ...state.messages,
            { id: mkId(), speaker: "candidate", kind: "answer", text, questionId: question.id },
          ],
        });

        const isLast = state.currentIdx === state.plan!.questions.length - 1;

        // Build the full conversation thread for this question so the Evaluator
        // has complete context (initial answer + any follow-up exchanges), not
        // just the final reply in isolation.
        const priorMsgs = state.messages.filter((m) => m.questionId === question.id);
        const thread =
          priorMsgs.length > 0
            ? priorMsgs
                .map((m) => `${m.speaker === "interviewer" ? "Q" : "A"}: ${m.text}`)
                .join("\n") + `\nA: ${text}`
            : text;

        let decision: InterviewDecision;
        let evaluation: AnswerEvaluation | undefined;
        try {
          ({ decision, evaluation } = await api.submitAnswer({
            question,
            answer: thread,
            followUpCount: state.followUpCount,
            isLast,
          }));
        } catch (e) {
          set((s) => ({
            status: "live",
            turnError: e instanceof Error ? e.message : "Request failed — please try again.",
            messages: s.messages.slice(0, -1),
          }));
          return;
        }

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
          const closing: ChatMessage = {
            id: mkId(),
            speaker: "interviewer",
            kind: "question",
            text: "That's everything I wanted to cover. Give me a moment to pull together your evaluation.",
            questionId: question.id,
          };
          set((s) => ({ status: "wrapping", messages: [...s.messages, closing] }));
          // Backend persists the aggregated memory (DynamoDB in real mode,
          // localStorage in mock mode) — it's the source of truth now.
          const updated = await api.finalizeSession({
            candidateId: getCandidateId(),
            evaluations: evals,
            sessionId: state.plan!.sessionId,
            mode: state.mode,
            level: state.level,
            questions: state.plan!.questions,
          });
          set({ status: "complete", evaluations: evals, updatedMemory: updated });
          return;
        }

        const nextIdx = state.currentIdx + 1;
        const next = state.plan!.questions[nextIdx];
        const connector = pickTransition();
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
              text: `${connector}\n\n${next.prompt}`,
              questionId: next.id,
              weighted: next.weightedFromWeakness,
            },
          ],
        }));
      },

      clearRestored: () => set({ justRestored: false }),
      clearTurnError: () => set({ turnError: null }),

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
          s.status === "thinking" ? "live"
          : s.status === "starting" ? "idle"
          : s.status === "wrapping" ? "complete"
          : s.status,
        role: s.role,
        mode: s.mode,
        level: s.level,
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
