// Workspace view model (D-040): every task sits in one of five plain phases;
// the detailed workflow stage is shown on the card, not as a column. Grouping
// (deliverable, owner, goal, channel, type) is shared by Board, Table and Timeline.
import type { Goal, TaskWithStage } from "../lib/api.ts";
import { REVIEW_STAGES } from "../lib/permissions.ts";

export type Phase = "requested" | "todo" | "doing" | "review" | "done";

export const PHASES: { key: Phase; label: string; hint: string }[] = [
  { key: "requested", label: "Requested", hint: "Waiting for an admin to accept" },
  { key: "todo", label: "To do", hint: "Accepted, not picked up yet" },
  { key: "doing", label: "In progress", hint: "Being worked on (blocked items are flagged)" },
  { key: "review", label: "In review", hint: "With an admin for review, sign-off or approval" },
  { key: "done", label: "Done", hint: "Approved" },
];

const activeStage = (t: TaskWithStage) => t.task_stages.find((s) => s.state === "active") ?? null;

/** The phase a task is in. Cancelled tasks have none (they are not on the board). */
export function phaseOf(t: TaskWithStage, isAdminMember: (id: string | null | undefined) => boolean): Phase | null {
  if (t.status === "cancelled") return null;
  if (t.status === "requested") return "requested";
  if (t.status === "done") return "done";
  if (t.status === "in_review") return "review";
  const s = activeStage(t);
  if (s && REVIEW_STAGES.has(s.stage_code) && isAdminMember(s.owner_id)) return "review";
  if (t.status === "not_started" && (!s || !s.picked_up_at)) return "todo";
  return "doing";
}

/** "Writing / Scripting · 2 of 5" — position among the stages this task actually runs. */
export function stageStep(t: TaskWithStage): { code: string; step: number; of: number } | null {
  const s = activeStage(t);
  if (!s) return null;
  const run = t.task_stages.filter((x) => x.state !== "skipped").sort((a, b) => a.position - b.position);
  return { code: s.stage_code, step: run.findIndex((x) => x.id === s.id) + 1, of: run.length };
}

/** Share of a task's stages completed (for timeline bars); null when it has no workflow. */
export function stageProgress(t: TaskWithStage): number | null {
  if (t.status === "done") return 100;
  const run = t.task_stages.filter((x) => x.state !== "skipped");
  if (!run.length) return null;
  return Math.round((100 * run.filter((x) => x.state === "done").length) / run.length);
}

// ---------------------------------------------------------------- grouping
export type GroupBy = "none" | "deliverable" | "owner" | "goal" | "channel" | "type";
export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" }, { value: "deliverable", label: "Deliverable" }, { value: "owner", label: "Owner" },
  { value: "goal", label: "Goal" }, { value: "channel", label: "Channel" }, { value: "type", label: "Task type" },
];
export const isGroupBy = (v: string | null): v is GroupBy => GROUP_OPTIONS.some((o) => o.value === v);

export interface Group<T> { key: string; title: string; deliverable?: TaskWithStage; tasks: T[] }

/**
 * Split work items into groups, in a stable, readable order. Deliverables themselves are
 * never items; with "deliverable" grouping each one becomes a group header (even with no
 * visible parts) and standalone work is collected last.
 */
export function groupTasks(items: TaskWithStage[], by: GroupBy, ctx: {
  all: TaskWithStage[]; goals: Goal[]; label: (v: string, c: string | null | undefined) => string; memberName: (id: string | null | undefined) => string;
  deliverables?: TaskWithStage[];
}): Group<TaskWithStage>[] {
  if (by === "none") return [{ key: "all", title: "", tasks: items }];
  const map = new Map<string, Group<TaskWithStage>>();
  const put = (key: string, title: string, t?: TaskWithStage, d?: TaskWithStage) => {
    const g = map.get(key) ?? { key, title, deliverable: d, tasks: [] };
    if (t) g.tasks.push(t);
    map.set(key, g);
  };
  if (by === "deliverable") {
    for (const d of ctx.deliverables ?? []) put(d.id, d.title, undefined, d);
  }
  for (const t of items) {
    if (by === "deliverable") {
      const d = t.parent_id ? ctx.all.find((x) => x.id === t.parent_id) : undefined;
      if (d) put(d.id, d.title, t, d); else put("~none", "Standalone tasks", t);
    } else if (by === "owner") put(t.owner_id, ctx.memberName(t.owner_id), t);
    else if (by === "goal") {
      const g = ctx.goals.find((x) => x.id === t.goal_id);
      put(g ? g.id : "~none", g ? g.title : "No goal", t);
    } else if (by === "channel") put(t.channel ?? "~none", t.channel ? ctx.label("channel", t.channel) : "No channel", t);
    else put(t.task_type, ctx.label("task_type", t.task_type), t);
  }
  return [...map.values()].sort((a, b) =>
    (a.key === "~none" ? 1 : 0) - (b.key === "~none" ? 1 : 0) || a.title.localeCompare(b.title));
}
