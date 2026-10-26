// Deliverables and their parts (D-038). Pure roll-ups over recorded data:
// a deliverable's progress, risk and next step come from its parts; the
// journey timeline is drawn only from recorded stage timestamps.
import type { Task, TaskStage } from "./api.ts";

export type Risk = "done" | "blocked" | "at_risk" | "on_track" | "no_parts";

export interface Rollup {
  parts: Task[];
  total: number; done: number; cancelled: number; open: number; requested: number;
  pct: number | null;                 // done ÷ parts that still count (cancelled excluded)
  blocked: Task[]; overdue: Task[]; late: Task[]; // late = due after the deliverable's own date
  risk: Risk;
  reasons: string[];
  next: Task | null;                  // the open part due first (the one to watch)
}

const isOpen = (t: Task) => t.status !== "done" && t.status !== "cancelled";

export function partsOf(deliverableId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parent_id === deliverableId && !t.removed_at);
}

/** The date a deliverable must land by: its publish date, else its due date. */
export const deadlineOf = (d: Task) => d.publish_date ?? d.due_date ?? null;

export function rollup(d: Task, parts: Task[], today: string): Rollup {
  const done = parts.filter((p) => p.status === "done").length;
  const cancelled = parts.filter((p) => p.status === "cancelled").length;
  const requested = parts.filter((p) => p.status === "requested").length;
  const open = parts.filter(isOpen);
  const counting = parts.length - cancelled;
  const blocked = open.filter((p) => p.status === "blocked");
  const overdue = open.filter((p) => p.due_date && p.due_date < today);
  const deadline = deadlineOf(d);
  const late = deadline ? open.filter((p) => p.due_date && p.due_date > deadline) : [];
  const reasons: string[] = [];
  if (blocked.length) reasons.push(`${blocked.length} task${blocked.length > 1 ? "s" : ""} blocked`);
  if (overdue.length) reasons.push(`${overdue.length} task${overdue.length > 1 ? "s" : ""} overdue`);
  if (late.length) reasons.push(`${late.length} task${late.length > 1 ? "s" : ""} due after the deliverable's date`);
  if (deadline && deadline < today && d.status !== "done") reasons.push("deliverable date has passed");
  if (requested) reasons.push(`${requested} task${requested > 1 ? "s" : ""} awaiting acceptance`);
  const risk: Risk = d.status === "done" ? "done"
    : parts.length === 0 ? "no_parts"
    : blocked.length ? "blocked"
    : overdue.length || late.length || (deadline != null && deadline < today) ? "at_risk"
    : "on_track";
  const next = [...open].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.ref - b.ref)[0] ?? null;
  return {
    parts, total: parts.length, done, cancelled, open: open.length, requested,
    pct: counting > 0 ? Math.round((100 * done) / counting) : null,
    blocked, overdue, late, risk, reasons, next,
  };
}

export const RISK_LABEL: Record<Risk, string> = {
  done: "Approved", blocked: "Blocked", at_risk: "At risk", on_track: "On track", no_parts: "No tasks yet",
};

// ---------------------------------------------------------------- journey timeline
export interface Segment { stage: string; kind: "wait" | "work"; start: number; end: number; open: boolean; rework: boolean }
export interface TimelineRow { task: Task; segments: Segment[]; due: number | null; doneAt: number | null }
export interface Timeline { start: number; end: number; rows: TimelineRow[]; deadline: number | null; now: number }

const ms = (v: string | null | undefined) => (v ? Date.parse(v.length === 10 ? `${v}T23:59:59+05:30` : v) : NaN);

/**
 * One row per part. A stage contributes a "wait" segment (ready → picked up) and a
 * "work" segment (picked up → completed, or → now while active). Stages never
 * entered are not drawn; nothing is estimated.
 */
export function buildTimeline(d: Task, parts: Task[], stages: TaskStage[], now: Date = new Date()): Timeline {
  const nowMs = now.getTime();
  const rows: TimelineRow[] = parts.map((task) => {
    const segments: Segment[] = [];
    for (const s of stages.filter((x) => x.task_id === task.id).sort((a, b) => a.position - b.position)) {
      if (!s.entered_at || s.state === "pending" || s.state === "skipped") continue;
      const ready = ms(s.ready_at ?? s.entered_at);
      const picked = ms(s.picked_up_at);
      const end = s.state === "done" ? ms(s.completed_at) : nowMs;
      const rework = s.revision_count > 0;
      if (Number.isFinite(ready)) {
        const waitEnd = Number.isFinite(picked) ? picked : s.state === "active" ? nowMs : end;
        if (Number.isFinite(waitEnd) && waitEnd > ready) segments.push({ stage: s.stage_code, kind: "wait", start: ready, end: waitEnd, open: s.state === "active" && !Number.isFinite(picked), rework });
      }
      if (Number.isFinite(picked) && Number.isFinite(end) && end > picked) {
        segments.push({ stage: s.stage_code, kind: "work", start: picked, end, open: s.state === "active", rework });
      }
    }
    return { task, segments, due: Number.isFinite(ms(task.due_date)) ? ms(task.due_date) : null, doneAt: Number.isFinite(ms(task.completed_at)) ? ms(task.completed_at) : null };
  });
  const deadline = Number.isFinite(ms(deadlineOf(d))) ? ms(deadlineOf(d)) : null;
  const points = [ms(d.created_at), ...rows.flatMap((r) => [...r.segments.flatMap((s) => [s.start, s.end]), r.due ?? NaN, r.doneAt ?? NaN]),
    ...parts.map((p) => ms(p.created_at)), deadline ?? NaN, nowMs].filter(Number.isFinite);
  const start = Math.min(...points);
  const end = Math.max(...points);
  return { start, end: end > start ? end : start + 86400000, rows, deadline, now: nowMs };
}

/** Position in the timeline as a percentage (clamped). */
export const at = (t: Timeline, v: number) => Math.max(0, Math.min(100, ((v - t.start) / (t.end - t.start)) * 100));
