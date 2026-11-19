import { useState } from "react";
import { Link } from "react-router-dom";

interface ConsentPageProps {
  onAgree: () => Promise<void>;
}

export default function ConsentPage({ onAgree }: ConsentPageProps) {
  const [resumeChecked, setResumeChecked] = useState(false);
  const [externalModelChecked, setExternalModelChecked] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function acceptConsent() {
    setSubmitting(true);
    try {
      await onAgree();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <p className="eyebrow">Before you upload</p>
      <h1>Your Privacy Matters</h1>
      <p className="intro">Before uploading your CV, please review how we collect, process and protect your personal information.</p>

      <div className="privacy-points">
        <section>
          <h2>Personal information protection</h2>
          <p>
            CVs can contain personal information. Before CV text is eligible for AI processing, the application sends it to a locally hosted Microsoft Presidio service that detects and replaces recognized personal information. Detection may miss information; if the service is unavailable, processing stops. Only the returned text may be sent to an external AI service, and a separate consent is required.
          </p>
        </section>
        <section>
          <h2>Data storage</h2>
          <p>
            Uploaded CV files are kept in private server-side storage, while CV information and matching results are stored in a local JSON data file for the purposes described in our{" "}
            <Link to="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link>. The application does not itself guarantee encryption at rest.
          </p>
        </section>
        <section>
          <h2>Limited access</h2>
          <p>
            Access is restricted through authenticated accounts and owner-scoped application controls. Operational and infrastructure access must also be protected by the service operator.
          </p>
        </section>
      </div>

      <label className="consent-check" htmlFor="resume-consent-checkbox">
        <input
          id="resume-consent-checkbox"
          type="checkbox"
          checked={resumeChecked}
          onChange={(event) => {
            setResumeChecked(event.currentTarget.checked);
            setDeclined(false);
          }}
        />
        <span>
          I understand and agree that my CV and personal information will be processed for CV analysis, job matching and generating CV improvement recommendations, as explained in the{" "}
          <Link to="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
        </span>
      </label>

      <label className="consent-check" htmlFor="external-model-consent-checkbox">
        <input
          id="external-model-consent-checkbox"
          type="checkbox"
          checked={externalModelChecked}
          onChange={(event) => {
            setExternalModelChecked(event.currentTarget.checked);
            setDeclined(false);
          }}
        />
        <span>
          I separately agree that only the CV text returned by the local Presidio service may be sent to external AI providers for analysis and matching. I understand that Presidio may not detect every personal detail.
        </span>
      </label>

      {declined && (
        <p className="notice" role="status">
          Consent to the required CV processing is needed to use CV matching. You can leave this page or review the Privacy Policy.
        </p>
      )}

      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={!resumeChecked || !externalModelChecked || submitting}
          onClick={() => void acceptConsent()}
        >
          {submitting ? "Saving consent…" : "Agree & Continue"}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setResumeChecked(false);
            setExternalModelChecked(false);
            setDeclined(true);
          }}
        >
          Disagree
        </button>
      </div>
    </section>
  );
}
