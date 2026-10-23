// People sign in with a username + password (decision D-008). Supabase Auth
// requires an email, so each username maps to a non-deliverable internal
// address on the reserved `.invalid` domain (RFC 2606). Nobody uses or sees it.
export const LOGIN_EMAIL_DOMAIN = "marketing-os.invalid";
const USERNAME_RE = /^[a-z][a-z0-9_.-]{1,29}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function usernameToLoginEmail(input: string): string | null {
  const username = normalizeUsername(input);
  return isValidUsername(username) ? `${username}@${LOGIN_EMAIL_DOMAIN}` : null;
}

/** Display name for a signed-in account: the username for Marketing Desk logins, otherwise the email. */
export function accountLabel(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const suffix = `@${LOGIN_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}
