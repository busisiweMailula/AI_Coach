import { useCallback, useEffect, useRef, useState } from "react";

function createMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4",
    "video/webm",
  ];
  let lastError: unknown;

  for (const mimeType of mimeTypes) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch (error) {
      lastError = error;
    }
  }

  try {
    return new MediaRecorder(stream);
  } catch (error) {
    throw lastError ?? error;
  }
}

function recordingErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was denied. Allow camera access for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Connect or enable a camera, then try again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera could not be opened. Close other apps or browser tabs using it, then try again.";
  }
  if (name === "NotSupportedError" || name === "TypeError") {
    return "This browser could not initialize video recording. Update your browser or try Chrome or Edge.";
  }

  const detail = error instanceof Error
    ? `${error.name ? `${error.name}: ` : ""}${error.message}`.trim()
    : "";
  return detail
    ? `Video recording could not be started (${detail}). Check camera access and close other apps using the camera.`
    : "Video recording could not be started. Check camera access and close other apps using the camera.";
}

export function useInterviewVideo() {
  const [available, setAvailable] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileExtension, setFileExtension] = useState("webm");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => {
    setAvailable(
      typeof navigator !== "undefined" &&
      (window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined",
    );

    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.stop();
      }
      stopTracks();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [stopTracks]);

  const clear = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Video recording is unavailable in this browser.");
      return;
    }
    if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      setError("Camera recording requires HTTPS or opening the app at http://localhost:3000/");
      return;
    }

    clear();
    setError(null);
    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        // Audio is optional for video practice; retry with the camera alone.
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setStream(stream);
      const recorder = createMediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The browser stopped recording unexpectedly. Check camera access and available storage, then try again.");
        setIsRecording(false);
        stopTracks();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        chunksRef.current = [];
        recorderRef.current = null;
        stopTracks();
        setIsRecording(false);
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          previewUrlRef.current = url;
          setPreviewUrl(url);
          setFileExtension(blob.type.includes("mp4") ? "mp4" : "webm");
        } else {
          setError("No video was captured. Try recording again.");
        }
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
      setIsRecording(false);
      setError(recordingErrorMessage(cause));
    }
  }, [clear, stopTracks]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  return { available, isRecording, stream, previewUrl, fileExtension, error, start, stop, clear };
}
