import { useRef, useState, type FormEvent } from "react";
import { ApiError, getJobStatus, uploadResume } from "../../api/client";

interface ResumeUploadPageProps {
  token: string;
  email: string;
  onWithdraw: () => Promise<void>;
  onConsentRejected: () => Promise<void>;
}

interface Notice {
  message: string;
  isError: boolean;
}

export default function ResumeUploadPage({
  token,
  email,
  onWithdraw,
  onConsentRejected,
}: ResumeUploadPageProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;

    setNotice(null);
    setUploading(true);
    try {
      const result = await uploadResume(token, file);
      if (fileInput.current) fileInput.current.value = "";
      if (!result.resume.parseJobId) {
        setNotice({ message: "CV uploaded and text extracted. AI parsing is disabled on this server.", isError: false });
        return;
      }
      setNotice({ message: "CV uploaded. Checking the processing status…", isError: false });
      await waitForParse(result.resume.parseJobId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await onConsentRejected();
      }
      setNotice({ message: messageForError(error), isError: true });
    } finally {
      setUploading(false);
    }
  }

  async function waitForParse(jobId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const result = await getJobStatus(token, jobId);
        if (result.status === "succeeded") {
          setNotice({ message: "CV uploaded, text extracted, and parsing completed.", isError: false });
          return;
        }
        if (result.status === "failed") {
          const anonymizationUnavailable = result.error?.code === "SERVICE_UNAVAILABLE";
          setNotice({
            message: anonymizationUnavailable
              ? "CV uploaded and stored. AI parsing was blocked because CV anonymisation is not configured; the original CV was not sent to an AI service."
              : "CV uploaded, but parsing did not complete. You can retry later.",
            isError: anonymizationUnavailable,
          });
          return;
        }
      } catch (error) {
        setNotice({ message: messageForError(error), isError: true });
        return;
      }
    }
    setNotice({ message: "CV uploaded. Parsing is still in progress; check the status again later.", isError: false });
  }

  async function handleWithdraw() {
    setNotice(null);
    setWithdrawing(true);
    try {
      await onWithdraw();
    } catch (error) {
      setNotice({ message: messageForError(error), isError: true });
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <section className="card narrow">
      <p className="eyebrow">CV workspace</p>
      <h1>Upload your CV</h1>
      <p className="intro">Your current privacy consent is recorded for {email}. You can withdraw it at any time.</p>

      {notice && (
        <p className={`notice${notice.isError ? " error" : ""}`} role={notice.isError ? "alert" : "status"} aria-live="polite">
          {notice.message}
        </p>
      )}

      <form className="form-stack" onSubmit={(event) => void handleUpload(event)}>
        <label htmlFor="cv-file">Choose a PDF or DOCX CV</label>
        <input
          ref={fileInput}
          id="cv-file"
          name="file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
          disabled={uploading || withdrawing}
        />
        <button className="primary" type="submit" disabled={uploading || withdrawing}>
          {uploading ? "Uploading…" : "Upload CV"}
        </button>
      </form>

      <div className="actions account-actions">
        <button className="secondary" type="button" disabled={uploading || withdrawing} onClick={() => void handleWithdraw()}>
          {withdrawing ? "Withdrawing…" : "Withdraw consent"}
        </button>
      </div>
    </section>
  );
}

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
