import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  PaperPlaneTilt,
  ArrowCounterClockwise,
  Microphone,
  Waveform,
  SpeakerHigh,
  SpeakerSlash,
  Warning,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { TopBar } from "@/components/TopBar";
import { TypeChip, DifficultyMeter, WeightedTag } from "@/components/QuestionMeta";
import { InterviewerAvatar, type AvatarState } from "@/components/InterviewerAvatar";
import { TavusAvatar } from "@/components/TavusAvatar";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useKokoroTTS } from "@/hooks/useKokoroTTS";
import { useTavus } from "@/hooks/useTavus";
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
  const turnError = useSessionStore((s) => s.turnError);
  const clearTurnError = useSessionStore((s) => s.clearTurnError);

  const [draft, setDraft] = useState("");
  const [lastDraft, setLastDraft] = useState("");
  const [slowThinking, setSlowThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice: Kokoro TTS (near-human quality, loads lazily) with Web Speech API
  // as the fallback while the model is downloading or if it fails to load.
  const kokoro = useKokoroTTS();
  const webSpeech = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  // Optional Tavus video avatar. Dormant unless the backend has a key; when it
  // becomes ready it takes over both the face and the voice (it speaks the
  // lines itself), so we skip Kokoro to avoid doubled audio.
  const tavus = useTavus();

  // Route to Kokoro when ready, otherwise fall back to Web Speech API.
  const tts = kokoro.status === "ready"
    ? { speak: kokoro.speak, cancel: kokoro.cancel, speaking: kokoro.speaking, supported: true as const }
    : webSpeech;

  const voiceCapable = webSpeech.supported || stt.supported;
  const [voiceOn, setVoiceOn] = useState(false);
  const lastSpokenId = useRef<string | null>(null);

  // Speak each new interviewer message aloud when voice is on. The video avatar
  // wins when it's live; otherwise the stylized avatar + Kokoro/Web Speech does.
  useEffect(() => {
    if (!voiceOn) return;
    const last = messages[messages.length - 1];
    if (!last || last.speaker !== "interviewer") return;
    if (lastSpokenId.current === last.id) return;
    lastSpokenId.current = last.id;
    if (tavus.ready) tavus.speak(last.text);
    else if (tts.supported) tts.speak(last.text);
  }, [messages, voiceOn, tts, tavus]);

  // While dictating, mirror the live transcript into the draft.
  useEffect(() => {
    if (stt.listening) setDraft(stt.transcript);
  }, [stt.listening, stt.transcript]);

  // No active session (e.g. refreshed straight here) — bounce to setup.
  // Delay the results navigation slightly so the closing message is visible.
  useEffect(() => {
    if (status === "idle") navigate("/setup");
    if (status === "complete") {
      const t = setTimeout(() => navigate("/results"), 1800);
      return () => clearTimeout(t);
    }
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

  // Restore the draft when a turn fails so the user can retry without retyping.
  useEffect(() => {
    if (turnError && lastDraft) setDraft(lastDraft);
  }, [turnError]);

  // Flag a slow request after 6 seconds so we can show a reassurance message.
  useEffect(() => {
    if (status !== "thinking") { setSlowThinking(false); return; }
    const t = setTimeout(() => setSlowThinking(true), 6000);
    return () => clearTimeout(t);
  }, [status]);

  if (!plan) return null;

  const question = plan.questions[currentIdx];
  const thinking = status === "thinking";
  const locked = thinking || status === "wrapping" || status === "complete";
  const total = plan.questions.length;
  const progressPct = ((currentIdx + (status === "complete" || status === "wrapping" ? 1 : 0)) / total) * 100;

  const avatarState: AvatarState = tts.speaking
    ? "speaking"
    : stt.listening
    ? "listening"
    : "idle";

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (next) {
      if (kokoro.status === "idle") kokoro.load(); // download the model in the background
      tavus.activate(); // no-op unless Tavus is configured server-side
    } else {
      tts.cancel();
      tavus.deactivate();
      if (stt.listening) stt.stop();
    }
  };

  const toggleMic = () => {
    if (stt.listening) {
      stt.stop();
    } else {
      tts.cancel();
      stt.start();
    }
  };

  const send = () => {
    if (!draft.trim() || locked) return;
    if (stt.listening) stt.stop();
    const text = draft.trim();
    setLastDraft(text);
    clearTurnError();
    submitAnswer(text);
    setDraft("");
  };

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar
        right={
          <div className="flex items-center gap-4">
            {voiceCapable && (
              <button
                onClick={toggleVoice}
                disabled={kokoro.status === "loading"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] tactile transition-colors disabled:opacity-50 ${
                  voiceOn
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-line-bright text-fog hover:text-chalk"
                }`}
                title={
                  kokoro.status === "loading"
                    ? "Downloading voice model…"
                    : voiceOn
                    ? "Turn voice off"
                    : "Turn voice on"
                }
              >
                {kokoro.status === "loading" ? (
                  <span className="inline-block h-[13px] w-[13px] animate-spin rounded-full border border-current border-t-transparent" />
                ) : voiceOn ? (
                  <SpeakerHigh size={13} weight="fill" />
                ) : (
                  <SpeakerSlash size={13} />
                )}
                {kokoro.status === "loading" ? "LOADING…" : "VOICE"}
              </button>
            )}
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
        <div className="mx-auto flex max-w-[820px] items-center gap-4 px-5 py-5 sm:px-8">
          {voiceOn &&
            (tavus.ready ? (
              <TavusAvatar track={tavus.videoTrack} speaking={tavus.speaking} size={72} />
            ) : (
              <InterviewerAvatar state={avatarState} size={72} />
            ))}
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <TypeChip type={question.type} />
            <DifficultyMeter value={question.targetDifficulty} />
            {question.weightedFromWeakness && <WeightedTag />}
            {followUpCount > 0 && (
              <span className="font-mono text-[10px] tracking-[0.16em] text-accent">
                FOLLOW-UP {followUpCount}/2
              </span>
            )}
            {voiceOn && (
              <span className="w-full font-mono text-[10px] tracking-[0.14em] text-fog">
                {kokoro.status === "loading"
                  ? "DOWNLOADING VOICE MODEL — USING SYSTEM VOICE MEANWHILE…"
                  : tts.speaking
                  ? "INTERVIEWER SPEAKING…"
                  : stt.listening
                  ? "LISTENING — SPEAK YOUR ANSWER"
                  : kokoro.status === "ready"
                  ? "KOKORO VOICE READY"
                  : "VOICE READY"}
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

      {/* turn error banner */}
      <AnimatePresence>
        {turnError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-fail/25 bg-fail/[0.06]"
          >
            <div className="mx-auto flex max-w-[820px] items-center justify-between gap-3 px-5 py-3 sm:px-8">
              <div className="flex items-center gap-2.5">
                <Warning size={15} weight="fill" className="shrink-0 text-fail" />
                <span className="font-mono text-[11px] tracking-wide text-fail">{turnError}</span>
              </div>
              <button
                onClick={() => { clearTurnError(); }}
                className="flex items-center gap-1.5 font-mono text-[11px] text-fog transition-colors hover:text-chalk"
              >
                <ArrowClockwise size={13} weight="bold" />
                RETRY
              </button>
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

          {thinking && <ThinkingBubble slow={slowThinking} />}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[820px] px-5 py-4 sm:px-8">
          <div className="flex items-end gap-3 rounded-2xl border border-line bg-ink p-2.5 focus-within:border-line-bright">
            {stt.supported && (
              <button
                onClick={toggleMic}
                disabled={locked}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl tactile transition-colors disabled:opacity-30 ${
                  stt.listening
                    ? "bg-survive/15 text-survive"
                    : "border border-line-bright text-fog hover:text-chalk"
                }`}
                aria-label={stt.listening ? "Stop dictation" : "Speak your answer"}
                title={stt.listening ? "Stop dictation" : "Speak your answer"}
              >
                {stt.listening ? (
                  <motion.span
                    animate={{ scale: [1, 0.8, 1] }}
                    transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Waveform size={18} weight="fill" />
                  </motion.span>
                ) : (
                  <Microphone size={18} weight="bold" />
                )}
              </button>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              disabled={locked}
              rows={2}
              placeholder={
                stt.listening
                  ? "Listening…"
                  : thinking
                  ? "Interviewer is thinking…"
                  : status === "wrapping" || status === "complete"
                  ? "Session complete — pulling your results…"
                  : "Type or speak your answer — be specific."
              }
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-chalk placeholder:text-fog focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || locked}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-void tactile transition-opacity disabled:opacity-30"
              aria-label="Send answer"
            >
              {thinking ? <PaperPlaneTilt size={18} weight="fill" /> : <ArrowUp size={18} weight="bold" />}
            </button>
          </div>
          <p className="mt-2 px-1 font-mono text-[10px] tracking-wide text-fog">
            {stt.supported ? "MIC TO SPEAK · " : ""}⌘/CTRL + ENTER TO SEND · VAGUE ANSWERS WILL GET PROBED
          </p>
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble({ slow }: { slow: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="rounded-2xl bg-surface px-4 py-3.5">
        <div className="flex items-center gap-2">
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
          <AnimatePresence>
            {slow && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="font-mono text-[10px] tracking-wide text-fog"
              >
                still thinking…
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
