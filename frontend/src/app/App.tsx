import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import AdminAccountsPage from "../features/users/AdminAccountsPage";
import NotificationBell from "../features/notifications/NotificationBell";
import NotificationCenter from "../features/notifications/NotificationCenter";

// Coach feature pages & layout
import DashboardLayout from "../features/coach/DashboardLayout";
import CoachDashboardPage from "../features/coach/CoachDashboardPage";
import CoachQueuePage from "../features/coach/CoachQueuePage";
import CoachCompletedReviewsPage from "../features/coach/CoachCompletedReviewsPage";
import CoachAccountPage from "../features/coach/CoachAccountPage";
import CoachReviewDetailPage from "../features/coach/CoachReviewDetailPage";

type ConsentViewState = "loading" | "error" | "required" | "accepted";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
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

  async function updateConsent(granted: boolean, humanReview?: boolean) {
    if (!token) return;
    setConsentState("loading");
    setConsentError("");
    try {
      await recordConsent(token, "resume_processing", granted);
      if (granted) await recordConsent(token, "external_model_processing", true);
      if (humanReview !== undefined) await recordConsent(token, "human_review", humanReview);
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
    navigate("/");
  }

  const isCoachRoute = location.pathname.startsWith("/coach");
  const isCandidateWorkspace = Boolean(token && role === "candidate" && consentState === "accepted");

  // Handle Coach Workspace Routes
  if (isCoachRoute) {
    if (!token) {
      return (
        <div className="shell shell-auth">
          <LoginPage
            onRegister={async (userEmail, password) => {
              await registerCandidate(userEmail, password);
            }}
            onLogin={async (userEmail, password) => {
              const result = await login(userEmail, password);
              setEmail(result.user.email);
              setRole(result.user.role);
              setToken(result.accessToken);
              if (result.user.role === "coach") {
                navigate(location.pathname);
              }
            }}
          />
        </div>
      );
    }

    // Coach Guard: candidate and admin cannot access coach routes
    if (role !== "coach") {
      return (
        <div className="shell shell-auth">
          <section className="card narrow" role="alert">
            <p className="eyebrow">Access Denied (403)</p>
            <h1>Coach workspace restricted</h1>
            <p className="intro">
              This workspace is restricted to career coaches. Your account role ({role}) does not have permission to access the coach portal.
            </p>
            <div className="actions mt-4">
              <Link to="/" className="primary button inline-block">Return to home</Link>
              <button type="button" className="secondary button" onClick={signOut}>Sign out</button>
            </div>
          </section>
        </div>
      );
    }

    // Authenticated Coach
    return (
      <Routes>
        <Route
          path="/coach"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › Dashboard"
            >
              <CoachDashboardPage token={token} coachEmail={email} />
            </DashboardLayout>
          }
        />
        <Route
          path="/coach/queue"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › Review queue"
            >
              <CoachQueuePage token={token} />
            </DashboardLayout>
          }
        />
        <Route
          path="/coach/reviews"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › My reviews"
            >
              <CoachCompletedReviewsPage token={token} />
            </DashboardLayout>
          }
        />
        <Route
          path="/coach/reviews/:reviewId"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › Review detail"
            >
              <CoachReviewDetailPage token={token} coachEmail={email} />
            </DashboardLayout>
          }
        />
        <Route
          path="/coach/notifications"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › Notifications"
            >
              <NotificationCenter token={token} />
            </DashboardLayout>
          }
        />
        <Route
          path="/coach/account"
          element={
            <DashboardLayout
              token={token}
              coachEmail={email}
              onSignOut={signOut}
              breadcrumb="Coach workspace › My account"
            >
              <CoachAccountPage token={token} coachEmail={email} onSignOut={signOut} />
            </DashboardLayout>
          }
        />
        <Route path="*" element={<Navigate to="/coach" replace />} />
      </Routes>
    );
  }

  // Redirect coach to /coach if accessing root or other non-coach paths
  if (token && role === "coach") {
    if (location.pathname.startsWith("/reviews/")) {
      const id = location.pathname.split("/").pop();
      return <Navigate to={`/coach/reviews/${id}`} replace />;
    }
    if (location.pathname === "/notifications") {
      return <Navigate to="/coach/notifications" replace />;
    }
    return <Navigate to="/coach" replace />;
  }

  return (
    <Routes>
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route
        path="*"
        element={(
          <div className={`shell${isCandidateWorkspace ? " shell-candidate" : ""}${!token ? " shell-auth" : ""}`}>
            {!isCandidateWorkspace && token && (
              <header className="site-header">
                <Link className="brand" to="/" aria-label="CV Matching Agent home">CV Matching Agent</Link>
                <div className="header-actions">
                  <span className="secure-label">
                    {role === "admin" ? "Admin account portal" : "Private candidate workspace"}
                  </span>
                  <span className="header-account-email">{email}</span>
                  <NotificationBell token={token} />
                  <button className="header-signout-button" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}>
                    <span aria-hidden="true">↪</span>
                  </button>
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
                  if (result.user.role === "coach") {
                    navigate("/coach");
                  }
                }}
              />
            ) : role === "admin" ? (
              location.pathname === "/notifications"
                ? <NotificationCenter token={token} />
                : <AdminAccountsPage token={token} />
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
                onAgree={(humanReview) => updateConsent(true, humanReview)}
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
