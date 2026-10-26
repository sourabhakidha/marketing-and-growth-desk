// Shared Workspace filters (Pipeline, Status board, List, Calendar). Kept in
// the URL so switching views or sharing a link keeps the same selection.
import { useSearchParams } from "react-router";
import type { Task, TaskWithStage } from "../lib/api.ts";
import { type DateRange, inRange, isPreset, overlaps, resolveRange } from "../lib/dateRange.ts";
import { isMyTask, type Scope } from "../lib/scope.tsx";
import { type GroupBy, isGroupBy } from "./phases.ts";

export type DueFilter = "" | "overdue" | "today" | "week" | "next14" | "none";

export interface TaskFilters {
  q: string; owner: string; type: string; priority: string; due: DueFilter; goal: string; status: string; mine: boolean;
  /** shared date range (D-029): preset, custom ends, and which task date it applies to */
  range: string; from: string; to: string; on: string;
  channel: string;
  /** D-041: only the tasks of one deliverable (and the deliverable itself) */
  deliverable: string;
}
export const EMPTY_FILTERS: TaskFilters = {
  q: "", owner: "", type: "", priority: "", due: "", goal: "", status: "", mine: false, range: "", from: "", to: "", on: "",
  channel: "", deliverable: "",
};

/** Which task date the range applies to. "open" = the task was open at some point in the period. */
export const TASK_DATE_BASES = [
  { value: "created", label: "Created in period" },
  { value: "open", label: "Open during period" },
  { value: "approved", label: "Approved in period" },
  { value: "due", label: "Due in period" },
  { value: "publish", label: "Publishing in period" },
];

export function taskRange(f: TaskFilters, today: string): DateRange {
  return resolveRange(isPreset(f.range) ? f.range : "all", today, f);
}

export function taskInRange(t: TaskWithStage, basis: string, r: DateRange): boolean {
  switch (basis) {
    case "approved": return inRange(t.completed_at, r);
    case "due": return inRange(t.due_date, r);
    case "publish": return inRange(t.publish_date, r);
    // closed tasks stop being open when approved; a cancelled task's last update is the best record of when
    case "open": return overlaps(t.created_at, t.status === "done" ? t.completed_at : t.status === "cancelled" ? t.updated_at : null, r);
    default: return inRange(t.created_at, r);
  }
}
const KEYS = Object.keys(EMPTY_FILTERS) as (keyof TaskFilters)[];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Status "open" (default) hides Done and Cancelled; "all" shows everything; otherwise one status. */
export function matchesFilters(t: TaskWithStage, f: TaskFilters, ctx: { meId: string; today: string; scope?: Scope; all?: Task[] }): boolean {
  if (ctx.scope === "me" && !isMyTask(t, ctx.meId)) return false;
  const stage = t.task_stages.find((s) => s.state === "active");
  if (f.mine && t.owner_id !== ctx.meId && stage?.owner_id !== ctx.meId) return false;
  if (f.owner && t.owner_id !== f.owner && stage?.owner_id !== f.owner) return false;
  if (f.type && t.task_type !== f.type) return false;
  if (f.channel && t.channel !== f.channel) return false;
  if (f.deliverable && t.parent_id !== f.deliverable && t.id !== f.deliverable) return false;
  if (f.priority && t.priority !== f.priority) return false;
  // a task inside a deliverable serves the deliverable's goal unless it names its own
  const goalId = t.goal_id ?? (t.parent_id ? ctx.all?.find((x) => x.id === t.parent_id)?.goal_id ?? null : null);
  if (f.goal === "none" ? Boolean(goalId) : Boolean(f.goal) && goalId !== f.goal) return false;
  if (f.status === "" || f.status === "open") { if (t.status === "cancelled") return false; }
  else if (f.status === "active") { if (t.status === "done" || t.status === "cancelled") return false; }
  else if (f.status !== "all" && t.status !== f.status) return false;
  if (f.due) {
    const d = t.due_date;
    const closed = t.status === "done" || t.status === "cancelled";
    if (f.due === "none") { if (d) return false; }
    else if (!d) return false;
    else if (f.due === "overdue") { if (closed || d >= ctx.today) return false; }
    else if (f.due === "today") { if (d !== ctx.today) return false; }
    else if (f.due === "week") { if (d < ctx.today || d > addDays(ctx.today, 7)) return false; }
    else if (f.due === "next14") { if (d < ctx.today || d > addDays(ctx.today, 14)) return false; }
  }
  if (f.range && f.range !== "all" && !taskInRange(t, f.on || "created", taskRange(f, ctx.today))) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!t.title.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** One-click presets in the filter bar (D-040). */
export const SAVED_VIEWS: { label: string; patch: Partial<TaskFilters> }[] = [
  { label: "Due this week", patch: { due: "week" } },
  { label: "Overdue", patch: { due: "overdue" } },
  { label: "Blocked", patch: { status: "blocked" } },
  { label: "Awaiting approval", patch: { status: "in_review" } },
  { label: "Requests", patch: { status: "requested" } },
];

/** Group by (Board, Table, Timeline), kept in the URL with the filters. */
export function useGroupBy(fallback: GroupBy = "none"): [GroupBy, (g: GroupBy) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("group");
  const group = isGroupBy(raw) ? raw : fallback;
  const set = (g: GroupBy) => setParams((p) => { const n = new URLSearchParams(p); if (g === fallback) n.delete("group"); else n.set("group", g); return n; }, { replace: true });
  return [group, set];
}

export function useTaskFilters() {
  const [params, setParams] = useSearchParams();
  const f: TaskFilters = {
    q: params.get("q") ?? "", owner: params.get("owner") ?? "", type: params.get("type") ?? "",
    priority: params.get("priority") ?? "", due: (params.get("due") ?? "") as DueFilter, goal: params.get("goal") ?? "",
    status: params.get("status") ?? "", mine: params.get("mine") === "1",
    range: params.get("range") ?? "", from: params.get("from") ?? "", to: params.get("to") ?? "", on: params.get("on") ?? "",
    channel: params.get("channel") ?? "", deliverable: params.get("deliverable") ?? "",
  };
  const set = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => setMany({ [k]: v } as Partial<TaskFilters>);
  const setMany = (patch: Partial<TaskFilters>) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) {
      const val = typeof v === "boolean" ? (v ? "1" : "") : String(v ?? "");
      if (val) n.set(k, val); else n.delete(k);
    }
    return n;
  }, { replace: true });
  const clear = () => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const k of KEYS) n.delete(k);
    return n;
  }, { replace: true });
  const active = KEYS.some((k) => f[k] !== EMPTY_FILTERS[k]);
  return { f, set, setMany, clear, active };
}

/** Open a task in the side panel without leaving the current view. */
export function useTaskPanel() {
  const [params, setParams] = useSearchParams();
  const ref = Number(params.get("task"));
  const action = params.get("action");
  const open = (taskRef: number, act?: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set("task", String(taskRef));
    if (act) n.set("action", act); else n.delete("action");
    return n;
  });
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); n.delete("action"); return n; });
  const clearAction = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("action"); return n; }, { replace: true });
  return { ref: Number.isFinite(ref) && ref > 0 ? ref : null, action, open, close, clearAction };
}
