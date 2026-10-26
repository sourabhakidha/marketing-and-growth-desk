import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type TaskWithStage } from "../lib/api.ts";
import { groupTasks, phaseOf, stageProgress, stageStep } from "./phases.ts";

type S = TaskWithStage["task_stages"][number];
const st = (position: number, stage_code: string, state: S["state"], over: Partial<S> = {}): S => ({
  id: `s${position}`, position, stage_code, is_optional: false, state, owner_id: "nikita", picked_up_at: null, ready_at: null, revision_count: 0, ...over,
});
const task = (over: Partial<TaskWithStage> = {}): TaskWithStage => ({
  ...EMPTY_TASK_IMPACT,
  id: "t1", ref: 1, title: "Script", brief: null, task_type: "content_development", work_origin: "planned", priority: null,
  status: "in_progress", owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null,
  channel: null, requester: null, due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null,
  blocker_reason: null, workflow_template_id: "w", publish_date: null, opportunity_id: null, created_by: "tanvi",
  created_at: "", updated_at: "", completed_at: null,
  task_stages: [st(1, "brief_intake", "done"), st(2, "writing_scripting", "active", { picked_up_at: "x" }), st(3, "internal_review", "pending"), st(4, "revisions", "skipped")],
  ...over,
});
const admins = (id: string | null | undefined) => id === "tanvi";

describe("phases", () => {
  it("maps statuses and stages to five plain phases", () => {
    expect(phaseOf(task({ status: "requested" }), admins)).toBe("requested");
    expect(phaseOf(task({ status: "not_started", task_stages: [st(1, "brief_intake", "active")] }), admins)).toBe("todo");
    expect(phaseOf(task(), admins)).toBe("doing");
    expect(phaseOf(task({ status: "blocked" }), admins)).toBe("doing");
    expect(phaseOf(task({ status: "in_review" }), admins)).toBe("review");
    expect(phaseOf(task({ task_stages: [st(1, "internal_review", "active", { owner_id: "tanvi" })] }), admins)).toBe("review");
    expect(phaseOf(task({ status: "done" }), admins)).toBe("done");
    expect(phaseOf(task({ status: "cancelled" }), admins)).toBeNull();
  });
  it("shows the stage as a step among the stages the task actually runs", () => {
    expect(stageStep(task())).toEqual({ code: "writing_scripting", step: 2, of: 3 });
    expect(stageProgress(task())).toBe(33);
    expect(stageProgress(task({ status: "done" }))).toBe(100);
  });
});

describe("grouping", () => {
  const label = (_: string, c: string | null | undefined) => c ?? "";
  const d = task({ id: "d", ref: 9, title: "Marathi video", kind: "deliverable", task_stages: [] });
  const part = task({ id: "p", ref: 10, parent_id: "d" });
  const solo = task({ id: "s", ref: 11 });
  it("puts parts under their deliverable, keeps empty deliverables, and lists standalone work last", () => {
    const empty = task({ id: "e", ref: 12, title: "Empty", kind: "deliverable", task_stages: [] });
    const groups = groupTasks([part, solo], "deliverable", { all: [d, part, solo, empty], goals: [], label, memberName: (x) => x ?? "", deliverables: [d, empty] });
    expect(groups.map((g) => g.title)).toEqual(["Empty", "Marathi video", "Standalone tasks"]);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual(["p"]);
  });
  it("groups by owner or channel with a 'none' bucket", () => {
    const g = groupTasks([solo, task({ id: "x", channel: "meta_ads" })], "channel", { all: [], goals: [], label, memberName: (x) => x ?? "" });
    expect(g.map((x) => x.title)).toEqual(["meta_ads", "No channel"]);
  });
});
