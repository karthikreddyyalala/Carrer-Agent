import { describe, it, expect } from "vitest";
import { summarizeMemory } from "./memoryStats";
import type { MemoryProfile } from "@/types/contracts";

function profile(over: Partial<MemoryProfile> = {}): MemoryProfile {
  return {
    candidateId: "c1",
    recurringWeaknesses: [],
    improvementTrend: [],
    strongAreas: [],
    ...over,
  };
}

describe("summarizeMemory", () => {
  it("reports no data for an empty profile", () => {
    const s = summarizeMemory(profile());
    expect(s.hasData).toBe(false);
    expect(s.sessionsCompleted).toBe(0);
    expect(s.latestAvg).toBeNull();
    expect(s.delta).toBeNull();
    expect(s.trend).toBeNull();
  });

  it("counts a single session with no delta or trend", () => {
    const s = summarizeMemory(
      profile({ improvementTrend: [{ sessionDate: "2026-07-01", avgScore: 2.4 }] })
    );
    expect(s.hasData).toBe(true);
    expect(s.sessionsCompleted).toBe(1);
    expect(s.latestAvg).toBe(2.4);
    expect(s.delta).toBeNull();
    expect(s.trend).toBeNull();
  });

  it("computes a positive delta and 'up' trend when improving", () => {
    const s = summarizeMemory(
      profile({
        improvementTrend: [
          { sessionDate: "2026-07-01", avgScore: 2.0 },
          { sessionDate: "2026-07-05", avgScore: 3.5 },
        ],
      })
    );
    expect(s.sessionsCompleted).toBe(2);
    expect(s.latestAvg).toBe(3.5);
    expect(s.delta).toBeCloseTo(1.5);
    expect(s.trend).toBe("up");
  });

  it("computes a negative delta and 'down' trend when regressing", () => {
    const s = summarizeMemory(
      profile({
        improvementTrend: [
          { sessionDate: "2026-07-01", avgScore: 3.0 },
          { sessionDate: "2026-07-05", avgScore: 2.2 },
        ],
      })
    );
    expect(s.delta).toBeCloseTo(-0.8);
    expect(s.trend).toBe("down");
  });

  it("reports a flat trend when the score is unchanged", () => {
    const s = summarizeMemory(
      profile({
        improvementTrend: [
          { sessionDate: "2026-07-01", avgScore: 3.0 },
          { sessionDate: "2026-07-05", avgScore: 3.0 },
        ],
      })
    );
    expect(s.delta).toBe(0);
    expect(s.trend).toBe("flat");
  });

  it("uses the latest two points for delta across many sessions", () => {
    const s = summarizeMemory(
      profile({
        improvementTrend: [
          { sessionDate: "2026-07-01", avgScore: 1.0 },
          { sessionDate: "2026-07-03", avgScore: 4.0 },
          { sessionDate: "2026-07-05", avgScore: 3.0 },
        ],
      })
    );
    expect(s.sessionsCompleted).toBe(3);
    expect(s.latestAvg).toBe(3.0);
    expect(s.delta).toBeCloseTo(-1.0);
    expect(s.trend).toBe("down");
  });

  it("ranks weaknesses by frequency, highest first, capped at 5", () => {
    const s = summarizeMemory(
      profile({
        recurringWeaknesses: [
          { tag: "a", frequency: 1, lastSeen: "2026-07-01" },
          { tag: "b", frequency: 6, lastSeen: "2026-07-01" },
          { tag: "c", frequency: 3, lastSeen: "2026-07-01" },
          { tag: "d", frequency: 2, lastSeen: "2026-07-01" },
          { tag: "e", frequency: 5, lastSeen: "2026-07-01" },
          { tag: "f", frequency: 4, lastSeen: "2026-07-01" },
        ],
      })
    );
    expect(s.topWeaknesses.map((w) => w.tag)).toEqual(["b", "e", "f", "c", "d"]);
    expect(s.topWeaknesses).toHaveLength(5);
  });

  it("passes through strong areas", () => {
    const s = summarizeMemory(profile({ strongAreas: ["ownership", "clarity"] }));
    expect(s.strongAreas).toEqual(["ownership", "clarity"]);
  });
});
