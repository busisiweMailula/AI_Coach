import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "signup" && password !== confirmPassword) {
      setMessage({ text: "Passwords do not match.", type: "error" });
      return;
    }

    setMessage(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await onRegister(email, password);
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        setShowConfirmPassword(false);
        setMessage({ text: "Your account has been created. Sign in to continue.", type: "success" });
      } else {
        await onLogin(email, password);
      }
    } catch (error) {
      const action = mode === "signup" ? "Sign-up" : "Sign-in";
      setMessage({
        text: error instanceof Error ? error.message : `${action} could not be completed.`,
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setMessage(null);
  }

  const signingUp = mode === "signup";

  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Link className="auth-brand" to="/" aria-label="CV Matching Agent home">
          <span className="auth-brand-mark" aria-hidden="true">C</span>
          <span>CV Matching Agent</span>
        </Link>
        <div className="auth-story-copy">
          <p className="auth-story-eyebrow">A clearer next step</p>
          <h2>Make your experience work harder.</h2>
          <p>Turn your CV and a role description into focused, evidence-led preparation for your next opportunity.</p>
          <p className="auth-story-note"><span aria-hidden="true" /> Thoughtful preparation grounded in your own experience.</p>
        </div>
        <span className="auth-orbit auth-orbit-one" aria-hidden="true" />
        <span className="auth-orbit auth-orbit-two" aria-hidden="true" />
      </aside>

      <section className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">Your private workspace</p>
          <h1>{signingUp ? "Create your account." : "Good to see you."}</h1>
          <p className="auth-intro">
            {signingUp ? "Create a candidate account to get started." : "Sign in to pick up where you left off."}
          </p>
          <div className="auth-mode-toggle" role="group" aria-label="Account access">
            <button
              className={signingUp ? "" : "active"}
              type="button"
              aria-pressed={!signingUp}
              onClick={() => switchMode("login")}
            >
              Sign in
            </button>
            <button
              className={signingUp ? "active" : ""}
              type="button"
              aria-pressed={signingUp}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>
          {message && (
            <p className={`notice${message.type === "error" ? " error" : ""}`} role={message.type === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}
          <form className="form-stack auth-form" onSubmit={handleSubmit}>
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete={signingUp ? "email" : "username"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <PasswordField
              id="password"
              label="Password"
              name="password"
              visible={showPassword}
              onToggle={() => setShowPassword((visible) => !visible)}
              autoComplete={signingUp ? "new-password" : "current-password"}
              minLength={signingUp ? 12 : undefined}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {signingUp && (
              <>
                <PasswordField
                  id="confirm-password"
                  label="Confirm password"
                  name="confirm-password"
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((visible) => !visible)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
                <p className="supporting-copy">Use a password between 12 and 128 characters.</p>
              </>
            )}
            <button className="primary auth-submit" type="submit" disabled={submitting}>
              <span>
                {submitting
                  ? signingUp ? "Creating account…" : "Signing in…"
                  : signingUp ? "Create account" : "Sign in"}
              </span>
              {!submitting && <span aria-hidden="true">↗</span>}
            </button>
          </form>
          <p className="auth-privacy-note">
            Your account is private. Candidate CV processing stays off until you review and accept the privacy notice.
          </p>
        </div>
      </section>
    </main>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  name: string;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  minLength?: number;
  maxLength: number;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  required: boolean;
}

function PasswordField({
  id,
  label,
  name,
  visible,
  onToggle,
  autoComplete,
  minLength,
  maxLength,
  value,
  onChange,
  required,
}: PasswordFieldProps) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={onChange}
          required={required}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={onToggle}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {visible ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                <path d="M9.9 5.2A10.7 10.7 0 0112 5c5.5 0 9 7 9 7a15.7 15.7 0 01-3 3.8" />
                <path d="M6.2 6.2C3.9 7.7 3 12 3 12s3.5 7 9 7a9.7 9.7 0 004.1-.9" />
              </>
            ) : (
              <>
                <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                <circle cx="12" cy="12" r="2.5" />
              </>
            )}
          </svg>
        </button>
      </div>
    </>
  );
}
