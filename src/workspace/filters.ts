// Shared Workspace filters (Pipeline, Status board, List, Calendar). Kept in
// the URL so switching views or sharing a link keeps the same selection.
import { useSearchParams } from "react-router";
import type { TaskWithStage } from "../lib/api.ts";
import { taskRef } from "../lib/format.ts";

export type DueFilter = "" | "overdue" | "today" | "week" | "next14" | "none";

export interface TaskFilters {
  q: string; owner: string; type: string; priority: string; due: DueFilter; goal: string; status: string; mine: boolean;
}
export const EMPTY_FILTERS: TaskFilters = { q: "", owner: "", type: "", priority: "", due: "", goal: "", status: "", mine: false };
const KEYS = Object.keys(EMPTY_FILTERS) as (keyof TaskFilters)[];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Status "open" (default) hides Done and Cancelled; "all" shows everything; otherwise one status. */
export function matchesFilters(t: TaskWithStage, f: TaskFilters, ctx: { meId: string; today: string }): boolean {
  const stage = t.task_stages.find((s) => s.state === "active");
  if (f.mine && t.owner_id !== ctx.meId && stage?.owner_id !== ctx.meId) return false;
  if (f.owner && t.owner_id !== f.owner && stage?.owner_id !== f.owner) return false;
  if (f.type && t.task_type !== f.type) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.goal === "none" ? Boolean(t.goal_id) : Boolean(f.goal) && t.goal_id !== f.goal) return false;
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
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!t.title.toLowerCase().includes(q) && !taskRef(t.ref).toLowerCase().includes(q)) return false;
  }
  return true;
}

export function useTaskFilters() {
  const [params, setParams] = useSearchParams();
  const f: TaskFilters = {
    q: params.get("q") ?? "", owner: params.get("owner") ?? "", type: params.get("type") ?? "",
    priority: params.get("priority") ?? "", due: (params.get("due") ?? "") as DueFilter, goal: params.get("goal") ?? "",
    status: params.get("status") ?? "", mine: params.get("mine") === "1",
  };
  const set = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => setParams((p) => {
    const n = new URLSearchParams(p);
    const val = typeof v === "boolean" ? (v ? "1" : "") : String(v);
    if (val) n.set(k, val); else n.delete(k);
    return n;
  }, { replace: true });
  const clear = () => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const k of KEYS) n.delete(k);
    return n;
  }, { replace: true });
  const active = KEYS.some((k) => f[k] !== EMPTY_FILTERS[k]);
  return { f, set, clear, active };
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
