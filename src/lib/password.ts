export const MIN_PASSWORD_LENGTH = 12;

/** Returns a user-facing problem, or null when the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords do not match.";
  const name = username.toLowerCase();
  if (name.length >= 3 && password.toLowerCase().includes(name)) return "Do not include your username in the password.";
  if (/^(.)\1+$/.test(password)) return "Avoid repeating a single character.";
  return null;
}
