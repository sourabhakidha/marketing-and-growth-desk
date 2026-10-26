// Goal → Deliverable → Task (D-041). Pure view model over existing records:
//   * a deliverable belongs to a goal through its goal link;
//   * a task belongs to a deliverable through its parent link;
//   * progress rolls up: tasks → deliverable → goal. It never says the business
//     outcome was achieved — that is recorded on the goal separately.
import type { Goal, TaskWithStage } from "./api.ts";
import { type Rollup, rollup } from "./deliverables.ts";

export interface DeliverableNode { d: TaskWithStage; tasks: TaskWithStage[]; r: Rollup; pct: number }
export interface GoalNode {
  goal: Goal; deliverables: DeliverableNode[]; directTasks: TaskWithStage[];
  pct: number | null; doneDeliverables: number; totalDeliverables: number;
}
export interface Hierarchy { goals: GoalNode[]; unlinkedDeliverables: DeliverableNode[]; looseTasks: TaskWithStage[] }

const live = (t: TaskWithStage) => t.status !== "cancelled" && !t.removed_at;
const kept = (withCancelled: boolean) => (t: TaskWithStage) => !t.removed_at && (withCancelled || t.status !== "cancelled");

export function deliverableNode(d: TaskWithStage, all: TaskWithStage[], today: string, withCancelled = false): DeliverableNode {
  const parts = all.filter((t) => t.parent_id === d.id && !t.removed_at);
  const r = rollup(d, parts, today);
  return { d, tasks: parts.filter(kept(withCancelled)), r, pct: d.status === "done" ? 100 : r.pct ?? 0 };
}

/** Goal progress = the average progress of its deliverables (null when it has none yet). */
export function goalProgress(nodes: DeliverableNode[]): number | null {
  if (!nodes.length) return null;
  return Math.round(nodes.reduce((n, x) => n + x.pct, 0) / nodes.length);
}

/** withCancelled: also show cancelled work (when the status filter asks for All or Cancelled). */
export function buildHierarchy(goals: Goal[], tasks: TaskWithStage[], today: string, withCancelled = false): Hierarchy {
  const keep = kept(withCancelled);
  const deliverables = tasks.filter((t) => t.kind === "deliverable" && keep(t)).map((d) => deliverableNode(d, tasks, today, withCancelled));
  const goalIds = new Set(goals.map((g) => g.id));
  const work = tasks.filter((t) => t.kind !== "deliverable" && keep(t));
  const inDeliverable = (t: TaskWithStage) => Boolean(t.parent_id && deliverables.some((x) => x.d.id === t.parent_id));
  return {
    goals: goals.map((goal) => {
      const ds = deliverables.filter((x) => x.d.goal_id === goal.id);
      const counted = ds.filter((x) => live(x.d));  // progress never counts cancelled deliverables
      return {
        goal, deliverables: ds,
        directTasks: work.filter((t) => !inDeliverable(t) && t.goal_id === goal.id),
        pct: goalProgress(counted), doneDeliverables: counted.filter((x) => x.d.status === "done").length, totalDeliverables: counted.length,
      };
    }),
    unlinkedDeliverables: deliverables.filter((x) => !x.d.goal_id || !goalIds.has(x.d.goal_id)),
    looseTasks: work.filter((t) => !inDeliverable(t) && (!t.goal_id || !goalIds.has(t.goal_id))),
  };
}

// ---------------------------------------------------------------- step columns inside a deliverable
export const DONE_COL = "__done";
export const NO_STEP_COL = "__none";

/** Where a task sits: its current step; a not-yet-started task sits at its first step; approved work in Done. */
export function columnOf(t: TaskWithStage): string {
  if (t.status === "done") return DONE_COL;
  const run = t.task_stages.filter((s) => s.state !== "skipped").sort((a, b) => a.position - b.position);
  const active = run.find((s) => s.state === "active");
  if (active) return active.stage_code;
  const next = run.find((s) => s.state === "pending");
  return next ? next.stage_code : NO_STEP_COL;
}

/**
 * The columns a deliverable actually needs: every step its tasks run (in the shared step
 * order), then Done. Different deliverables therefore show different sequences.
 */
export function stepColumns(tasks: TaskWithStage[], stepOrder: (code: string) => number): { code: string; tasks: TaskWithStage[] }[] {
  const codes = new Set<string>();
  for (const t of tasks) for (const s of t.task_stages) if (s.state !== "skipped") codes.add(s.stage_code);
  const placed = new Map<string, TaskWithStage[]>();
  for (const t of tasks) { const c = columnOf(t); placed.set(c, [...(placed.get(c) ?? []), t]); }
  const ordered = [...codes].sort((a, b) => stepOrder(a) - stepOrder(b));
  return [
    ...(placed.has(NO_STEP_COL) ? [NO_STEP_COL] : []), ...ordered, DONE_COL,
  ].map((code) => ({ code, tasks: placed.get(code) ?? [] }));
}
