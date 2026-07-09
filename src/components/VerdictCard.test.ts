import { describe, it, expect } from "vitest";
import { parseTranscript } from "./VerdictCard";

// The evaluator echoes back `transcript` as the exact string passed to it.
// For single-turn answers it's plain text; for multi-turn it's a Q:/A: thread.

describe("parseTranscript", () => {
  it("returns null for plain-text answers with no Q:/A: prefix", () => {
    const raw = "We used a binary search approach because the list was pre-sorted.";
    expect(parseTranscript(raw)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseTranscript("")).toBeNull();
  });

  it("parses a single Q/A pair into two entries", () => {
    const raw = "Q: Tell me about a time.\nA: We had a production outage in Q3.";
    const result = parseTranscript(raw);
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ role: "Q", text: "Tell me about a time." });
    expect(result![1]).toEqual({ role: "A", text: "We had a production outage in Q3." });
  });

  it("parses a multi-turn exchange with follow-up", () => {
    const raw = [
      "Q: Describe a system you designed under pressure.",
      "A: I designed a rate-limiter using a token bucket.",
      "Q: What was the measurable impact?",
      "A: We reduced error rates by 38% over two weeks.",
    ].join("\n");

    const result = parseTranscript(raw);
    expect(result).toHaveLength(4);
    expect(result![0].role).toBe("Q");
    expect(result![1].role).toBe("A");
    expect(result![2].role).toBe("Q");
    expect(result![2].text).toBe("What was the measurable impact?");
    expect(result![3].role).toBe("A");
    expect(result![3].text).toBe("We reduced error rates by 38% over two weeks.");
  });

  it("handles answer text that spans multiple sentences on one line", () => {
    const raw = "Q: Walk me through your debugging process.\nA: I start with logs. Then metrics. Then I isolate the layer.";
    const result = parseTranscript(raw);
    expect(result).toHaveLength(2);
    expect(result![1].text).toBe(
      "I start with logs. Then metrics. Then I isolate the layer."
    );
  });

  it("does not confuse a plain-text answer that happens to contain Q and A as letters", () => {
    const raw = "Queues and Async processing are key. A good design separates them.";
    expect(parseTranscript(raw)).toBeNull();
  });

  it("strips the role prefix but preserves the rest of the text verbatim", () => {
    const raw = "A: I reduced Q4 latency by 40%, not 'Q:' as originally logged.";
    const result = parseTranscript(raw);
    expect(result).toHaveLength(1);
    expect(result![0].role).toBe("A");
    expect(result![0].text).toBe("I reduced Q4 latency by 40%, not 'Q:' as originally logged.");
  });
});
