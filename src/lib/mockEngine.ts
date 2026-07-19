// A local stand-in for the agent pipeline so the UI is fully demoable
// without AWS/Bedrock credentials. The heuristics intentionally mirror the
// real prompt rules: probe vague answers, never pass an unproven answer,
// cap follow-ups at two. Swap api.ts to HTTP when the backend is live.

import type {
  AnswerEvaluation,
  CoachResponse,
  IntakeProfile,
  InterviewDecision,
  MemoryProfile,
  PlannedQuestion,
  QuestionPlan,
  RecurringWeakness,
} from "@/types/contracts";

const ROLE_LABEL: Record<string, string> = {
  sde: "Software Engineer",
  ai_engineer: "AI Engineer",
};

const QUESTION_BANK: Record<string, Omit<PlannedQuestion, "id" | "weightedFromWeakness">[]> = {
  sde: [
    {
      type: "behavioral",
      prompt:
        "Tell me about a time you owned a project end-to-end under a deadline you didn't think was realistic. What did you actually do?",
      targetDifficulty: 3,
    },
    {
      type: "technical",
      prompt:
        "You have a service whose p99 latency spikes only during traffic bursts, never at steady state. Walk me through how you'd diagnose the root cause.",
      targetDifficulty: 4,
    },
    {
      type: "system_design",
      prompt:
        "Design the backend for a feature that lets 5 million users get notified within seconds when a person they follow goes live. Start by telling me what you'd clarify first.",
      targetDifficulty: 4,
    },
    {
      type: "technical",
      prompt:
        "A teammate's PR doubles read throughput but you suspect it introduces a subtle race. How do you prove or disprove that before it ships?",
      targetDifficulty: 3,
    },
    {
      type: "behavioral",
      prompt:
        "Describe a technical decision you pushed for that turned out to be wrong. How did you find out, and what did it cost?",
      targetDifficulty: 3,
    },
  ],
  ai_engineer: [
    {
      type: "behavioral",
      prompt:
        "Tell me about an ML or LLM feature you shipped to real users. What broke in production that your eval suite never caught?",
      targetDifficulty: 4,
    },
    {
      type: "technical",
      prompt:
        "Your RAG system returns confidently wrong answers about 8% of the time. Walk me through how you'd attribute each failure to retrieval vs. generation.",
      targetDifficulty: 4,
    },
    {
      type: "system_design",
      prompt:
        "Design an evaluation pipeline for a multi-agent system where the output is open-ended text. How do you make 'is this good' measurable? Clarify scope first.",
      targetDifficulty: 5,
    },
    {
      type: "technical",
      prompt:
        "Explain how you'd cut inference cost on a high-traffic Claude endpoint by 40% without users noticing a quality drop. Name the specific levers.",
      targetDifficulty: 4,
    },
    {
      type: "behavioral",
      prompt:
        "Describe a time stakeholders wanted a model behavior you believed was unsafe or wrong. What did you do?",
      targetDifficulty: 3,
    },
  ],
};

const INTAKE_BY_ROLE: Record<string, Omit<IntakeProfile, "targetRole">> = {
  sde: {
    candidateSkills: ["TypeScript", "Go", "PostgreSQL", "Kubernetes", "gRPC", "distributed systems"],
    yearsExperience: 4,
    projectHighlights: [
      {
        title: "Realtime pricing engine",
        description: "Rebuilt a pricing path to cut p99 from 940ms to 180ms under burst load.",
        technologies: ["Go", "Redis", "Kafka"],
      },
      {
        title: "Multi-region failover",
        description: "Led active-active failover for the checkout service across 3 regions.",
        technologies: ["Kubernetes", "Envoy", "Terraform"],
      },
    ],
    targetCompany: "Stripe",
    jdRequirements: [
      "Strong distributed systems fundamentals",
      "Experience operating services at scale",
      "Bias toward measurable reliability",
    ],
    resumeToJdGaps: [
      "Resume shows breadth but thin evidence of leading an incident postmortem",
      "Limited demonstrated experience with formal capacity planning",
    ],
  },
  ai_engineer: {
    candidateSkills: ["Python", "PyTorch", "LangGraph", "RAG", "evals", "vector search", "Bedrock"],
    yearsExperience: 3,
    projectHighlights: [
      {
        title: "Agentic support copilot",
        description: "Shipped a multi-agent support tool that deflected 38% of tier-1 tickets.",
        technologies: ["LangGraph", "Claude", "Pinecone"],
      },
      {
        title: "Eval harness",
        description: "Built an offline eval suite that caught regressions before each model swap.",
        technologies: ["Python", "pytest", "Bedrock"],
      },
    ],
    targetCompany: "Anthropic",
    jdRequirements: [
      "Rigorous evaluation methodology for non-deterministic systems",
      "Production LLM experience, not just notebooks",
      "Cost and latency awareness at scale",
    ],
    resumeToJdGaps: [
      "Strong eval framing but little evidence of safety/red-team work",
      "Unclear ownership of production on-call for model endpoints",
    ],
  },
};

