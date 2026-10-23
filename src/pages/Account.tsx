import { useState, type FormEvent } from "react";
import { useMember } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { validateNewPassword } from "../lib/password.ts";

export function Account() {
  const { member } = useMember();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm, member.username);
    if (problem) return setMessage({ tone: "error", text: problem });
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage({ tone: "error", text: error.message });
    setPassword("");
    setConfirm("");
    setMessage({ tone: "ok", text: "Password updated." });
  }

  return (
    <>
      <header className="page-header">
        <h1>Account</h1>
        <p className="muted">{member.display_name} · username <strong>{member.username}</strong></p>
      </header>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <h2>Change password</h2>
        <p className="muted small">
          Please replace the temporary password you were given. Your password is personal: do not share it with
          other team members.
        </p>
        <label>
          New password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Confirm new password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {message && <p className={message.tone === "ok" ? "form__ok" : "form__error"} role="status">{message.text}</p>}
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      </form>
    </>
  );
}
