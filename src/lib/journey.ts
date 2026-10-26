// Deliverable journey (D-045). A deliverable is either standalone (one person does it
// start to finish) or a workflow of tasks, one per step, done by different people.
// This module turns the recorded tasks, steps and history into the journey: who did
// what and when, how long work waited, worked and sat in review, where it was late or
// reworked, and where it went well. Everything is measured from records; nothing is
// estimated, and steps that never started are not drawn.
import type { Task, TaskEvent, TaskStage } from "./api.ts";
import { deadlineOf } from "./deliverables.ts";
import { indiaDate } from "./dateRange.ts";

const DAY = 86_400_000;
const ms = (v: string | null | undefined) => (v ? Date.parse(v.length === 10 ? `${v}T23:59:59+05:30` : v) : NaN);
const fin = (n: number) => Number.isFinite(n);
export const toDays = (milli: number) => Math.round((milli / DAY) * 10) / 10;

/** One task in the journey, with its measured timings (milliseconds; NaN when not reached yet). */
export interface JourneyTask {
  task: Task;
  step: string | null;           // the step this task is (its first step)
  steps: string[];               // all its steps, for older multi-step tasks
  person: string;                // who did / is doing the work
  ready: number;                 // handed over (first step became ready)
  waitFrom: number;              // when it could really start (ready, or when the previous step finished)
  started: number;               // picked up
  submitted: number;             // first sent for approval
  finished: number;              // approved
  due: number | null;
  waitMs: number;                // ready → picked up
  workMs: number;                // picked up → approved (or now), less review and blocked time
  reviewMs: number;              // submitted → approved (or now while in review)
  blockedMs: number;
  rework: number;                // changes requested + steps returned for rework
  daysLate: number | null;       // + late / − early, by India calendar date; null when no due date or not finished
  overdueOpen: boolean;
}

export interface Column { step: string | null; tasks: JourneyTask[]; start: number; firstPickUp: number; end: number }
/** From one step finishing to the next being picked up (negative = the next step started first, in parallel). */
export interface Handover { from: string | null; to: string | null; gapMs: number }
export interface PersonLine { id: string; tasks: number; steps: string[]; workMs: number; waitMs: number; reviewMs: number; onTime: number; late: number; rework: number }
export interface Point { tone: "good" | "bad"; text: string; taskId?: string }

export interface Journey {
  mode: "standalone" | "workflow";
  tasks: JourneyTask[];
  columns: Column[];
  handovers: Handover[];
  people: PersonLine[];
  start: number; end: number; deadline: number | null; now: number;
  finished: number;               // the deliverable's approval time, or NaN
  verdict: { tone: "good" | "bad" | "neutral"; text: string };
  split: { workMs: number; waitMs: number; reviewMs: number; blockedMs: number };
  wentWell: Point[];
  lostTime: Point[];
}