// follow-up probes keyed loosely to question type
const PROBES: Record<string, string[]> = {
  behavioral: [
    "You said 'the team' a lot — what did YOU specifically do that nobody else did?",
    "What was the measurable outcome? Give me a number, not 'it went well.'",
    "Walk me back to the moment it almost failed. What did you change in that moment?",
  ],
  technical: [
    "You named the approach but not the mechanism — explain exactly how it works under the hood.",
    "What's the failure mode of what you just described, and how would you detect it?",
    "What's the complexity, and where does it break at scale?",
  ],
  system_design: [
    "You jumped to components — what did you decide to NOT support, and why?",
    "Name the single biggest bottleneck in your design and the tradeoff you'd make for it.",
    "What breaks first at 10x the load you assumed?",
  ],
};

function looksVague(answer: string): boolean {
  const trimmed = answer.trim();
  const hasNumbers = /\d/.test(trimmed);
  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const hedges = /(basically|kind of|sort of|we just|stuff|things|made sure|a lot of)/i.test(trimmed);
  if (trimmed.length < 180) return true;
  if (sentences < 2) return true;
  if (!hasNumbers && hedges) return true;
  return false;
}

function scoreAnswer(
  question: PlannedQuestion,
  answer: string,
  followUpCount: number
): AnswerEvaluation {
  const trimmed = answer.trim();
  const hasNumbers = /\d/.test(trimmed);
  const length = trimmed.length;
  const strong = !looksVague(answer) && hasNumbers && length > 260;

  const criteriaByType: Record<string, string[]> = {
    behavioral: ["structure", "specificity", "impact", "ownership"],
    technical: ["correctness", "depth", "edge_cases", "communication"],
    system_design: ["requirements", "scalability", "tradeoffs", "depth"],
  };
  const criteria = criteriaByType[question.type];

  const base = strong ? 4 : looksVague(answer) ? 2 : 3;
  const rubricScores: Record<string, number> = {};
  criteria.forEach((c, i) => {
    let s = base + (i % 2 === 0 ? 0.5 : -0.5);
    if (!hasNumbers && (c === "impact" || c === "edge_cases" || c === "tradeoffs")) s -= 1;
    rubricScores[c] = Math.max(0, Math.min(5, Math.round(s * 2) / 2));
  });

  const weaknessTags: string[] = [];
  if (!hasNumbers) weaknessTags.push(question.type === "behavioral" ? "vague-impact" : "no-edge-cases");
  if (looksVague(answer)) weaknessTags.push("rambling");
  if (question.type === "behavioral" && !/\bI\b/.test(trimmed)) weaknessTags.push("no-ownership");
  if (question.type === "system_design" && !/(tradeoff|bottleneck|scale)/i.test(trimmed))
    weaknessTags.push("no-tradeoffs");

  const survives = Object.values(rubricScores).every((v) => v >= 3);
  const reasoning = survives
    ? `Concrete and specific — ${
        hasNumbers ? "quantified outcome and" : ""
      } a clear mechanism a real interviewer could follow without re-asking.`
    : `A real interviewer would keep digging: ${
        weaknessTags.includes("no-edge-cases")
          ? "no edge cases or numbers to verify the claim"
          : "the impact and personal ownership stay abstract"
      }.`;

  return {
    questionId: question.id,
    transcript: answer,
    rubricScores,
    weaknessTags: [...new Set(weaknessTags)],
    followUpCount,
    wouldSurviveRealInterview: survives,
    survivalReasoning: reasoning,
  };
}

