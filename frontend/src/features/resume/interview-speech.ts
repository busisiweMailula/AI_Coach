import { useCallback, useEffect, useRef, useState } from "react";

export type InterviewSpeechVoice = Pick<SpeechSynthesisVoice, "voiceURI" | "name" | "lang" | "default">;

interface SpeechHandlers {
  onStart: () => void;
  onEnd: () => void;
  onError: () => void;
}

export interface InterviewSpeechRuntime {
  getVoices(): InterviewSpeechVoice[];
  speak(text: string, voiceURI: string, handlers: SpeechHandlers): void;
  cancel(): void;
  onVoicesChanged(listener: () => void): () => void;
}

interface SpeechCallbacks {
  onSpeakingChange(speaking: boolean): void;
  onVoicesChange(voices: InterviewSpeechVoice[]): void;
  onError(message: string | null): void;
}

export function createBrowserInterviewSpeechRuntime(): InterviewSpeechRuntime | null {
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
    return null;
  }

  const synthesis = window.speechSynthesis;
  return {
    getVoices: () => synthesis.getVoices(),
    speak: (text, voiceURI, handlers) => {
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceURI) {
        utterance.voice = synthesis.getVoices().find((voice) => voice.voiceURI === voiceURI) ?? null;
      }
      utterance.onstart = handlers.onStart;
      utterance.onend = handlers.onEnd;
      utterance.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") handlers.onError();
      };
      synthesis.speak(utterance);
    },
    cancel: () => synthesis.cancel(),
    onVoicesChanged: (listener) => {
      synthesis.addEventListener("voiceschanged", listener);
      return () => synthesis.removeEventListener("voiceschanged", listener);
    },
  };
}

export class InterviewSpeechController {
  private sequence = 0;
  private disposed = false;
  private unsubscribeVoices?: () => void;

  constructor(
    private readonly runtime: InterviewSpeechRuntime | null,
    private readonly callbacks: SpeechCallbacks,
  ) {
    if (!runtime) {
      callbacks.onVoicesChange([]);
      return;
    }

    try {
      this.unsubscribeVoices = runtime.onVoicesChanged(() => this.refreshVoices());
    } catch {
      callbacks.onError("Available voices could not be loaded. The browser's default voice may still work.");
    }
    this.refreshVoices();
  }

  get available() {
    return this.runtime !== null;
  }

  speak(text: string, voiceURI = "") {
    if (!this.runtime) {
      this.callbacks.onError("Speech synthesis is unavailable in this browser. You can still read the interview text.");
      return false;
    }
    if (!text.trim()) {
      this.callbacks.onError("There is no text available to read aloud.");
      return false;
    }

    this.sequence += 1;
    const sequence = this.sequence;
    if (!this.cancelCurrentSpeech()) return false;
    this.callbacks.onError(null);
    this.callbacks.onSpeakingChange(true);
    try {
      this.runtime.speak(text.trim(), voiceURI, {
        onStart: () => {
          if (this.isCurrent(sequence)) this.callbacks.onSpeakingChange(true);
        },
        onEnd: () => {
          if (this.isCurrent(sequence)) this.callbacks.onSpeakingChange(false);
        },
        onError: () => {
          if (!this.isCurrent(sequence)) return;
          this.callbacks.onSpeakingChange(false);
          this.callbacks.onError("Speech could not be played. You can still read the text and try again.");
        },
      });
      return true;
    } catch {
      this.callbacks.onSpeakingChange(false);
      this.callbacks.onError("Speech could not be started. You can still read the text and try again.");
      return false;
    }
  }

  stop() {
    this.sequence += 1;
    const stopped = this.cancelCurrentSpeech();
    if (stopped) this.callbacks.onError(null);
  }

  dispose() {
    this.disposed = true;
    this.sequence += 1;
    this.unsubscribeVoices?.();
    try {
      this.runtime?.cancel();
    } catch (error) {
      console.error("Could not cancel interview speech during cleanup", error);
    }
  }

  private refreshVoices() {
    if (!this.runtime || this.disposed) return;
    try {
      this.callbacks.onVoicesChange(this.runtime.getVoices());
    } catch {
      this.callbacks.onVoicesChange([]);
      this.callbacks.onError("Available voices could not be loaded. The browser's default voice may still work.");
    }
  }

  private cancelCurrentSpeech() {
    try {
      this.runtime?.cancel();
      this.callbacks.onSpeakingChange(false);
      return true;
    } catch {
      this.callbacks.onError("Speech could not be stopped. Try again.");
      return false;
    }
  }

  private isCurrent(sequence: number) {
    return !this.disposed && sequence === this.sequence;
  }
}

export function useInterviewSpeech() {
  const [available, setAvailable] = useState(false);
  const [voices, setVoices] = useState<InterviewSpeechVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<InterviewSpeechController | null>(null);

  useEffect(() => {
    const current = new InterviewSpeechController(createBrowserInterviewSpeechRuntime(), {
      onSpeakingChange: setIsSpeaking,
      onVoicesChange: setVoices,
      onError: setError,
    });
    controller.current = current;
    setAvailable(current.available);
    return () => {
      current.dispose();
      controller.current = null;
    };
  }, []);

  const speak = useCallback((text: string, voiceURI?: string) => {
    controller.current?.speak(text, voiceURI);
  }, []);
  const stop = useCallback(() => controller.current?.stop(), []);

  return { available, voices, isSpeaking, error, speak, stop };
}
