import type { ReactNode } from "react";

export function Field({ label, hint, required, children, wide }: {
  label: string; hint?: string; required?: boolean; children: ReactNode; wide?: boolean;
}) {
  return (
    <label className={`field${wide ? " field--wide" : ""}`}>
      <span className="field__label">{label}{required && <span className="req" aria-hidden="true"> *</span>}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="form__error" role="alert">{message}</p>;
}

/** Empty string → null so optional fields are stored as "unknown", not "". */
export const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
