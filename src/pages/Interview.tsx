import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, PaperPlaneTilt, ArrowCounterClockwise } from "@phosphor-icons/react";
import { TopBar } from "@/components/TopBar";
import { TypeChip, DifficultyMeter, WeightedTag } from "@/components/QuestionMeta";
import { useSessionStore } from "@/stores/sessionStore";

export function Interview() {
  const navigate = useNavigate();
  const status = useSessionStore((s) => s.status);
  const plan = useSessionStore((s) => s.plan);
  const messages = useSessionStore((s) => s.messages);
  const currentIdx = useSessionStore((s) => s.currentIdx);
  const followUpCount = useSessionStore((s) => s.followUpCount);
  const submitAnswer = useSessionStore((s) => s.submitAnswer);
  const justRestored = useSessionStore((s) => s.justRestored);
  const clearRestored = useSessionStore((s) => s.clearRestored);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // No active session (e.g. refreshed straight here) — bounce to setup.
  useEffect(() => {
    if (status === "idle") navigate("/setup");
    if (status === "complete") navigate("/results");
  }, [status, navigate]);

  // Acknowledge a resumed session, then drop the flag after a moment.
  useEffect(() => {
    if (!justRestored) return;
    const t = setTimeout(() => clearRestored(), 5000);
    return () => clearTimeout(t);
  }, [justRestored, clearRestored]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  if (!plan) return null;

  const question = plan.questions[currentIdx];
  const thinking = status === "thinking";
  const total = plan.questions.length;
  const progressPct = ((currentIdx + (status === "complete" ? 1 : 0)) / total) * 100;

  const send = () => {
    if (!draft.trim() || thinking) return;
    submitAnswer(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar
        right={
          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px] tracking-wide text-fog">
              Q{currentIdx + 1} / {total}
            </span>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="h-full rounded-full bg-accent"
                animate={{ width: `${progressPct}%` }}
                transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.6 }}
              />
            </div>
          </div>
        }
      />

      {/* current question header */}
      <div className="border-b border-line bg-ink/50">
        <div className="mx-auto max-w-[820px] px-5 py-5 sm:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <TypeChip type={question.type} />
            <DifficultyMeter value={question.targetDifficulty} />
            {question.weightedFromWeakness && <WeightedTag />}
            {followUpCount > 0 && (
              <span className="font-mono text-[10px] tracking-[0.16em] text-accent">
                FOLLOW-UP {followUpCount}/2
              </span>
            )}
          </div>
        </div>
      </div>

      {/* resume notice */}
      <AnimatePresence>
        {justRestored && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-survive/25 bg-survive/[0.06]"
          >
            <div className="mx-auto flex max-w-[820px] items-center gap-2.5 px-5 py-3 sm:px-8">
              <ArrowCounterClockwise size={15} weight="bold" className="text-survive" />
              <span className="font-mono text-[11px] tracking-wide text-survive">
                SESSION RESTORED — picked up right where you left off.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] space-y-5 px-5 py-8 sm:px-8">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className={m.speaker === "candidate" ? "flex justify-end" : "flex justify-start"}
              >
                <div className={m.speaker === "candidate" ? "max-w-[80%]" : "max-w-[88%]"}>
                  {m.speaker === "interviewer" && (
                    <span
                      className={`mb-1.5 block font-mono text-[10px] tracking-[0.16em] ${
                        m.kind === "follow_up" ? "text-accent" : "text-fog"
                      }`}
                    >
                      {m.kind === "follow_up" ? "PUSHING BACK" : "INTERVIEWER"}
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                      m.speaker === "candidate"
                        ? "bg-surface-2 text-chalk"
                        : m.kind === "follow_up"
                        ? "border border-accent/40 bg-accent/[0.07] text-chalk"
                        : "bg-surface text-chalk"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {thinking && <ThinkingBubble />}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[820px] px-5 py-4 sm:px-8">
          <div className="flex items-end gap-3 rounded-2xl border border-line bg-ink p-2.5 focus-within:border-line-bright">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              disabled={thinking}
              rows={2}
              placeholder={thinking ? "Interviewer is thinking…" : "Type your answer — be specific."}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-chalk placeholder:text-fog focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || thinking}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-void tactile transition-opacity disabled:opacity-30"
              aria-label="Send answer"
            >
              {thinking ? <PaperPlaneTilt size={18} weight="fill" /> : <ArrowUp size={18} weight="bold" />}
            </button>
          </div>
          <p className="mt-2 px-1 font-mono text-[10px] tracking-wide text-fog">
            ⌘/CTRL + ENTER TO SEND · VAGUE ANSWERS WILL GET PROBED
          </p>
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="rounded-2xl bg-surface px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-fog"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
