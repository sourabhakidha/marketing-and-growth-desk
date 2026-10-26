import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type Task, type TaskEvent, type TaskStage } from "./api.ts";
import { buildJourney } from "./journey.ts";

const task = (over: Partial<Task> = {}): Task => ({
  ...EMPTY_TASK_IMPACT,
  id: "t", ref: 1, title: "T", brief: null, task_type: "content_development", work_origin: "planned", priority: null, status: "in_progress",
  owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null, channel: null, requester: null,
  due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null, blocker_reason: null, workflow_template_id: null,
  publish_date: null, opportunity_id: null, created_by: "tanvi", created_at: "2026-10-20T04:00:00Z", updated_at: "", completed_at: null, ...over,
} as Task);
const stage = (task_id: string, code: string, over: Partial<TaskStage> = {}): TaskStage => ({
  id: `s-${task_id}`, task_id, position: 1, stage_code: code, is_optional: false, owner_id: "nikita", state: "active",
  entered_at: "2026-10-20T04:00:00Z", ready_at: "2026-10-20T04:00:00Z", picked_up_at: null, completed_at: null, revision_count: 0, ...over,
});
let n = 0;
const ev = (task_id: string, event_type: string, at: string): TaskEvent => ({
  id: ++n, task_id, task_stage_id: null, stage_code: null, event_type, actor_id: "tanvi", from_owner_id: null, to_owner_id: null,
  from_value: null, to_value: null, note: null, source: "app", occurred_at: at,
});
const ORDER = ["ideation_research", "writing_scripting", "asset_creation", "internal_review"];
const rank = (c: string) => ORDER.indexOf(c);
const now = new Date("2026-10-26T06:00:00Z");

describe("deliverable journey", () => {
  const d = task({ id: "d", kind: "deliverable", title: "5 scripts", due_date: "2026-10-25", status: "done", completed_at: "2026-10-26T05:00:00Z" });
  // writing: picked up after 1 h, submitted day 2, changes asked, approved day 3 (due day 3)
  const write = task({ id: "w", parent_id: "d", title: "Writing", status: "done", due_date: "2026-10-23", completed_at: "2026-10-23T08:00:00Z" });
  // design: exists from the start, but writing finished on the 23rd; picked up 2 days later; approved late
  const design = task({ id: "g", parent_id: "d", title: "Design", owner_id: "saail", status: "done", due_date: "2026-10-24", completed_at: "2026-10-26T04:00:00Z" });
  const stages = [
    stage("w", "writing_scripting", { state: "done", picked_up_at: "2026-10-20T05:00:00Z", completed_at: "2026-10-23T08:00:00Z" }),
    stage("g", "asset_creation", { owner_id: "saail", state: "done", picked_up_at: "2026-10-25T08:00:00Z", completed_at: "2026-10-26T04:00:00Z" }),
  ];
  const events = [
    ev("w", "submitted_for_approval", "2026-10-21T10:00:00Z"), ev("w", "changes_requested", "2026-10-22T10:00:00Z"),
    ev("w", "submitted_for_approval", "2026-10-23T06:00:00Z"), ev("w", "approved", "2026-10-23T08:00:00Z"),
    ev("g", "submitted_for_approval", "2026-10-26T02:00:00Z"), ev("g", "approved", "2026-10-26T04:00:00Z"),
  ];
  const j = buildJourney({ deliverable: d, parts: [design, write], stages, events, stepRank: rank, stepLabel: (c) => c, now });

  it("orders the steps and measures the hand-over between them", () => {
    expect(j.mode).toBe("workflow");
    expect(j.columns.map((c) => c.step)).toEqual(["writing_scripting", "asset_creation"]);
    expect(Math.round(j.handovers[0]!.gapMs / 3_600_000)).toBe(48);   // writing approved 23rd 08:00 → design picked up 25th 08:00
  });

  it("counts waiting from when the previous step finished, and review from submission to decision", () => {
    const g = j.tasks.find((x) => x.task.id === "g")!;
    expect(Math.round(g.waitMs / 3_600_000)).toBe(48);   // writing approved 23rd 08:00 → picked up 25th 08:00
    const w = j.tasks.find((x) => x.task.id === "w")!;
    expect(Math.round(w.reviewMs / 3_600_000)).toBe(26);  // 24 h + 2 h in review
    expect(w.rework).toBe(1);
    expect(w.daysLate).toBe(0);
    expect(g.daysLate).toBe(2);
  });

  it("explains what went well and where time was lost, and the deliverable's result", () => {
    expect(j.verdict).toEqual({ tone: "bad", text: "Delivered 1 day after its date" });
    const lost = j.lostTime.map((p) => p.text).join(" | ");
    expect(lost).toMatch(/“Design” was approved 2 days late/);
    expect(lost).toMatch(/“Design” waited 2 days before anyone picked it up/);
    expect(lost).toMatch(/“Writing” needed 1 round of changes/);
    const well = j.wentWell.map((p) => p.text).join(" | ");
    expect(well).toMatch(/“Writing” was picked up within 1 hour/);
    expect(well).toMatch(/“Design” was approved first time/);
  });

  it("splits the work by person", () => {
    expect(j.people.map((p) => p.id).sort()).toEqual(["nikita", "saail"]);
    expect(j.people.find((p) => p.id === "saail")!.late).toBe(1);
  });

  it("a deliverable with no tasks is standalone: the deliverable itself is the work", () => {
    const solo = task({ id: "s", kind: "deliverable", title: "Banner", due_date: "2026-10-30" });
    const sj = buildJourney({ deliverable: solo, parts: [], stages: [], events: [], stepRank: rank, stepLabel: (c) => c, now });
    expect(sj.mode).toBe("standalone");
    expect(sj.tasks.map((x) => x.task.id)).toEqual(["s"]);
    expect(sj.verdict.text).toBe("Open, 4 days left");
  });
});
