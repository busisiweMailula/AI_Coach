import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import {
  ApiError,
  getConsentStatus,
  login,
  registerCandidate,
  recordConsent,
  type ConsentPurpose,
  type ConsentStatus,
  type UserRole,
} from "../api/client";
import ConsentPage from "../features/privacy/ConsentPage";
import PrivacyPolicyPage from "../features/privacy/PrivacyPolicyPage";
import LoginPage from "../features/auth/LoginPage";
import CandidateWorkspace from "../features/resume/CandidateWorkspace";
import CoachReviewPage from "../features/reviews/CoachReviewPage";
import AdminAccountsPage from "../features/users/AdminAccountsPage";

type ConsentViewState = "loading" | "error" | "required" | "accepted";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [consentState, setConsentState] = useState<ConsentViewState>("loading");
  const [consentError, setConsentError] = useState("");

  useEffect(() => {
    if (!token || role !== "candidate") {
      setConsentState("loading");
      setConsentError("");
      return;
    }

    let active = true;
    setConsentState("loading");
    setConsentError("");
    void getConsentStatus(token).then((status) => {
      if (active) setConsentState(hasRequiredConsents(status) ? "accepted" : "required");
    }).catch((error: unknown) => {
      if (!active) return;
      setConsentState("error");
      setConsentError(errorMessage(error));
    });

    return () => {
      active = false;
    };
  }, [token, role]);

  async function refreshConsent(currentToken = token) {
    if (!currentToken) return;
    setConsentState("loading");
    setConsentError("");
    try {
      const status = await getConsentStatus(currentToken);
      setConsentState(hasRequiredConsents(status) ? "accepted" : "required");
    } catch (error) {
      setConsentState("error");
      setConsentError(errorMessage(error));
    }
  }

  async function updateConsent(granted: boolean) {
    if (!token) return;
    setConsentState("loading");
    setConsentError("");
    try {
      await recordConsent(token, "resume_processing", granted);
      if (granted) await recordConsent(token, "external_model_processing", true);
      const status = await getConsentStatus(token);
      const resumeAccepted = hasConsent(status, "resume_processing");
      const externalModelAccepted = hasConsent(status, "external_model_processing");
      if (resumeAccepted !== granted || (granted && !externalModelAccepted)) {
        throw new Error("Consent could not be verified. CV access remains blocked.");
      }
      setConsentState(resumeAccepted && externalModelAccepted ? "accepted" : "required");
    } catch (error) {
      setConsentState("error");
      setConsentError(errorMessage(error));
    }
  }

  function signOut() {
    setToken(null);
    setEmail("");
    setRole(null);
  }

  const isCandidateWorkspace = Boolean(token && role === "candidate" && consentState === "accepted");

  return (
    <Routes>
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route
        path="*"
        element={(
          <div className={`shell${isCandidateWorkspace ? " shell-candidate" : ""}`}>
            {!isCandidateWorkspace && (
              <header className="site-header">
                <Link className="brand" to="/" aria-label="CV Matching Agent home">CV Matching Agent</Link>
                <div className="header-actions">
                  <span className="secure-label">
                    {role === "coach" ? "Coach review portal" : role === "admin" ? "Admin account portal" : "Private candidate workspace"}
                  </span>
                  {token && <button className="text-button" type="button" onClick={signOut}>Sign out</button>}
                </div>
              </header>
            )}

            {!token ? (
              <LoginPage
                onRegister={async (userEmail, password) => {
                  await registerCandidate(userEmail, password);
                }}
                onLogin={async (userEmail, password) => {
                  const result = await login(userEmail, password);
                  setEmail(result.user.email);
                  setRole(result.user.role);
                  setToken(result.accessToken);
                }}
              />
            ) : role === "coach" ? (
              <CoachReviewPage token={token} />
            ) : role === "admin" ? (
              <AdminAccountsPage token={token} />
            ) : role !== "candidate" ? (
              <section className="card narrow" role="alert">
                <p className="eyebrow">Account access unavailable</p>
                <h1>Sign in again</h1>
                <p className="intro">We could not determine your account role. Sign out and sign in again to continue.</p>
              </section>
            ) : consentState === "loading" ? (
              <section className="card narrow" aria-live="polite">
                <p className="eyebrow">Verifying privacy consent</p>
                <h1>One moment</h1>
                <p className="intro">Checking your current consent before enabling CV access.</p>
              </section>
            ) : consentState === "error" ? (
              <section className="card narrow" role="alert">
                <p className="eyebrow">Consent verification unavailable</p>
                <h1>CV access is blocked</h1>
                <p className="intro">{consentError}</p>
                <p className="supporting-copy">We could not verify your current consent. Uploading and processing remain disabled until verification succeeds.</p>
                <button className="primary" type="button" onClick={() => void refreshConsent().catch(() => undefined)}>
                  Try again
                </button>
              </section>
            ) : consentState === "required" ? (
              <ConsentPage
                onAgree={() => updateConsent(true)}
              />
            ) : (
              <CandidateWorkspace
                token={token}
                email={email}
                onWithdraw={() => updateConsent(false)}
                onConsentRejected={() => refreshConsent().catch(() => undefined)}
                onSignOut={signOut}
              />
            )}
          </div>
        )}
      />
    </Routes>
  );
}

function hasConsent(status: ConsentStatus[], purpose: ConsentPurpose) {
  return status.some((item) => item.purpose === purpose && item.accepted);
}

function hasRequiredConsents(status: ConsentStatus[]) {
  return hasConsent(status, "resume_processing") && hasConsent(status, "external_model_processing");
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
