// Anonymous, stable candidate id stored in the browser. This is the key the
// backend uses to persist and reload cross-session memory. When Cognito auth
// lands, swap this for the authenticated user's sub — nothing else changes.
const KEY = "crucible.candidateId.v1";

export function getCandidateId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // storage blocked (private mode) — fall back to an ephemeral id
    return "local-dev";
  }
}
