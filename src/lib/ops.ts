// Daily Ops figures (D-046). Pure calculations over recorded working hours, check-in/out,
// planned blocks and punch-in/out sessions, plus approvals from tasks. Nothing is estimated:
// a day without a check-out has no worked hours (it is flagged instead), and today counts
// up to now. Times are India time.
import type { PlanItem, Task, TaskSession, WorkDay } from "./api.ts";
import { addDays, indiaDate } from "./dateRange.ts";

const HOUR = 3_600_000;
/** "10:30:00" → 630 */
export const minutesOf = (t: string | null | undefined) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : NaN);
/** 630 → "10:30" */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const istFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
/** Minutes after India midnight for a timestamp. */
export function istMinutes(iso: string): number {
  const [h, m] = istFmt.format(new Date(iso)).split(":").map(Number);
  return (h! % 24) * 60 + m!;
}
export const istClock = (iso: string | null | undefined) => (iso ? istFmt.format(new Date(iso)) : "—");
export const hours = (ms: number) => Math.round((ms / HOUR) * 10) / 10;
export const sessionMs = (s: TaskSession, now: number) => Math.max(0, (s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at));

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface DayRow {
  member_id: string; day: string;
  plannedMin: number | null;            // planned working minutes
  plannedStart: number | null;          // minutes after midnight
  checkIn: string | null; checkOut: string | null;
  workedMs: number | null;              // check-in → check-out (→ now for today); null when the check-out is missing
  noCheckout: boolean;                  // an earlier day left open
  lateStartMin: number | null;          // check-in after the planned start (negative = early)
  taskMs: number;                       // time punched in on tasks
  sessions: TaskSession[];
  blocks: PlanItem[];
  blocksWorked: number;                 // planned task blocks whose task got punched in that day
  approved: Task[];                     // tasks the member owns that were approved that day
  approvedLate: Task[];
}

/** One row per member and day that has hours, a check-in, a plan, a session or an approval. */
export function buildDayRows(input: {
  memberIds: string[]; from: string; to: string; days: WorkDay[]; plan: PlanItem[]; sessions: TaskSession[]; tasks: Task[]; today: string; now?: number;
}): DayRow[] {
  const now = input.now ?? Date.now();
  const rows: DayRow[] = [];
  for (const member of input.memberIds) {
    for (const day of eachDay(input.from, input.to)) {
      const w = input.days.find((x) => x.member_id === member && x.day === day);
      const blocks = input.plan.filter((p) => p.member_id === member && p.day === day && !p.removed_at);
      const sessions = input.sessions.filter((s) => s.member_id === member && s.day === day);
      const approved = input.tasks.filter((t) => t.owner_id === member && t.kind !== "deliverable" && t.status === "done" && t.completed_at && indiaDate(t.completed_at) === day);
      if (!w && !blocks.length && !sessions.length && !approved.length) continue;
      const ps = minutesOf(w?.planned_start), pe = minutesOf(w?.planned_end);
      const checkIn = w?.checked_in_at ?? null, checkOut = w?.checked_out_at ?? null;
      const open = Boolean(checkIn && !checkOut);
      const workedMs = checkIn ? (checkOut ? Date.parse(checkOut) - Date.parse(checkIn) : day === input.today ? now - Date.parse(checkIn) : null) : null;
      const worked = new Set(sessions.map((s) => s.task_id));
      rows.push({
        member_id: member, day,
        plannedMin: Number.isFinite(ps) && Number.isFinite(pe) ? pe - ps : null,
        plannedStart: Number.isFinite(ps) ? ps : null,
        checkIn, checkOut, workedMs, noCheckout: open && day < input.today,
        lateStartMin: checkIn && Number.isFinite(ps) ? istMinutes(checkIn) - ps : null,
        taskMs: sessions.reduce((n, s) => n + sessionMs(s, now), 0),
        sessions, blocks,
        blocksWorked: blocks.filter((b) => b.task_id && worked.has(b.task_id)).length,
        approved,
        approvedLate: approved.filter((t) => t.due_date && indiaDate(t.completed_at!) > t.due_date),
      });
    }
  }
  return rows;
}

export interface Summary {
  member_id: string;
  daysWorked: number;          // days with a check-in
  workedH: number; avgH: number | null; taskH: number; focusPct: number | null;   // task time ÷ worked time
  plannedH: number; adherencePct: number | null;   // planned task blocks that were worked on
  approved: number; approvedLate: number; avgDaysLate: number | null;
  perDay: number | null;       // approvals per 8-hour day worked (productivity)
  lateStarts: number; avgLateMin: number | null; missingCheckouts: number;
  openNow: number; overdueNow: number;
}

