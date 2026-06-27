import { motion } from "motion/react";

interface RubricBarProps {
  label: string;
  value: number;
  index: number;
}

const LABELS: Record<string, string> = {
  structure: "Structure",
  specificity: "Specificity",
  impact: "Impact",
  ownership: "Ownership",
  correctness: "Correctness",
  depth: "Depth",
  edge_cases: "Edge cases",
  communication: "Communication",
  requirements: "Requirements",
  scalability: "Scalability",
  tradeoffs: "Tradeoffs",
};

export function RubricBar({ label, value, index }: RubricBarProps) {
  const pct = (value / 5) * 100;
  const tone =
    value >= 4 ? "var(--color-survive)" : value >= 3 ? "var(--color-accent)" : "var(--color-fail)";
  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-center gap-3 py-2.5">
      <span className="text-xs text-mist">{LABELS[label] ?? label}</span>
      <span className="relative h-[6px] w-full overflow-hidden rounded-full bg-surface-2">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: tone }}
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
        />
      </span>
      <span className="font-mono text-xs tabular-nums text-chalk" style={{ color: tone }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}