export const mockEngine = {
  buildSession(
    role: string,
    mode: "full" | "behavioral" | "technical" | "system_design" = "full"
  ): { profile: IntakeProfile; plan: QuestionPlan } {
    const key = QUESTION_BANK[role] ? role : "sde";
    const intake = INTAKE_BY_ROLE[key];
    const profile: IntakeProfile = { ...intake, targetRole: ROLE_LABEL[key] };
    const pool = mode === "full" ? QUESTION_BANK[key] : QUESTION_BANK[key].filter((q) => q.type === mode);
    const source = pool.length > 0 ? pool : QUESTION_BANK[key];
    const plan: QuestionPlan = {
      sessionId: `sess-${Date.now()}`,
      questions: source.map((q, i) => ({
        ...q,
        id: `q${i}`,
        weightedFromWeakness: i === 1,
      })),
    };
    return { profile, plan };
  },

  decide(
    question: PlannedQuestion,
    answer: string,
    followUpCount: number,
    isLast: boolean
  ): { decision: InterviewDecision; evaluation?: AnswerEvaluation } {
    if (followUpCount < 2 && looksVague(answer)) {
      const probes = PROBES[question.type];
      return {
        decision: {
          action: "follow_up",
          followUpPrompt: probes[Math.min(followUpCount, probes.length - 1)],
          currentQuestionId: question.id,
        },
      };
    }
    const evaluation = scoreAnswer(question, answer, followUpCount);
    return {
      decision: {
        action: isLast ? "complete" : "advance",
        followUpPrompt: null,
        currentQuestionId: question.id,
      },
      evaluation,
    };
  },

  aggregate(
    evaluations: AnswerEvaluation[],
    sessionDate: string,
    prior: MemoryProfile | null
  ): MemoryProfile {
    const weaknessMap = new Map<string, RecurringWeakness>();
    prior?.recurringWeaknesses.forEach((w) => weaknessMap.set(w.tag, { ...w }));
    evaluations.forEach((e) =>
      e.weaknessTags.forEach((tag) => {
        const existing = weaknessMap.get(tag);
        if (existing) {
          existing.frequency += 1;
          existing.lastSeen = sessionDate;
        } else {
          weaknessMap.set(tag, { tag, frequency: 1, lastSeen: sessionDate });
        }
      })
    );

    const allScores = evaluations.flatMap((e) => Object.values(e.rubricScores));
    const avg = allScores.length
      ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
      : 0;

    const strong = new Set(prior?.strongAreas ?? []);
    evaluations.forEach((e) =>
      Object.entries(e.rubricScores).forEach(([k, v]) => {
        if (v >= 4) strong.add(k);
      })
    );

    return {
      candidateId: prior?.candidateId ?? "local-dev",
      recurringWeaknesses: [...weaknessMap.values()].sort((a, b) => b.frequency - a.frequency),
      improvementTrend: [...(prior?.improvementTrend ?? []), { sessionDate, avgScore: avg }],
      strongAreas: [...strong],
    };
  },

  coach(question: PlannedQuestion, weaknessTags: string[]): CoachResponse {
    const frame =
      question.type === "behavioral"
        ? "Open with the Situation and your specific Task, walk through the Actions you personally took, and close with a quantified Result."
        : question.type === "system_design"
        ? "Clarify the requirements and scale first, sketch the high-level components, then go deep on one — naming the tradeoffs and failure modes explicitly."
        : "State the core approach and why it's correct, explain the key decision, then name the edge cases and how you'd handle them.";

    const improvements = [
      `Restructures the answer so it directly targets: ${
        weaknessTags.length ? weaknessTags.join(", ") : "clarity and specificity"
      }.`,
      "Replaces vague phrasing with a concrete, quantified outcome.",
      "Foregrounds your own decisions and reasoning so ownership is unmistakable.",
    ];

    return {
      modelAnswer:
        `A 5/5 version of your answer would keep your real example but tell it tighter. ${frame} ` +
        `Ground every claim in a specific number or decision you made, and end on the measurable impact — ` +
        `that's the difference between "it got better" and an answer an interviewer trusts. ` +
        `(This is a local preview; connect the backend to generate a fully personalized model answer.)`,
      improvements,
    };
  },
};
