import { useCallback, useEffect, useRef, useState } from "react";

// Speech-to-text for the candidate's spoken answers. Uses the free browser
// SpeechRecognition API (Chrome/Edge/Safari). PROVIDER SEAM: to upgrade to
// Deepgram, replace the recognition engine with a mic MediaStream piped to a
// Deepgram websocket; keep the same { listening, transcript, start, stop }
// surface so callers don't change.
export function useSpeechRecognition() {
  const supported =
    typeof window !== "undefined" &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!supported) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
      }
      setTranscript(text.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    };
  }, [supported]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setTranscript("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      /* start() throws if already running — ignore */
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
  }, []);

  return { supported, listening, transcript, start, stop };
}
