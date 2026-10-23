import { STATUS_TONE } from "../lib/labels.ts";

/** Generic status chip for the intelligence modules (text always carries the meaning). */
export function Chip({ code, label }: { code: string; label: string }) {
  return <span className={`badge badge--${STATUS_TONE[code] ?? "neutral"}`}>{label}</span>;
}
