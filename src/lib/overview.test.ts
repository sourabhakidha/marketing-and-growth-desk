import { describe, expect, it } from "vitest";
import { EMPTY_GOAL_OUTCOME, EMPTY_TASK_IMPACT, type Goal, type TaskWithStage } from "./api.ts";
import { ALL_TIME, resolveRange } from "./dateRange.ts";
import { buildOverview } from "./overview.ts";

type S = TaskWithStage["task_stages"][number];
const st = (owner: string, over: Partial<S> = {}): S => ({
  id: `s-${owner}`, position: 1, stage_code: "writing_scripting", is_optional: false, state: "active", owner_id: owner,
  picked_up_at: "2026-10-20T05:00:00Z", ready_at: "2026-10-20T04:00:00Z", revision_count: 0, ...over,
});
const task = (over: Partial<TaskWithStage> = {}): TaskWithStage => ({
  ...EMPTY_TASK_IMPACT,
  id: "t", ref: 1, title: "T", brief: null, task_type: "content_development", work_origin: "planned", priority: null, status: "in_progress",
  owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null, channel: null, requester: null,
  due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null, blocker_reason: null, workflow_template_id: null,
  publish_date: null, opportunity_id: null, created_by: "tanvi", created_at: "2026-10-20T04:00:00Z", updated_at: "", completed_at: null,
  task_stages: [], ...over,
});
const goal = (over: Partial<Goal> = {}): Goal => ({
  ...EMPTY_GOAL_OUTCOME, id: "g", ref: 1, title: "Marathi content", description: null, success_definition: null, owner_id: "tanvi",
  start_date: null, end_date: null, target_quantity: null, target_unit: null, progress_method: "task_checklist", manual_progress: null,
  status: "on_track", completion_note: null, created_at: "", ...over,
});
const today = "2026-10-26";
const now = new Date("2026-10-26T06:00:00Z");

describe("Workspace overview", () => {
  const d = task({ id: "d", kind: "deliverable", goal_id: "g", title: "5 scripts" });
  const blocked = task({ id: "b", parent_id: "d", title: "Script 2", status: "blocked", blocker_reason: "Waiting for doctor quote", task_stages: [st("saail")] });
  const late = task({ id: "l", parent_id: "d", title: "Script 3", due_date: "2026-10-24", task_stages: [st("nikita")] });
  const onTime = task({ id: "a", parent_id: "d", status: "done", due_date: "2026-10-25", completed_at: "2026-10-24T09:00:00Z" });
  const lateDone = task({ id: "z", status: "done", due_date: "2026-10-20", completed_at: "2026-10-22T09:00:00Z", owner_id: "saail" });
  const waiting = task({ id: "w", title: "Edit", task_stages: [st("tanvi", { picked_up_at: null, ready_at: "2026-10-22T04:00:00Z" })] });
  const all = [d, blocked, late, onTime, lateDone, waiting];
  const ov = buildOverview({ goals: [goal(), goal({ id: "g2", ref: 2, title: "Empty goal" })], tasks: all, today, range: ALL_TIME, meId: "nikita", scope: "team", now });

  it("counts open, overdue, blocked and approved work; deliverables are not counted as tasks", () => {
    expect(ov.counts.open).toBe(3);
    expect(ov.counts.overdue).toBe(1);
    expect(ov.counts.blocked).toBe(1);
    expect(ov.counts.done).toBe(2);
    expect(ov.counts.deliverables).toBe(1);
    expect(ov.onTimePct).toBe(50);
  });

  it("traces what is stuck up to its deliverable and goal", () => {
    const b = ov.chains.find((c) => c.task.id === "b")!;
    expect(b.kind).toBe("blocked");
    expect(b.deliverable?.id).toBe("d");
    expect(b.goal?.id).toBe("g");
    expect(ov.chains.find((c) => c.task.id === "l")?.kind).toBe("overdue");
    expect(ov.chains.find((c) => c.task.id === "w")?.kind).toBe("waiting");
  });

  it("counts open work with whoever holds its current step", () => {
    const saail = ov.people.find((p) => p.id === "saail")!;
    expect(saail.open).toBe(1);
    expect(saail.blocked).toBe(1);
    expect(saail.done).toBe(1);
    expect(saail.onTime).toBe(0);
    expect(ov.people.find((p) => p.id === "tanvi")?.open).toBe(1);
  });

  it("puts approvals in Monday weeks and writes plain-language insights", () => {
    expect(ov.weeks).toHaveLength(8);
    expect(ov.weeks.at(-1)!.start).toBe("2026-10-26");
    expect(ov.weeks.at(-2)!.done).toBe(2);
    const text = ov.insights.map((i) => i.text).join(" | ");
    expect(text).toMatch(/“Empty goal” has no deliverables or tasks yet/);
    expect(text).toMatch(/1 task is blocked, holding up deliverables/);
    expect(text).toMatch(/1 handover has waited 2\+ days/);
  });

  it("Me shows only my work and the goals it serves; period figures follow the date range", () => {
    const me = buildOverview({ goals: [goal(), goal({ id: "g2", ref: 2 })], tasks: all, today, range: ALL_TIME, meId: "saail", scope: "me", now });
    expect(me.hierarchy.goals.map((g) => g.goal.id)).toEqual(["g"]);
    expect(me.people.map((p) => p.id)).toEqual(["saail"]);
    const thisWeek = buildOverview({ goals: [], tasks: all, today, range: resolveRange("this_week", today), meId: "x", scope: "team", now });
    expect(thisWeek.counts.done).toBe(0);
  });
});
