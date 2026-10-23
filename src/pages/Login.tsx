import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { useAccess } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { FullPage, StatePanel } from "../components/States.tsx";
import { usernameToLoginEmail } from "../lib/username.ts";

export function Login() {
  const access = useAccess();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (access.kind === "member" || access.kind === "no_access") {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }
  if (access.kind === "not_configured") {
    return <FullPage><StatePanel title="Not configured" tone="warning"><p>Supabase settings are missing.</p></StatePanel></FullPage>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const loginEmail = usernameToLoginEmail(username);
    if (!loginEmail) return setError("Username or password is incorrect.");
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);
    // Same message for unknown user and wrong password (no account enumeration)
    if (signInError) setError("Username or password is incorrect.");
  }

  return (
    <FullPage>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <h1>Sign in</h1>
        <label>
          Username
          <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form__error" role="alert">{error}</p>}
        <button className="button button--primary" type="submit" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">Each person has their own username and password. Forgot yours? Ask Sourabh or Tanvi.</p>
      </form>
    </FullPage>
  );
}
