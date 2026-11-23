import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export interface InterviewRecognitionRuntime {
  start(handlers: {
    onResult(finalTranscript: string, interimTranscript: string): void;
    onError(message: string): void;
    onEnd(): void;
  }): void;
  stop(): void;
  abort(): void;
}

interface RecognitionCallbacks {
  onListeningChange(listening: boolean): void;
  onTranscriptChange(finalTranscript: string, interimTranscript: string): void;
  onError(message: string | null): void;
}

export function createBrowserInterviewRecognitionRuntime(): InterviewRecognitionRuntime | null {
  if (typeof window === "undefined") return null;

  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) return null;

  let current: BrowserSpeechRecognition | null = null;
  return {
    start: (handlers) => {
      const recognition = new Recognition();
      current = recognition;
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalTranscript = "";
        let interimTranscript = "";
        for (const result of Array.from(event.results)) {
          if (result.isFinal) finalTranscript += result[0].transcript;
          else interimTranscript += result[0].transcript;
        }
        handlers.onResult(finalTranscript.trim(), interimTranscript.trim());
      };
      recognition.onerror = (event) => handlers.onError(recognitionErrorMessage(event.error));
      recognition.onend = () => {
        if (current === recognition) current = null;
        handlers.onEnd();
      };
      try {
        recognition.start();
      } catch (error) {
        if (current === recognition) current = null;
        throw error;
      }
    },
    stop: () => current?.stop(),
    abort: () => {
      const recognition = current;
      current = null;
      recognition?.abort();
    },
  };
}

function recognitionErrorMessage(code: string) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone access was denied. Allow microphone access in your browser or type your answer.";
  }
  if (code === "no-speech") return "No speech was detected. Try again or type your answer.";
  if (code === "audio-capture") return "No microphone was found. Connect a microphone or type your answer.";
  return "Speech-to-text stopped unexpectedly. Try recording again or type your answer.";
}

export class InterviewRecognitionController {
  private sequence = 0;
  private disposed = false;

  constructor(
    private readonly runtime: InterviewRecognitionRuntime | null,
    private readonly callbacks: RecognitionCallbacks,
  ) {}

  get available() {
    return this.runtime !== null;
  }

  start() {
    if (!this.runtime) {
      this.callbacks.onError("Speech-to-text is unavailable in this browser. You can still type your answer.");
      return false;
    }

    this.sequence += 1;
    const sequence = this.sequence;
    this.callbacks.onTranscriptChange("", "");
    this.callbacks.onError(null);
    this.callbacks.onListeningChange(true);
    try {
      this.runtime.start({
        onResult: (finalTranscript, interimTranscript) => {
          if (this.isCurrent(sequence)) this.callbacks.onTranscriptChange(finalTranscript, interimTranscript);
        },
        onError: (message) => {
          if (!this.isCurrent(sequence)) return;
          this.callbacks.onListeningChange(false);
          this.callbacks.onError(message);
        },
        onEnd: () => {
          if (this.isCurrent(sequence)) this.callbacks.onListeningChange(false);
        },
      });
      return true;
    } catch {
      this.callbacks.onListeningChange(false);
      this.callbacks.onError("Speech-to-text could not be started. Check microphone access or type your answer.");
      return false;
    }
  }

  stop() {
    try {
      this.runtime?.stop();
      this.callbacks.onListeningChange(false);
      return true;
    } catch {
      this.callbacks.onError("Speech-to-text could not be stopped. Close the interview to end microphone capture.");
      return false;
    }
  }

  clearTranscript() {
    if (!this.disposed) this.callbacks.onTranscriptChange("", "");
  }

  dispose() {
    this.disposed = true;
    this.sequence += 1;
    try {
      this.runtime?.abort();
    } catch (error) {
      console.error("Could not stop interview speech recognition during cleanup", error);
    }
  }

  private isCurrent(sequence: number) {
    return !this.disposed && sequence === this.sequence;
  }
}

export function useInterviewRecognition() {
  const [available, setAvailable] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<InterviewRecognitionController | null>(null);

  useEffect(() => {
    const current = new InterviewRecognitionController(createBrowserInterviewRecognitionRuntime(), {
      onListeningChange: setIsListening,
      onTranscriptChange: (finalText, interimText) => {
        setTranscript(finalText);
        setInterimTranscript(interimText);
      },
      onError: setError,
    });
    controller.current = current;
    setAvailable(current.available);
    return () => {
      current.dispose();
      controller.current = null;
    };
  }, []);

  const start = useCallback(() => controller.current?.start() ?? false, []);
  const stop = useCallback(() => controller.current?.stop() ?? false, []);
  const clearTranscript = useCallback(() => controller.current?.clearTranscript(), []);

  return { available, isListening, transcript, interimTranscript, error, start, stop, clearTranscript };
}
