import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle, WarningOctagon, CaretDown } from "@phosphor-icons/react";
import type { AnswerEvaluation, PlannedQuestion } from "@/types/contracts";
import { RubricBar } from "./RubricBar";
import { TypeChip } from "./QuestionMeta";

interface VerdictCardProps {
  evaluation: AnswerEvaluation;
  question: PlannedQuestion;
  index: number;
}

export type TranscriptEntry = { role: "Q" | "A"; text: string };

// Returns structured Q/A pairs when the transcript is a multi-turn thread,
// null when it's a plain single-answer string (no Q:/A: prefix format).
export function parseTranscript(raw: string): TranscriptEntry[] | null {
  if (!raw || (!raw.startsWith("Q: ") && !raw.startsWith("A: "))) return null;

  const lines = raw.split("\n");
  const entries: TranscriptEntry[] = [];
  let current: TranscriptEntry | null = null;

  for (const line of lines) {
    if (line.startsWith("Q: ")) {
      if (current) entries.push(current);
      current = { role: "Q", text: line.slice(3) };
    } else if (line.startsWith("A: ")) {
      if (current) entries.push(current);
      current = { role: "A", text: line.slice(3) };
    } else if (current) {
      current.text += "\n" + line;
    }
  }
  if (current) entries.push(current);
  return entries.length > 0 ? entries : null;
}

export function VerdictCard({ evaluation, question, index }: VerdictCardProps) {
  const survives = evaluation.wouldSurviveRealInterview;
  const tone = survives ? "var(--color-survive)" : "var(--color-fail)";
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const parsed = parseTranscript(evaluation.transcript);
  const hasTranscript = evaluation.transcript.trim().length > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-line bg-ink p-6 sm:p-8"
    >
      {/* verdict accent edge */}
      <span
        className="pointer-events-none absolute -left-px top-0 h-full w-[3px]"
        style={{ background: tone }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-fog">Q{index + 1}</span>
          <TypeChip type={question.type} />
        </div>

        <div
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
          style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}
        >
          {survives ? (
            <CheckCircle size={16} weight="fill" color={tone} />
          ) : (
            <WarningOctagon size={16} weight="fill" color={tone} />
          )}
          <span
            className="font-mono text-[11px] font-bold tracking-[0.16em]"
            style={{ color: tone }}
          >
            {survives ? "WOULD SURVIVE" : "WOULDN'T SURVIVE"}
          </span>
        </div>
      </div>

      <p className="mt-4 text-[15px] leading-relaxed text-chalk">{question.prompt}</p>

      {/* collapsible transcript */}
      {hasTranscript && (
        <div className="mt-5">
          <button
            onClick={() => setTranscriptOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] text-fog transition-colors hover:text-chalk"
          >
            <motion.span
              animate={{ rotate: transcriptOpen ? 180 : 0 }}
              transition={{ duration: 0.22 }}
            >
              <CaretDown size={11} weight="bold" />
            </motion.span>
            {transcriptOpen ? "HIDE YOUR ANSWER" : "VIEW YOUR ANSWER"}
            {evaluation.followUpCount > 0 && (
              <span className="ml-1 text-accent">
                · {evaluation.followUpCount} follow-up{evaluation.followUpCount > 1 ? "s" : ""}
              </span>
            )}
          </button>

          <AnimatePresence initial={false}>
            {transcriptOpen && (
              <motion.div
                key="transcript"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-2xl border border-line bg-surface p-4 space-y-3">
                  {parsed ? (
                    parsed.map((entry, i) => (
                      <div key={i} className="flex gap-3">
                        <span
                          className={`shrink-0 font-mono text-[11px] font-bold tracking-wider pt-0.5 ${
                            entry.role === "Q" ? "text-accent" : "text-fog"
                          }`}
                        >
                          {entry.role}
                        </span>
                        <p
                          className={`text-sm leading-relaxed ${
                            entry.role === "Q" ? "text-mist" : "text-chalk"
                          }`}
                        >
                          {entry.text}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm leading-relaxed text-chalk">
                      {evaluation.transcript}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <p
        className="mt-5 border-l-2 pl-4 text-sm italic leading-relaxed text-mist"
        style={{ borderColor: tone }}
      >
        {evaluation.survivalReasoning}
      </p>

      <div className="mt-6 border-t border-line pt-2">
        {Object.entries(evaluation.rubricScores).map(([k, v], i) => (
          <RubricBar key={k} label={k} value={v} index={i} />
        ))}
      </div>

      {evaluation.weaknessTags.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {evaluation.weaknessTags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-fog"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </motion.article>
  );
}
