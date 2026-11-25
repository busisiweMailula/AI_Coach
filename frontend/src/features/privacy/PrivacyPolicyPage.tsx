import { Link } from "react-router-dom";

export default function PrivacyPolicyPage() {
  return (
    <main className="shell">
      <header className="site-header">
        <Link className="brand" to="/">CV Matching Agent</Link>
        <Link to="/">Return to the application</Link>
      </header>
      <article className="card policy">
        <p className="eyebrow">Privacy information · Resume processing v3 · External AI processing v2 · Human review v1</p>
        <h1>Privacy Policy</h1>
        <p className="intro">This notice explains how the CV Matching Agent handles candidate CVs and related information.</p>

        <h2>Information collected and use</h2>
        <p>When you upload a CV, the application extracts text, stores the original file in private server-side storage, and stores CV metadata and processing results in a local JSON data file. These records are used to provide CV analysis, job matching, interview preparation, and CV improvement recommendations.</p>

        <h2>AI processing and anonymisation</h2>
        <p>Before CV-based AI processing, extracted text is sent to the locally hosted Microsoft Presidio service. Presidio detects and replaces recognized personal information using its configured English-language model; it may fail to detect some personal information, so this is not guaranteed anonymisation. If the service is unavailable or returns an invalid result, processing stops. Only the returned text may be sent to an external AI service. Separate, versioned consent is required both to process your CV and to send the Presidio-processed text to an external model. Consent alone does not anonymise CV information.</p>

        <h2>Storage and access</h2>
        <p>Uploaded files are stored outside the web server's public directory. Candidate records are scoped to the authenticated owner. The JSON file is not encrypted, and the application does not itself configure host file-access controls; the operator must protect local files and backups. JSON storage is temporary and is not suitable for multi-process or production use.</p>

        <h2>Consent and withdrawal</h2>
        <p>Consent is associated with your authenticated account and recorded as a versioned history entry. Human review is optional. When granted, an authorized coach may access only the candidate, job, CV, and AI result associated with a review, and that access is audited. Withdrawing human-review consent removes pending reviews from the coach queue. You can also withdraw resume-processing consent in the application; withdrawal blocks subsequent uploads and CV-based processing. Neither action automatically deletes files or results already stored.</p>

        <h2>Retention and deletion</h2>
        <p>Withdrawal does not delete CVs, extracted text, or results already stored. This application does not currently provide self-service deletion; contact the service operator to request data removal and confirm applicable retention periods.</p>

        <h2>Limits of this notice</h2>
        <p>This technical notice does not claim legal or regulatory compliance. The operator should provide a complete policy, contact details, retention periods, and applicable legal terms before production use.</p>
      </article>
    </main>
  );
}