export function buildJourney(input: {
  deliverable: Task; parts: Task[]; stages: TaskStage[]; events: TaskEvent[];
  stepRank: (code: string) => number; stepLabel: (code: string) => string; now?: Date;
}): Journey {
  const { deliverable: d, stages, events, stepRank, stepLabel } = input;
  const now = (input.now ?? new Date()).getTime();
  const parts = input.parts.filter((p) => !p.removed_at && p.status !== "cancelled");
  const standalone = parts.length === 0;
  const work = standalone ? [d] : parts;

  const tasks: JourneyTask[] = work.map((t) => {
    const own = stages.filter((s) => s.task_id === t.id && s.state !== "skipped").sort((a, b) => a.position - b.position);
    const ev = events.filter((e) => e.task_id === t.id).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const first = own[0];
    const ready = ms(first?.ready_at ?? first?.entered_at ?? (t.status === "requested" ? null : t.created_at));
    const pickedUp = own.map((s) => ms(s.picked_up_at)).filter(fin);
    const started = pickedUp.length ? Math.min(...pickedUp) : NaN;
    const submittedAt = ev.filter((e) => e.event_type === "submitted_for_approval").map((e) => ms(e.occurred_at));
    const submitted = submittedAt.length ? submittedAt[0]! : NaN;
    const finished = t.status === "done" ? ms(t.completed_at) : NaN;
    // time in review: from each submission to the decision that followed it
    let reviewMs = 0;
    let openSubmit = NaN;
    for (const e of ev) {
      if (e.event_type === "submitted_for_approval") openSubmit = ms(e.occurred_at);
      if ((e.event_type === "approved" || e.event_type === "changes_requested") && fin(openSubmit)) { reviewMs += ms(e.occurred_at) - openSubmit; openSubmit = NaN; }
    }
    if (fin(openSubmit) && t.status === "in_review") reviewMs += now - openSubmit;
    let blockedMs = 0;
    let blockedAt = NaN;
    for (const e of ev) {
      if (e.event_type === "blocked") blockedAt = ms(e.occurred_at);
      if (e.event_type === "unblocked" && fin(blockedAt)) { blockedMs += ms(e.occurred_at) - blockedAt; blockedAt = NaN; }
    }
    if (fin(blockedAt) && t.status === "blocked") blockedMs += now - blockedAt;
    const rework = ev.filter((e) => e.event_type === "changes_requested" || e.event_type === "returned_for_rework").length;
    const dueDate = t.kind === "deliverable" ? deadlineOf(t) : t.due_date;
    const due = fin(ms(dueDate)) ? ms(dueDate) : null;
    const daysLate = fin(finished) && dueDate
      ? Math.round((Date.parse(`${indiaDate(t.completed_at!)}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY) : null;
    const holder = own.find((s) => s.state === "active")?.owner_id ?? [...own].reverse().find((s) => s.owner_id)?.owner_id ?? t.owner_id;
    return {
      task: t, step: first?.stage_code ?? null, steps: own.map((s) => s.stage_code), person: holder,
      ready, waitFrom: ready, started, submitted, finished, due,
      waitMs: fin(ready) ? Math.max(0, (fin(started) ? started : t.status === "done" ? finished : now) - ready) : 0,
      // working time: picked up → approved (or now), less time in review and blocked; rework counts as work
      workMs: fin(started) ? Math.max(0, (fin(finished) ? finished : now) - started - reviewMs - blockedMs) : 0,
      reviewMs, blockedMs, rework, daysLate,
      overdueOpen: t.status !== "done" && Boolean(dueDate) && indiaDate(new Date(now).toISOString()) > dueDate!,
    };
  });
  // fix the waiting time for work that never had a separate pick-up (approved straight away)
  for (const j of tasks) if (!fin(j.started) && fin(j.finished)) j.waitMs = 0;

  // columns: one per step, in workflow order
  const rank = (c: string | null) => (c ? stepRank(c) : 999);
  const byStep = new Map<string, JourneyTask[]>();
  for (const j of tasks) byStep.set(j.step ?? "", [...(byStep.get(j.step ?? "") ?? []), j]);
  const columns: Column[] = [...byStep.entries()]
    .map(([step, ts]) => ({
      step: step || null,
      tasks: ts.sort((a, b) => (a.ready || 0) - (b.ready || 0)),
      start: Math.min(...ts.map((j) => j.ready).filter(fin), Infinity),
      firstPickUp: Math.min(...ts.map((j) => j.started).filter(fin), Infinity),
      end: Math.max(...ts.map((j) => (fin(j.finished) ? j.finished : NaN)).filter(fin), -Infinity),
    }))
    .sort((a, b) => rank(a.step) - rank(b.step) || a.start - b.start);
  // In a workflow every task exists from the start, but a step can only really begin once the
  // step before it is done: waiting is counted from then (or from its hand-over, if later).
  columns.forEach((c, k) => {
    if (k === 0) return;
    const prevEnd = columns[k - 1]!.end;
    for (const j of c.tasks) {
      if (!fin(j.ready)) continue;
      if (fin(j.started)) {
        const from = fin(prevEnd) && prevEnd < j.started ? Math.max(j.ready, prevEnd) : j.ready;
        j.waitFrom = from;
        j.waitMs = Math.max(0, j.started - from);
      } else if (!fin(j.finished)) {
        j.waitFrom = fin(prevEnd) ? Math.max(j.ready, prevEnd) : NaN;
        j.waitMs = fin(prevEnd) ? Math.max(0, now - j.waitFrom) : 0;
      }
    }
  });
  const handovers: Handover[] = columns.slice(1).map((c, i) => {
    const prev = columns[i]!;
    return { from: prev.step, to: c.step, gapMs: fin(prev.end) && fin(c.firstPickUp) ? c.firstPickUp - prev.end : NaN };
  });

  // people
  const ids = [...new Set(tasks.map((j) => j.person))];
  const people: PersonLine[] = ids.map((id) => {
    const mine = tasks.filter((j) => j.person === id);
    return {
      id, tasks: mine.length, steps: [...new Set(mine.map((j) => j.step).filter(Boolean) as string[])],
      workMs: mine.reduce((n, j) => n + j.workMs, 0), waitMs: mine.reduce((n, j) => n + j.waitMs, 0), reviewMs: mine.reduce((n, j) => n + j.reviewMs, 0),
      onTime: mine.filter((j) => j.daysLate !== null && j.daysLate <= 0).length, late: mine.filter((j) => j.daysLate !== null && j.daysLate > 0).length,
      rework: mine.reduce((n, j) => n + j.rework, 0),
    };
  }).sort((a, b) => b.tasks - a.tasks);

  // overall span and the deliverable's own result
  const deadline = fin(ms(deadlineOf(d))) ? ms(deadlineOf(d)) : null;
  const finished = d.status === "done" ? ms(d.completed_at) : NaN;
  const points = [ms(d.created_at), ...tasks.flatMap((j) => [j.ready, j.started, j.finished, j.due ?? NaN]), deadline ?? NaN, fin(finished) ? finished : now].filter(fin);
  const start = Math.min(...points);
  const end = Math.max(...points, start + DAY);
  const dl = deadlineOf(d);
  let verdict: Journey["verdict"];
  if (fin(finished) && dl) {
    const late = Math.round((Date.parse(`${indiaDate(d.completed_at!)}T00:00:00Z`) - Date.parse(`${dl}T00:00:00Z`)) / DAY);
    verdict = late > 0 ? { tone: "bad", text: `Delivered ${late} day${late === 1 ? "" : "s"} after its date` }
      : late < 0 ? { tone: "good", text: `Delivered ${-late} day${late === -1 ? "" : "s"} early` } : { tone: "good", text: "Delivered on its date" };
  } else if (fin(finished)) verdict = { tone: "neutral", text: `Delivered ${indiaDate(d.completed_at!)} (no date was set)` };
  else if (dl) {
    const left = Math.round((Date.parse(`${dl}T00:00:00Z`) - Date.parse(`${indiaDate(new Date(now).toISOString())}T00:00:00Z`)) / DAY);
    verdict = left < 0 ? { tone: "bad", text: `Open, ${-left} day${left === -1 ? "" : "s"} past its date` } : { tone: "neutral", text: left === 0 ? "Open, due today" : `Open, ${left} day${left === 1 ? "" : "s"} left` };
  } else verdict = { tone: "neutral", text: "Open, no date set" };

  // where the time went
  // (waiting already includes the time between one step finishing and the next being picked up)
  const split = { workMs: tasks.reduce((n, j) => n + j.workMs, 0), waitMs: tasks.reduce((n, j) => n + j.waitMs, 0),
    reviewMs: tasks.reduce((n, j) => n + j.reviewMs, 0), blockedMs: tasks.reduce((n, j) => n + j.blockedMs, 0) };

  // what went well, and where time was lost
  const name = (j: JourneyTask) => `“${j.task.title}”`;
  const wentWell: Point[] = [];
  const lostTime: Point[] = [];
  for (const j of tasks) {
    if (j.daysLate !== null && j.daysLate < 0) wentWell.push({ tone: "good", taskId: j.task.id, text: `${name(j)} was approved ${-j.daysLate} day${j.daysLate === -1 ? "" : "s"} early.` });
    if (j.daysLate !== null && j.daysLate > 0) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} was approved ${j.daysLate} day${j.daysLate === 1 ? "" : "s"} late.` });
    if (j.overdueOpen) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} is past its due date and still open.` });
    if (j.waitMs >= DAY) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} waited ${toDays(j.waitMs)} days before anyone picked it up.` });
    if (fin(j.started) && j.waitMs < 4 * 3_600_000 && fin(j.ready)) wentWell.push({ tone: "good", taskId: j.task.id, text: `${name(j)} was picked up within ${Math.max(1, Math.round(j.waitMs / 3_600_000))} hour${j.waitMs < 1.5 * 3_600_000 ? "" : "s"}.` });
    if (j.reviewMs >= 2 * DAY) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} spent ${toDays(j.reviewMs)} days waiting for approval.` });
    if (j.rework > 0) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} needed ${j.rework} round${j.rework > 1 ? "s" : ""} of changes.` });
    else if (j.task.status === "done") wentWell.push({ tone: "good", taskId: j.task.id, text: `${name(j)} was approved first time, with no changes.` });
    if (j.blockedMs >= 3_600_000) lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} was blocked for ${toDays(j.blockedMs) || "<0.1"} days.` });
    if (!j.due && j.task.status !== "done" && j.task.kind !== "deliverable") lostTime.push({ tone: "bad", taskId: j.task.id, text: `${name(j)} has no due date, so it can't be judged on time.` });
  }
  for (const h of handovers) {
    if (fin(h.gapMs) && h.gapMs < 0) wentWell.push({ tone: "good", text: `${h.to ? stepLabel(h.to) : "The next step"} started before ${h.from ? stepLabel(h.from) : "the previous step"} finished, so work overlapped.` });
  }
  if (verdict.tone === "good") wentWell.unshift({ tone: "good", text: `${verdict.text}.` });
  if (verdict.tone === "bad") lostTime.unshift({ tone: "bad", text: `${verdict.text}.` });

  return {
    mode: standalone ? "standalone" : "workflow", tasks, columns, handovers, people,
    start, end, deadline, now, finished, verdict, split, wentWell, lostTime,
  };
}

/** Position on the journey's time axis as a percentage (clamped). */
export const pos = (j: { start: number; end: number }, v: number) => Math.max(0, Math.min(100, ((v - j.start) / (j.end - j.start)) * 100));
