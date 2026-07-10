import { describe, it, expect } from "vitest";
import { signInPrompt, redirectTarget } from "./authContext";

describe("signInPrompt", () => {
  it("returns null with no origin (direct visit to login)", () => {
    expect(signInPrompt(undefined)).toBeNull();
    expect(signInPrompt("")).toBeNull();
  });

  it("prompts to start a session when coming from setup", () => {
    expect(signInPrompt("/setup")).toBe("Sign in to start your session.");
  });

  it("prompts to start a session when coming from the live interview", () => {
    expect(signInPrompt("/interview")).toBe("Sign in to start your session.");
  });

  it("prompts about progress when coming from the dashboard", () => {
    expect(signInPrompt("/dashboard")).toBe("Sign in to see your progress.");
  });

  it("prompts about results when coming from results", () => {
    expect(signInPrompt("/results")).toBe("Sign in to view your results.");
  });

  it("falls back to a generic prompt for unknown origins", () => {
    expect(signInPrompt("/something-else")).toBe("Sign in to continue.");
  });
});

describe("redirectTarget", () => {
  it("defaults to the dashboard with no origin", () => {
    expect(redirectTarget(undefined)).toBe("/dashboard");
    expect(redirectTarget("")).toBe("/dashboard");
  });

  it("sends the user back to a protected origin", () => {
    expect(redirectTarget("/setup")).toBe("/setup");
    expect(redirectTarget("/dashboard")).toBe("/dashboard");
  });

  it("never redirects back to auth pages (avoids a loop)", () => {
    expect(redirectTarget("/login")).toBe("/dashboard");
  });
});
