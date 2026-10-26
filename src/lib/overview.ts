// Workspace Overview (D-044). Pure summaries over recorded goals, deliverables and
// tasks: what is open, how work is moving, where it is stuck and what that holds up
// (task → deliverable → goal). Period figures use the Workspace date range.
// Nothing here claims a business outcome was achieved — that is recorded on goals.
import type { Goal, TaskWithStage } from "./api.ts";
import { addDays, type DateRange, indiaDate, inRange, isBounded, weekStart } from "./dateRange.ts";
import { buildHierarchy, type Hierarchy } from "./hierarchy.ts";
import { isMyTask } from "./scope.tsx";

const CLOSED_GOAL = new Set(["achieved", "not_achieved", "cancelled"]);
const isOpen = (t: TaskWithStage) => t.status !== "done" && t.status !== "cancelled" && !t.removed_at;
const activeStage = (t: TaskWithStage) => t.task_stages.find((s) => s.state === "active") ?? null;
/** Who has the work now: the owner of the current step, else the task owner. */
export const holderOf = (t: TaskWithStage) => activeStage(t)?.owner_id ?? t.owner_id;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export interface Chain { task: TaskWithStage; deliverable: TaskWithStage | null; goal: Goal | null; why: string; kind: "blocked" | "overdue" | "waiting" }
/** personId: the sentence starts with that member's name. */
export interface Insight { tone: "bad" | "warn" | "good" | "info"; text: string; href?: string; personId?: string }
export interface PersonRow { id: string; open: number; overdue: number; blocked: number; inReview: number; done: number; onTime: number | null }
export interface Week { start: string; done: number }

