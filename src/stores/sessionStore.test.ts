import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import type { TurnResult } from "@/lib/api";
import type { QuestionPlan, InterviewDecision } from "@/types/contracts";

// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/api", () => ({
  api: {
    submitAnswer: vi.fn(),
    startSession: vi.fn(),
    getMemory: vi.fn(),
    finalizeSession: vi.fn(),
  },
}));

vi.mock("@/lib/identity", () => ({
  getCandidateId: () => "test-candidate-id",
}));

// ---- Fixtures -------------------------------------------------------------

const MOCK_PLAN: QuestionPlan = {
  sessionId: "test-session",
  questions: [
    {
      id: "q1",
      type: "behavioral",
      prompt: "Tell me about a time you had to debug a critical production issue.",
      targetDifficulty: 3,
      weightedFromWeakness: false,
    },
    {
      id: "q2",
      type: "technical",
      prompt: "Walk me through how a hash map works under the hood.",
      targetDifficulty: 3,
      weightedFromWeakness: false,
    },
  ],
};

const FOLLOW_UP_DECISION: InterviewDecision = {
  action: "follow_up",
  followUpPrompt: "What was the measurable impact?",
  currentQuestionId: "q1",
};

const ADVANCE_DECISION: InterviewDecision = {
  action: "advance",
  followUpPrompt: null,
  currentQuestionId: "q1",
};

function seedLiveSession() {
  useSessionStore.setState({
    status: "live",
    role: "sde",
    profile: null,
    plan: MOCK_PLAN,
    currentIdx: 0,
    followUpCount: 0,
    messages: [],
    evaluations: [],
    priorMemory: null,
    updatedMemory: null,
    justRestored: false,
    turnError: null,
  });
}

// ---- Tests ----------------------------------------------------------------

describe("sessionStore — turnError", () => {
  beforeEach(async () => {
    // Dynamically import after mocks are registered so vi.mock is applied
    const { api } = await import("@/lib/api");
    vi.mocked(api.submitAnswer).mockReset();
    vi.mocked(api.finalizeSession).mockReset();

    useSessionStore.setState({
      status: "idle",
      role: "",
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
    });
  });

  describe("clearTurnError", () => {
    it("sets turnError to null", () => {
      useSessionStore.setState({ turnError: "Something exploded." });
      useSessionStore.getState().clearTurnError();
      expect(useSessionStore.getState().turnError).toBeNull();
    });

    it("is a no-op when turnError is already null", () => {
      useSessionStore.setState({ turnError: null });
      useSessionStore.getState().clearTurnError();
      expect(useSessionStore.getState().turnError).toBeNull();
    });
  });

  describe("submitAnswer — network failure", () => {
    it("sets turnError to the error message when api.submitAnswer throws", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockRejectedValueOnce(
        new Error("Request failed (503)")
      );

      await useSessionStore.getState().submitAnswer("I used a binary search.");

      expect(useSessionStore.getState().turnError).toBe(
        "Request failed (503)"
      );
    });

    it("falls back to a generic message for non-Error throws", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockRejectedValueOnce("just a string error");

      await useSessionStore.getState().submitAnswer("My answer.");

      expect(useSessionStore.getState().turnError).toBe(
        "Request failed — please try again."
      );
    });

    it("restores status to 'live' after a failed turn", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockRejectedValueOnce(new Error("timeout"));

      await useSessionStore.getState().submitAnswer("My answer.");

      expect(useSessionStore.getState().status).toBe("live");
    });

    it("rolls back the optimistically-added candidate message on failure", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockRejectedValueOnce(new Error("network"));

      await useSessionStore.getState().submitAnswer("Some response.");

      // The candidate message should NOT appear — it was rolled back.
      const msgs = useSessionStore.getState().messages;
      expect(msgs.every((m) => m.speaker !== "candidate")).toBe(true);
    });

    it("does not advance the question index on failure", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockRejectedValueOnce(new Error("error"));

      await useSessionStore.getState().submitAnswer("answer");

      expect(useSessionStore.getState().currentIdx).toBe(0);
    });
  });

  describe("submitAnswer — successful turn clears prior error", () => {
    it("sets turnError to null when a subsequent submission succeeds", async () => {
      seedLiveSession();
      useSessionStore.setState({ turnError: "previous error" });
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockResolvedValueOnce({
        decision: FOLLOW_UP_DECISION,
      });

      await useSessionStore.getState().submitAnswer("retried answer");

      expect(useSessionStore.getState().turnError).toBeNull();
    });

    it("clears turnError at the start of a new submission even before the API responds", async () => {
      seedLiveSession();
      useSessionStore.setState({ turnError: "stale error" });
      const { api } = await import("@/lib/api");

      // Resolve on the next tick so we can inspect state mid-flight.
      let resolveCall!: (v: TurnResult) => void;
      vi.mocked(api.submitAnswer).mockReturnValueOnce(
        new Promise<TurnResult>((r) => { resolveCall = r; })
      );

      const submitPromise = useSessionStore.getState().submitAnswer("answer");

      // Immediately after submitAnswer is called, status is "thinking" and
      // turnError should already be cleared.
      expect(useSessionStore.getState().turnError).toBeNull();
      expect(useSessionStore.getState().status).toBe("thinking");

      // Let the API call resolve so we don't leak an unresolved promise.
      resolveCall({ decision: FOLLOW_UP_DECISION });
      await submitPromise;
    });
  });

  describe("submitAnswer — advance action", () => {
    it("increments currentIdx on an advance decision", async () => {
      seedLiveSession();
      const { api } = await import("@/lib/api");
      vi.mocked(api.submitAnswer).mockResolvedValueOnce({
        decision: ADVANCE_DECISION,
        evaluation: {
          questionId: "q1",
          transcript: "My answer.",
          rubricScores: { structure: 4, specificity: 3, impact: 4, ownership: 3 },
          weaknessTags: [],
          followUpCount: 0,
          wouldSurviveRealInterview: true,
          survivalReasoning: "Concrete example with measurable outcome.",
        },
      });

      await useSessionStore.getState().submitAnswer("My answer.");

      expect(useSessionStore.getState().currentIdx).toBe(1);
      expect(useSessionStore.getState().status).toBe("live");
    });
  });
});
