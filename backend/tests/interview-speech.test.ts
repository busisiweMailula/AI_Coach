import { describe, expect, it, vi } from "vitest";
import {
  InterviewSpeechController,
  type InterviewSpeechRuntime,
  type InterviewSpeechVoice,
} from "../../frontend/src/features/resume/interview-speech.js";
import {
  InterviewRecognitionController,
  type InterviewRecognitionRuntime,
} from "../../frontend/src/features/resume/interview-recognition.js";

describe("interview speech controller", () => {
  it("reports when speech synthesis is unavailable without blocking text practice", () => {
    const onError = vi.fn();
    const controller = new InterviewSpeechController(null, {
      onSpeakingChange: vi.fn(),
      onVoicesChange: vi.fn(),
      onError,
    });

    expect(controller.available).toBe(false);
    expect(controller.speak("Tell me about your experience.")).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(
      "Speech synthesis is unavailable in this browser. You can still read the interview text.",
    );
  });

  it("cancels the previous utterance before speaking again and stops on request", () => {
    const fake = createRuntime();
    const onSpeakingChange = vi.fn();
    const controller = new InterviewSpeechController(fake.runtime, {
      onSpeakingChange,
      onVoicesChange: vi.fn(),
      onError: vi.fn(),
    });

    expect(controller.speak("First question")).toBe(true);
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true);
    fake.handlers[0].onStart();
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true);

    expect(controller.speak("Second question")).toBe(true);
    expect(fake.cancel).toHaveBeenCalledTimes(2);
    const callsBeforeStaleEvent = onSpeakingChange.mock.calls.length;
    fake.handlers[0].onEnd();
    expect(onSpeakingChange).toHaveBeenCalledTimes(callsBeforeStaleEvent);
    fake.handlers[1].onStart();
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true);

    controller.stop();
    expect(fake.cancel).toHaveBeenCalledTimes(3);
    expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
  });

  it("cancels active speech and removes voice listeners when disposed", () => {
    const fake = createRuntime();
    const onSpeakingChange = vi.fn();
    const controller = new InterviewSpeechController(fake.runtime, {
      onSpeakingChange,
      onVoicesChange: vi.fn(),
      onError: vi.fn(),
    });
    controller.speak("A question being read aloud");
    onSpeakingChange.mockClear();

    controller.dispose();
    fake.handlers[0].onStart();

    expect(fake.cancel).toHaveBeenCalledTimes(2);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(onSpeakingChange).not.toHaveBeenCalled();
  });
});

describe("interview speech-to-text controller", () => {
  it("reports unsupported browsers and keeps typed answers available", () => {
    const onError = vi.fn();
    const controller = new InterviewRecognitionController(null, {
      onListeningChange: vi.fn(),
      onTranscriptChange: vi.fn(),
      onError,
    });

    expect(controller.available).toBe(false);
    expect(controller.start()).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(
      "Speech-to-text is unavailable in this browser. You can still type your answer.",
    );
  });

  it("captures transcript text and stops microphone recognition on request", () => {
    const fake = createRecognitionRuntime();
    const onListeningChange = vi.fn();
    const onTranscriptChange = vi.fn();
    const controller = new InterviewRecognitionController(fake.runtime, {
      onListeningChange,
      onTranscriptChange,
      onError: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    expect(onListeningChange).toHaveBeenLastCalledWith(true);
    fake.handlers[0].onResult("I led a project", "to improve service");
    expect(onTranscriptChange).toHaveBeenLastCalledWith("I led a project", "to improve service");

    expect(controller.stop()).toBe(true);
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(onListeningChange).toHaveBeenLastCalledWith(false);
  });

  it("aborts recognition on cleanup and ignores stale callbacks", () => {
    const fake = createRecognitionRuntime();
    const onTranscriptChange = vi.fn();
    const controller = new InterviewRecognitionController(fake.runtime, {
      onListeningChange: vi.fn(),
      onTranscriptChange,
      onError: vi.fn(),
    });
    controller.start();

    controller.dispose();
    fake.handlers[0].onResult("stale transcript", "");

    expect(fake.abort).toHaveBeenCalledOnce();
    expect(onTranscriptChange).toHaveBeenCalledTimes(1);
    expect(onTranscriptChange).toHaveBeenLastCalledWith("", "");
  });
});

function createRuntime() {
  const voices: InterviewSpeechVoice[] = [{
    voiceURI: "test-voice",
    name: "Test voice",
    lang: "en-US",
    default: true,
  }];
  const handlers: Array<{ onStart: () => void; onEnd: () => void; onError: () => void }> = [];
  const cancel = vi.fn();
  const unsubscribe = vi.fn();
  const runtime: InterviewSpeechRuntime = {
    getVoices: () => voices,
    speak: (_text, _voiceURI, callbacks) => { handlers.push(callbacks); },
    cancel,
    onVoicesChanged: () => unsubscribe,
  };
  return { runtime, handlers, cancel, unsubscribe };
}

function createRecognitionRuntime() {
  const handlers: Array<{
    onResult: (finalTranscript: string, interimTranscript: string) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }> = [];
  const stop = vi.fn();
  const abort = vi.fn();
  const runtime: InterviewRecognitionRuntime = {
    start: (callbacks) => { handlers.push(callbacks); },
    stop,
    abort,
  };
  return { runtime, handlers, stop, abort };
}
