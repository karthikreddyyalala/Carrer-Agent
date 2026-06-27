import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Sparkle, Brain } from "@phosphor-icons/react";
import { TopBar } from "@/components/TopBar";
import { MagneticButton } from "@/components/MagneticButton";
import { useSessionStore } from "@/stores/sessionStore";

const SAMPLE_RESUME = `Maya Okonkwo — Backend Engineer
4 years experience. Built a realtime pricing engine in Go that cut p99 latency from 940ms to 180ms under burst load. Led active-active failover for checkout across 3 AWS regions using Kubernetes and Envoy. Strong in distributed systems, Postgres, Kafka. Mentored 2 junior engineers.`;

const SAMPLE_JD = `Senior Software Engineer — Payments Infrastructure
We need an engineer with strong distributed systems fundamentals who has operated services at scale. You will own reliability of the checkout path, lead incident postmortems, and drive capacity planning. Must be comfortable reasoning about consistency, failover, and measurable SLOs.`;

const ROLES = [
  { key: "sde", label: "Software Engineer", hint: "Distributed systems, reliability, design" },
  { key: "ai_engineer", label: "AI Engineer", hint: "LLMs, evals, RAG, production ML" },
];

export function Setup() {
  const navigate = useNavigate();
  const start = useSessionStore((s) => s.start);
  const status = useSessionStore((s) => s.status);
  const priorMemory = useSessionStore((s) => s.priorMemory);
  const loadMemory = useSessionStore((s) => s.loadMemory);

  const [role, setRole] = useState("sde");
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");

  // surface any persisted weaknesses from a previous session
  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  const starting = status === "starting";
  const canStart = resume.trim().length > 30 && jd.trim().length > 30 && !starting;

  const handleStart = async () => {
    await start({ resumeText: resume, jdText: jd, role });
    navigate("/interview");
  };

  const weakTags = priorMemory?.recurringWeaknesses.slice(0, 3).map((w) => w.tag) ?? [];

  return (
    <div className="min-h-[100dvh]">
      <TopBar />

      <main className="mx-auto grid max-w-[1200px] gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <span className="font-mono text-xs tracking-[0.2em] text-accent">SESSION SETUP</span>
          <h1 className="mt-3 font-display text-[clamp(2rem,4.5vw,3.2rem)] font-bold leading-[1.02] tracking-tight text-white-pure">
            Give it something real to work with.
          </h1>
          <p className="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-mist">
            The Intake Agent extracts your real resume-to-JD gaps. The Planner builds a
            question set aimed at them — not a generic bank.
          </p>

          {weakTags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3"
            >
              <Brain size={18} weight="bold" className="text-warning" />
              <span className="font-mono text-[11px] tracking-wide text-warning">
                MEMORY ACTIVE — TARGETING:
              </span>
              {weakTags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-chalk"
                >
                  {t}
                </span>
              ))}
            </motion.div>
          )}

          {/* role */}
          <div className="mt-9">
            <label className="mb-2.5 block font-mono text-[11px] tracking-[0.16em] text-fog">
              TARGET ROLE
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLES.map((r) => {
                const active = role === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setRole(r.key)}
                    className={`rounded-2xl border p-4 text-left tactile transition-colors ${
                      active
                        ? "border-accent bg-accent/10"
                        : "border-line bg-ink hover:border-line-bright"
                    }`}
                  >
                    <span
                      className={`font-display text-lg font-semibold tracking-tight ${
                        active ? "text-chalk" : "text-mist"
                      }`}
                    >
                      {r.label}
                    </span>
                    <span className="mt-1 block text-xs text-fog">{r.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* resume */}
          <Field
            label="YOUR RESUME"
            value={resume}
            onChange={setResume}
            placeholder="Paste your resume text…"
            onSample={() => setResume(SAMPLE_RESUME)}
          />
          {/* jd */}
          <Field
            label="JOB DESCRIPTION"
            value={jd}
            onChange={setJd}
            placeholder="Paste the job description…"
            onSample={() => setJd(SAMPLE_JD)}
          />

          <div className="mt-9 flex items-center gap-4">
            <MagneticButton onClick={handleStart} disabled={!canStart}>
              {starting ? "Building your interview…" : "Begin interview"}
              {!starting && <ArrowRight size={17} weight="bold" />}
            </MagneticButton>
            {!canStart && !starting && (
              <span className="font-mono text-[11px] text-fog">
                Paste both to continue
              </span>
            )}
          </div>
        </section>

        <SidePanel starting={starting} />
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  onSample,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSample: () => void;
}) {
  return (
    <div className="mt-7">
      <div className="mb-2.5 flex items-center justify-between">
        <label className="font-mono text-[11px] tracking-[0.16em] text-fog">{label}</label>
        <button
          onClick={onSample}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent transition-opacity hover:opacity-70"
        >
          <Sparkle size={13} weight="fill" />
          USE SAMPLE
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="w-full resize-none rounded-2xl border border-line bg-ink p-4 text-sm leading-relaxed text-chalk placeholder:text-fog focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </div>
  );
}

function SidePanel({ starting }: { starting: boolean }) {
  const steps = [
    { n: "01", t: "Intake Agent", d: "Parses resume + JD into structured gaps" },
    { n: "02", t: "Planner Agent", d: "Orders questions, weights your weak spots" },
    { n: "03", t: "Interviewer", d: "Runs the live session, pushes back" },
    { n: "04", t: "Evaluator", d: "Scores survival against a real rubric" },
    { n: "05", t: "Memory Agent", d: "Remembers, so next time is harder" },
  ];
  return (
    <aside className="lg:sticky lg:top-24 lg:h-fit">
      <div className="rounded-3xl border border-line bg-ink p-7">
        <span className="font-mono text-[11px] tracking-[0.16em] text-fog">THE PIPELINE</span>
        <div className="mt-5 space-y-1">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              animate={
                starting
                  ? { opacity: [0.4, 1, 0.4] }
                  : { opacity: 1 }
              }
              transition={
                starting
                  ? { duration: 1.4, repeat: Infinity, delay: i * 0.18 }
                  : { duration: 0.3 }
              }
              className="flex items-start gap-4 rounded-xl px-3 py-3"
            >
              <span className="font-mono text-xs text-accent">{s.n}</span>
              <div>
                <p className="font-display text-[15px] font-semibold tracking-tight text-chalk">
                  {s.t}
                </p>
                <p className="text-xs text-fog">{s.d}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </aside>
  );
}
