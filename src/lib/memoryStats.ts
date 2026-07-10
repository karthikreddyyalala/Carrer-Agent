import type { MemoryProfile, RecurringWeakness } from "@/types/contracts";

export type TrendDirection = "up" | "down" | "flat";

export interface MemorySummary {
  hasData: boolean;
  sessionsCompleted: number;
  latestAvg: number | null;
  /** latest score minus the previous session's; null when < 2 sessions. */
  delta: number | null;
  trend: TrendDirection | null;
  /** weaknesses ranked by frequency (highest first), capped at 5. */
  topWeaknesses: RecurringWeakness[];
  strongAreas: string[];
}

const MAX_WEAKNESSES = 5;

// Pure aggregation of a MemoryProfile into the numbers the dashboard renders.
// Kept side-effect free so it's trivially testable and reusable.
export function summarizeMemory(profile: MemoryProfile): MemorySummary {
  const trend = profile.improvementTrend;
  const sessionsCompleted = trend.length;
  const latestAvg = sessionsCompleted > 0 ? trend[sessionsCompleted - 1].avgScore : null;

  let delta: number | null = null;
  let direction: TrendDirection | null = null;
  if (sessionsCompleted >= 2) {
    delta = trend[sessionsCompleted - 1].avgScore - trend[sessionsCompleted - 2].avgScore;
    direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }

  const topWeaknesses = [...profile.recurringWeaknesses]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, MAX_WEAKNESSES);

  return {
    hasData: sessionsCompleted > 0,
    sessionsCompleted,
    latestAvg,
    delta,
    trend: direction,
    topWeaknesses,
    strongAreas: profile.strongAreas,
  };
}
