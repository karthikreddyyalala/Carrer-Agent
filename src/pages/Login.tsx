import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Warning } from "@phosphor-icons/react";
import { Atmosphere } from "@/components/Atmosphere";
import { Wordmark } from "@/components/Wordmark";
import { MagneticButton } from "@/components/MagneticButton";
import { authApi } from "@/lib/auth";
import { useAuthStore } from "@/stores/authStore";

type Mode = "signin" | "signup" | "confirm";

export function Login() {
  const navigate = useNavigate();
  const refresh = useAuthStore((s) => s.refresh);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { needsConfirm } = await authApi.signUp(email, password);
        if (needsConfirm) {
          setMode("confirm");
          return;
        }
      }
      if (mode === "confirm") {
        await authApi.confirm(email, code);
        await authApi.signIn(email, password);
        await refresh();
        navigate("/setup");
        return;
      }
      // signin
      await authApi.signIn(email, password);
      await refresh();
      navigate("/setup");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "signup" ? "Create your account" : mode === "confirm" ? "Check your email" : "Welcome back";
  const cta = mode === "signup" ? "Create account" : mode === "confirm" ? "Confirm & sign in" : "Sign in";

  return (
    <div className="relative min-h-[100dvh]">
      <Atmosphere />
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-20 max-w-[1200px] items-center px-5 sm:px-8">
          <Wordmark />
        </div>
      </header>

      <main className="grid min-h-[100dvh] place-items-center px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[420px]"
        >
          <span className="font-mono text-xs tracking-[0.2em] text-accent">
            {mode === "confirm" ? "VERIFY EMAIL" : "ACCOUNT"}
          </span>
          <h1 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-bold leading-tight tracking-tight text-white-pure">
            {title}
          </h1>
          <p className="mt-2 text-sm text-mist">
            {mode === "confirm"
              ? `We sent a 6-digit code to ${email}.`
              : "Your weakness history follows your account across devices."}
          </p>

          <div className="mt-8 space-y-4">
            {mode === "confirm" ? (
              <Field label="VERIFICATION CODE" value={code} onChange={setCode} placeholder="123456" />
            ) : (
              <>
                <Field
                  label="EMAIL"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                />
                <Field
                  label="PASSWORD"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="8+ chars, upper, lower, number"
                />
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-fail/30 bg-fail/5 px-3.5 py-2.5">
                <Warning size={15} weight="fill" className="mt-0.5 shrink-0 text-fail" />
                <span className="text-xs leading-relaxed text-fail">{error}</span>
              </div>
            )}

            <div className="pt-2">
              <MagneticButton onClick={submit} disabled={busy} className="w-full">
                {busy ? "Working…" : cta}
                {!busy && <ArrowRight size={16} weight="bold" />}
              </MagneticButton>
            </div>
          </div>

          {mode !== "confirm" && (
            <p className="mt-6 text-center text-sm text-fog">
              {mode === "signin" ? "No account yet? " : "Already have one? "}
              <button
                onClick={() => {
                  setError("");
                  setMode(mode === "signin" ? "signup" : "signin");
                }}
                className="text-accent transition-opacity hover:opacity-70"
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </p>
          )}
          {mode === "confirm" && (
            <p className="mt-6 text-center text-sm text-fog">
              Didn't get it?{" "}
              <button
                onClick={() => authApi.resendCode(email)}
                className="text-accent transition-opacity hover:opacity-70"
              >
                Resend code
              </button>
            </p>
          )}
        </motion.div>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-2 block font-mono text-[11px] tracking-[0.16em] text-fog">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-ink px-4 py-3 text-[15px] text-chalk placeholder:text-fog focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </div>
  );
}
