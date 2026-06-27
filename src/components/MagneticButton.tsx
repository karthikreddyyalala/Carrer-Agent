import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

interface MagneticButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "solid" | "outline";
  className?: string;
}

// Magnetic pull driven entirely by motion values (off the React render path)
// to keep it 60fps on mobile, per the perf rules.
export function MagneticButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  variant = "solid",
  className = "",
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 160, damping: 15 });
  const sy = useSpring(y, { stiffness: 160, damping: 15 });

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    x.set(relX * 0.28);
    y.set(relY * 0.32);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold tracking-tight tactile disabled:opacity-40 disabled:pointer-events-none";
  const skin =
    variant === "solid"
      ? "bg-accent text-void shadow-[0_10px_30px_-10px_rgba(74,124,255,0.6)] hover:shadow-[0_14px_36px_-8px_rgba(74,124,255,0.75)]"
      : "border border-line-bright text-chalk hover:border-fog hover:bg-surface";

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={`${base} ${skin} ${className}`}
    >
      {children}
    </motion.button>
  );
}
