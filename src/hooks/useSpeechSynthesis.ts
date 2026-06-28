import { useCallback, useEffect, useRef, useState } from "react";

// Text-to-speech for the interviewer's voice. Uses the free browser
// SpeechSynthesis API. PROVIDER SEAM: to upgrade to ElevenLabs, swap the body
// of `speak` to fetch synthesized audio and play it through an <audio> element
// (and feed it to an AnalyserNode for true amplitude-driven lip movement).
// The hook's public shape (speak/cancel/speaking/supported) stays identical.
export function useSpeechSynthesis() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|google|samantha|aaron|jenny/i.test(v.name)) ??
        voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
        voices[0] ??
        null;
    };
    pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = 1.02;
      utterance.pitch = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // Stop any in-flight speech if the component using this unmounts.
  useEffect(() => cancel, [cancel]);

  return { speak, cancel, speaking, supported };
}
