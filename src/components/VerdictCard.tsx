import { motion } from "motion/react";
import { CheckCircle, WarningOctagon } from "@phosphor-icons/react";
import type { AnswerEvaluation, PlannedQuestion } from "@/types/contracts";
import { RubricBar } from "./RubricBar";
import { TypeChip } from "./QuestionMeta";

interface VerdictCardProps {
  evaluation: AnswerEvaluation;
  question: PlannedQuestion;
  index: number;
}

export function VerdictCard({ evaluation, question, index }: VerdictCardProps) {
  const survives = evaluation.wouldSurviveRealInterview;
  const tone = survives ? "var(--color-survive)" : "var(--color-fail)";

  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-line bg-ink p-6 sm:p-8"
    >
      {/* edge glow tinted to verdict */}
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
