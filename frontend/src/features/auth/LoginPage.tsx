import { useState, type FormEvent } from "react";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage("");
    setSubmitting(true);
    try {
      await onLogin(String(formData.get("email")), String(formData.get("password")));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card narrow">
      <p className="eyebrow">Candidate sign in</p>
      <h1>Welcome back</h1>
      <p className="intro">Sign in to manage your CV and preparation data.</p>
      {message && <p className="notice error" role="alert">{message}</p>}
      <form className="form-stack" onSubmit={handleSubmit}>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
