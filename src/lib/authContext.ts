// Maps the route a signed-out user was trying to reach into (1) a context
// message shown on the login screen and (2) where to send them after they sign
// in. Pure so both RequireAuth and Login can share it and it stays testable.

const PROMPTS: Record<string, string> = {
  "/setup": "Sign in to start your session.",
  "/interview": "Sign in to start your session.",
  "/dashboard": "Sign in to see your progress.",
  "/results": "Sign in to view your results.",
};

export function signInPrompt(from: string | undefined): string | null {
  if (!from) return null;
  return PROMPTS[from] ?? "Sign in to continue.";
}

const DEFAULT_TARGET = "/dashboard";
const AUTH_PATHS = new Set(["/login", "/"]);

export function redirectTarget(from: string | undefined): string {
  if (!from || AUTH_PATHS.has(from)) return DEFAULT_TARGET;
  return from;
}