export function summarize(member: string, rows: DayRow[], tasks: Task[], today: string): Summary {
  const mine = rows.filter((r) => r.member_id === member);
  const worked = mine.filter((r) => r.checkIn);
  const workedMs = mine.reduce((n, r) => n + (r.workedMs ?? 0), 0);
  const taskMs = mine.reduce((n, r) => n + r.taskMs, 0);
  const blocks = mine.flatMap((r) => r.blocks.filter((b) => b.task_id));
  const approved = mine.flatMap((r) => r.approved);
  const late = mine.flatMap((r) => r.approvedLate);
  const lateDays = late.map((t) => (Date.parse(indiaDate(t.completed_at!)) - Date.parse(t.due_date!)) / 86_400_000);
  const starts = mine.filter((r) => r.lateStartMin !== null);
  const lateStarts = starts.filter((r) => r.lateStartMin! > 10);
  const open = tasks.filter((t) => t.owner_id === member && t.kind !== "deliverable" && !t.removed_at && !["done", "cancelled", "requested"].includes(t.status));
  return {
    member_id: member, daysWorked: worked.length,
    workedH: hours(workedMs), avgH: worked.length ? hours(workedMs / worked.length) : null,
    taskH: hours(taskMs), focusPct: workedMs > 0 ? Math.min(100, Math.round((100 * taskMs) / workedMs)) : null,
    plannedH: hours(mine.reduce((n, r) => n + (r.plannedMin ?? 0), 0) * 60_000),
    adherencePct: blocks.length ? Math.round((100 * mine.reduce((n, r) => n + r.blocksWorked, 0)) / blocks.length) : null,
    approved: approved.length, approvedLate: late.length,
    avgDaysLate: lateDays.length ? Math.round((lateDays.reduce((a, b) => a + b, 0) / lateDays.length) * 10) / 10 : null,
    perDay: workedMs >= HOUR ? Math.round((approved.length / (workedMs / (8 * HOUR))) * 10) / 10 : null,
    lateStarts: lateStarts.length, avgLateMin: lateStarts.length ? Math.round(lateStarts.reduce((n, r) => n + r.lateStartMin!, 0) / lateStarts.length) : null,
    missingCheckouts: mine.filter((r) => r.noCheckout).length,
    openNow: open.length, overdueNow: open.filter((t) => t.due_date && t.due_date < today).length,
  };
}

/** Change against the member's own baseline (the 28 days before the period), in %. */
export function vsBaseline(now: number | null, base: number | null): number | null {
  if (now === null || base === null || base === 0) return null;
  return Math.round(((now - base) / base) * 100);
}

/** Per-day series for trends (one value per day in the period). */
export function trend(member: string, rows: DayRow[], from: string, to: string) {
  return eachDay(from, to).map((day) => {
    const r = rows.find((x) => x.member_id === member && x.day === day);
    return { day, workedH: r?.workedMs ? hours(r.workedMs) : 0, taskH: r ? hours(r.taskMs) : 0, approved: r?.approved.length ?? 0 };
  });
}

// ---------------------------------------------------------------- CSV
export function dailyCsv(rows: DayRow[], name: (id: string) => string, title: (id: string) => string) {
  return {
    columns: ["date", "person", "planned_start", "planned_hours", "check_in", "check_out", "worked_hours", "late_start_minutes",
      "task_hours", "sessions", "tasks_worked", "planned_blocks", "planned_task_blocks_worked", "tasks_approved", "approved_after_due", "no_check_out"],
    rows: rows.map((r) => [
      r.day, name(r.member_id), r.plannedStart === null ? null : hhmm(r.plannedStart), r.plannedMin === null ? null : hours(r.plannedMin * 60_000),
      r.checkIn ? istClock(r.checkIn) : null, r.checkOut ? istClock(r.checkOut) : null, r.workedMs === null ? null : hours(r.workedMs), r.lateStartMin,
      hours(r.taskMs), r.sessions.length, [...new Set(r.sessions.map((s) => title(s.task_id)))].join("; "), r.blocks.length, r.blocksWorked,
      r.approved.map((t) => t.title).join("; "), r.approvedLate.length, r.noCheckout,
    ]),
  };
}

export function sessionsCsv(sessions: TaskSession[], name: (id: string) => string, title: (id: string) => string, now = Date.now()) {
  return {
    columns: ["date", "person", "task", "punched_in", "punched_out", "minutes", "ended_by", "planned", "note"],
    rows: sessions.map((s) => [
      s.day, name(s.member_id), title(s.task_id), istClock(s.started_at), s.ended_at ? istClock(s.ended_at) : "still punched in",
      Math.round(sessionMs(s, now) / 60_000), s.ended_by, s.plan_item_id ? "yes" : "no", s.note,
    ]),
  };
}
