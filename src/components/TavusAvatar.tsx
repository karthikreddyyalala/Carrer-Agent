import { useEffect, useRef } from "react";
import { motion } from "motion/react";

// Renders the Tavus replica's live video track. Purely presentational — the
// track lifecycle lives in useTavus. Rounded, ring-lit to match the stylized
// avatar it replaces so the layout doesn't shift when the video layer is on.
export function TavusAvatar({
  track,
  size = 72,
  speaking = false,
}: {
  track: MediaStreamTrack | null;
  size?: number;
  speaking?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    el.srcObject = new MediaStream([track]);
    el.play().catch(() => {
      /* autoplay may defer until user gesture — non-fatal */
    });
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  return (
    <motion.div
      className="relative shrink-0 overflow-hidden rounded-2xl border border-line-bright bg-surface"
      style={{ width: size, height: size }}
      animate={
        speaking
          ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 22px -4px var(--color-accent)" }
          : { boxShadow: "0 0 0 1px var(--color-line)" }
      }
      transition={{ duration: 0.25 }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className="h-full w-full object-cover"
      />
    </motion.div>
  );
}
