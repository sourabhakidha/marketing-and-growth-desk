import { describe, expect, it } from "vitest";
import { EMPTY_GOAL_OUTCOME, EMPTY_TASK_IMPACT, type Goal, type TaskWithStage } from "./api.ts";
import { buildHierarchy, columnOf, DONE_COL, stepColumns } from "./hierarchy.ts";

type S = TaskWithStage["task_stages"][number];
const st = (position: number, stage_code: string, state: S["state"]): S => ({
  id: `s${position}${stage_code}`, position, stage_code, is_optional: false, state, owner_id: "nikita", picked_up_at: null, ready_at: null, revision_count: 0,
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
  ...EMPTY_GOAL_OUTCOME, id: "g", ref: 1, title: "Generate more Marathi content", description: null, success_definition: null, owner_id: "tanvi",
  start_date: null, end_date: null, target_quantity: null, target_unit: null, progress_method: "task_checklist", manual_progress: null,
  status: "on_track", completion_note: null, created_at: "", ...over,
});
const today = "2026-10-26";

describe("Goal → Deliverable → Task", () => {
  const scripts = task({ id: "d1", kind: "deliverable", goal_id: "g", title: "5 Marathi video scripts" });
  const images = task({ id: "d2", kind: "deliverable", goal_id: "g", title: "5 Marathi images", status: "done" });
  const loose = task({ id: "x", title: "Monthly report" });
  const direct = task({ id: "y", goal_id: "g", title: "Old task linked to the goal" });
  const parts = [task({ id: "a", parent_id: "d1", status: "done" }), task({ id: "b", parent_id: "d1" }), task({ id: "c", parent_id: "d1", status: "cancelled" })];
  const h = buildHierarchy([goal()], [scripts, images, loose, direct, ...parts], today);

  it("nests deliverables under goals and tasks under deliverables; cancelled work is hidden", () => {
    const g = h.goals[0]!;
    expect(g.deliverables.map((x) => x.d.id)).toEqual(["d1", "d2"]);
    expect(g.deliverables[0]!.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(g.directTasks.map((t) => t.id)).toEqual(["y"]);
    expect(h.looseTasks.map((t) => t.id)).toEqual(["x"]);
  });
  it("rolls progress up: tasks → deliverable → goal", () => {
    const g = h.goals[0]!;
    expect(g.deliverables[0]!.pct).toBe(50);
    expect(g.deliverables[1]!.pct).toBe(100);
    expect(g.pct).toBe(75);
    expect([g.doneDeliverables, g.totalDeliverables]).toEqual([1, 2]);
  });
  it("a goal with no deliverables has no progress yet, not zero", () => {
    expect(buildHierarchy([goal({ id: "g2" })], [], today).goals[0]!.pct).toBeNull();
  });
});

describe("step columns", () => {
  const order = (c: string) => ["ideation_research", "writing_scripting", "internal_review", "asset_creation", "revisions"].indexOf(c);
  it("uses only the steps a deliverable's tasks run, then Done", () => {
    const write = task({ id: "w", task_stages: [st(1, "ideation_research", "done"), st(2, "writing_scripting", "active"), st(3, "internal_review", "pending")] });
    const standalone = task({ id: "s", task_stages: [st(1, "asset_creation", "active")] });
    const done = task({ id: "d", status: "done", task_stages: [st(1, "writing_scripting", "done")] });
    const cols = stepColumns([write, standalone, done], order);
    expect(cols.map((c) => c.code)).toEqual(["ideation_research", "writing_scripting", "internal_review", "asset_creation", DONE_COL]);
    expect(cols.find((c) => c.code === "writing_scripting")!.tasks.map((t) => t.id)).toEqual(["w"]);
    expect(cols.find((c) => c.code === "asset_creation")!.tasks.map((t) => t.id)).toEqual(["s"]);
    expect(cols.at(-1)!.tasks.map((t) => t.id)).toEqual(["d"]);
  });
  it("a request or not-started task sits at its first step; skipped steps are not columns", () => {
    expect(columnOf(task({ status: "requested", task_stages: [st(1, "revisions", "skipped"), st(2, "asset_creation", "pending")] }))).toBe("asset_creation");
  });
});

describe("cancelled work on request (audit fix)", () => {
  const live = task({ id: "d1", kind: "deliverable", goal_id: "g", status: "done" });
  const dropped = task({ id: "d2", kind: "deliverable", goal_id: "g", status: "cancelled" });
  it("shows cancelled deliverables only when asked, and never counts them toward progress", () => {
    expect(buildHierarchy([goal()], [live, dropped], today).goals[0]!.deliverables.map((n) => n.d.id)).toEqual(["d1"]);
    const all = buildHierarchy([goal()], [live, dropped], today, true).goals[0]!;
    expect(all.deliverables.map((n) => n.d.id)).toEqual(["d1", "d2"]);
    expect(all.pct).toBe(100);
    expect(all.totalDeliverables).toBe(1);
  });
});