export interface Overview {
  scopeTasks: TaskWithStage[];
  hierarchy: Hierarchy;
  counts: {
    activeGoals: number; goalsAtRisk: number;
    deliverables: number; deliverablesDone: number; deliverablesAtRisk: number;
    open: number; overdue: number; blocked: number; inReview: number; requested: number;
    done: number; created: number;
  };
  onTimePct: number | null;      // approved in the period on or before the due date ÷ approved with a due date
  cycleDays: number | null;      // median days from created to approved, for work approved in the period
  weeks: Week[];                 // approvals per Monday week, last 8 weeks
  people: PersonRow[];
  chains: Chain[];
  insights: Insight[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function buildOverview(input: {
  goals: Goal[]; tasks: TaskWithStage[]; today: string; range: DateRange; meId: string; scope: "team" | "me"; now?: Date;
}): Overview {
  const { goals, today, range, meId } = input;
  const nowIso = (input.now ?? new Date()).toISOString();
  const all = input.tasks.filter((t) => !t.removed_at);
  const byId = new Map(all.map((t) => [t.id, t]));
  const goalOf = (t: TaskWithStage) => {
    const id = t.goal_id ?? (t.parent_id ? byId.get(t.parent_id)?.goal_id : null);
    return id ? goals.find((g) => g.id === id) ?? null : null;
  };

  // Me: my tasks, deliverables that hold my tasks, goals I own or my work serves
  const mine = input.scope === "me";
  const scoped = mine
    ? all.filter((t) => isMyTask(t, meId) || (t.kind === "deliverable" && all.some((p) => p.parent_id === t.id && isMyTask(p, meId))))
    : all;
  const myGoalIds = new Set(scoped.map((t) => goalOf(t)?.id).filter(Boolean) as string[]);
  const scopedGoals = mine ? goals.filter((g) => g.owner_id === meId || myGoalIds.has(g.id)) : goals;
  const hierarchy = buildHierarchy(scopedGoals, scoped, today);

  const work = scoped.filter((t) => t.kind !== "deliverable");
  const open = work.filter(isOpen);
  const overdue = open.filter((t) => t.status !== "requested" && t.due_date && t.due_date < today);
  const blocked = open.filter((t) => t.status === "blocked");
  const doneInPeriod = work.filter((t) => t.status === "done" && t.completed_at && inRange(t.completed_at, range));
  const withDue = doneInPeriod.filter((t) => t.due_date);
  const onTime = withDue.filter((t) => indiaDate(t.completed_at!) <= t.due_date!);

  const deliverableNodes = [...hierarchy.goals.flatMap((g) => g.deliverables), ...hierarchy.unlinkedDeliverables];
  const atRiskD = deliverableNodes.filter((n) => n.r.risk === "blocked" || n.r.risk === "at_risk");
  const activeGoals = hierarchy.goals.filter((g) => !CLOSED_GOAL.has(g.goal.status));
  const goalsAtRisk = activeGoals.filter((g) => g.goal.status === "at_risk"
    || g.deliverables.some((n) => n.r.risk === "blocked" || n.r.risk === "at_risk")
    || (g.goal.end_date !== null && g.goal.end_date < today));

  // approvals per Monday week, oldest first
  const thisWeek = weekStart(today);
  const weeks: Week[] = Array.from({ length: 8 }, (_, i) => ({ start: addDays(thisWeek, (i - 7) * 7), done: 0 }));
  for (const t of work) {
    if (t.status !== "done" || !t.completed_at) continue;
    const w = weeks.find((x) => x.start === weekStart(indiaDate(t.completed_at!)));
    if (w) w.done++;
  }

  // per person: who holds open work now, who got work approved in the period
  const ids = new Set<string>([...open.map(holderOf), ...doneInPeriod.map((t) => t.owner_id)].filter(Boolean) as string[]);
  if (mine) for (const id of [...ids]) if (id !== meId) ids.delete(id);
  const people: PersonRow[] = [...ids].map((id) => {
    const held = open.filter((t) => holderOf(t) === id);
    const done = doneInPeriod.filter((t) => t.owner_id === id);
    const dueDone = done.filter((t) => t.due_date);
    return {
      id, open: held.length, overdue: held.filter((t) => overdue.includes(t)).length, blocked: held.filter((t) => t.status === "blocked").length,
      inReview: held.filter((t) => t.status === "in_review").length, done: done.length,
      onTime: dueDone.length ? Math.round(100 * dueDone.filter((t) => indiaDate(t.completed_at!) <= t.due_date!).length / dueDone.length) : null,
    };
  }).sort((a, b) => b.open - a.open || b.done - a.done);

  // what is stuck and what it holds up
  const chainOf = (t: TaskWithStage, kind: Chain["kind"], why: string): Chain =>
    ({ task: t, deliverable: t.parent_id ? byId.get(t.parent_id) ?? null : null, goal: goalOf(t), why, kind });
  const waiting = open.filter((t) => {
    const s = activeStage(t);
    return t.status !== "blocked" && s && s.owner_id && !s.picked_up_at && s.ready_at && days(s.ready_at, nowIso) >= 2;
  });
  const chains: Chain[] = [
    ...blocked.map((t) => chainOf(t, "blocked", t.blocker_reason ?? "Reason not recorded")),
    ...overdue.filter((t) => t.status !== "blocked").map((t) => chainOf(t, "overdue", `Was due ${t.due_date}`)),
    ...waiting.map((t) => chainOf(t, "waiting", `Handed over ${Math.floor(days(activeStage(t)!.ready_at!, nowIso))} days ago, not picked up`)),
  ];

  // plain-language observations, most pressing first
  const insights: Insight[] = [];
  const noWork = activeGoals.filter((g) => g.deliverables.length === 0 && g.directTasks.length === 0);
  for (const g of noWork.slice(0, 3)) insights.push({ tone: "warn", text: `“${g.goal.title}” has no deliverables or tasks yet.`, href: "/workspace/goals" });
  const pastEnd = activeGoals.filter((g) => g.goal.end_date && g.goal.end_date < today);
  for (const g of pastEnd.slice(0, 3)) insights.push({ tone: "bad", text: `“${g.goal.title}” passed its end date without an outcome recorded.`, href: `/goals#goal-${g.goal.ref}` });
  if (blocked.length) insights.push({ tone: "bad", text: `${blocked.length} task${blocked.length > 1 ? "s are" : " is"} blocked${chains.some((c) => c.kind === "blocked" && c.deliverable) ? ", holding up deliverables" : ""}.`, href: "/workspace/list?status=blocked" });
  if (atRiskD.length) insights.push({ tone: "warn", text: `${atRiskD.length} deliverable${atRiskD.length > 1 ? "s are" : " is"} at risk of missing ${atRiskD.length > 1 ? "their dates" : "its date"}.`, href: "/workspace/deliverables" });
  if (waiting.length) insights.push({ tone: "warn", text: `${waiting.length} handover${waiting.length > 1 ? "s have" : " has"} waited 2+ days to be picked up.` });
  const loads = people.filter((p) => p.open > 0);
  const avg = loads.length ? loads.reduce((n, p) => n + p.open, 0) / loads.length : 0;
  const heavy = !mine && loads.length > 1 ? loads.find((p) => p.open >= 4 && p.open >= 1.5 * avg) : undefined;
  if (heavy) insights.push({ tone: "info", personId: heavy.id, text: `holds ${heavy.open} open tasks — ${Math.round(heavy.open / avg * 10) / 10}× the team average.` });
  const requested = scoped.filter((t) => t.status === "requested");
  const oldRequests = requested.filter((t) => days(t.created_at, nowIso) >= 2);
  if (oldRequests.length) insights.push({ tone: "warn", text: `${oldRequests.length} request${oldRequests.length > 1 ? "s have" : " has"} waited 2+ days for an answer.`, href: "/workspace/list?status=requested" });
  const loose = open.filter((t) => !goalOf(t) && !t.parent_id).length;
  if (loose) insights.push({ tone: "info", text: `${loose} open task${loose > 1 ? "s are" : " is"} not linked to any goal or deliverable.`, href: "/workspace/list?goal=none" });
  if (withDue.length >= 3) {
    const pct = Math.round(100 * onTime.length / withDue.length);
    insights.push({ tone: pct >= 80 ? "good" : pct >= 60 ? "info" : "warn", text: `${pct}% of work approved ${isBounded(range) ? "in this period" : "so far"} landed on or before its due date (${onTime.length} of ${withDue.length}).` });
  }
  if (!insights.length) insights.push({ tone: "good", text: "Nothing is blocked, overdue or waiting. Work is moving." });

  return {
    scopeTasks: scoped, hierarchy,
    counts: {
      activeGoals: activeGoals.length, goalsAtRisk: goalsAtRisk.length,
      deliverables: deliverableNodes.length, deliverablesDone: deliverableNodes.filter((n) => n.d.status === "done").length, deliverablesAtRisk: atRiskD.length,
      open: open.filter((t) => t.status !== "requested").length, overdue: overdue.length, blocked: blocked.length,
      inReview: open.filter((t) => t.status === "in_review").length, requested: requested.length,
      done: doneInPeriod.length, created: work.filter((t) => inRange(t.created_at, range)).length,
    },
    onTimePct: withDue.length ? Math.round(100 * onTime.length / withDue.length) : null,
    cycleDays: median(doneInPeriod.map((t) => days(t.created_at, t.completed_at!))),
    weeks, people, chains, insights,
  };
}
