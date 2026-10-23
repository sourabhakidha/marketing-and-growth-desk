// Display helpers. Timestamps are stored in UTC and shown in Asia/Kolkata.
export const TIME_ZONE = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // `date` columns arrive as YYYY-MM-DD; treat as a calendar date, not a UTC instant
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** ISO date (YYYY-MM-DD) for "today" in India. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Minutes between two timestamps; null when either is unknown (never invented). */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "not tracked";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`;
}

export function isOverdue(dueDate: string | null, status: string, today = todayInIndia()): boolean {
  return Boolean(dueDate) && dueDate! < today && status !== "done" && status !== "cancelled";
}

export const taskRef = (ref: number) => `T-${ref}`;
export const goalRef = (ref: number) => `G-${ref}`;
