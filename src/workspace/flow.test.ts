import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type Opportunity, type Task, type TaskEvent, type TaskStage, type WorkflowTemplate } from "../lib/api.ts";
import { decisionWaits, eventsByTask, flowByGoal, flowByType, ideaToExecution, slowestStage, stagesByTask } from "./flow.ts";

const stage = (over: Partial<TaskStage>): TaskStage => ({
  id: "s1", task_id: "t1", position: 1, stage_code: "brief_intake", is_optional: false, owner_id: "nikita", state: "done",
  entered_at: "2026-10-01T10:00:00Z", ready_at: "2026-10-01T10:00:00Z", picked_up_at: "2026-10-01T11:00:00Z",
  completed_at: "2026-10-01T13:00:00Z", revision_count: 0, ...over,
});
const task = (over: Partial<Task> = {}): Task => ({ ...EMPTY_TASK_IMPACT,
  id: "t1", ref: 1, title: "Script", brief: null, task_type: "content_development", work_origin: "planned", priority: null,
  status: "done", owner_id: "nikita", reviewer_id: null, goal_id: "g1", counts_toward_goal: false, deliverable_format: null,
  channel: null, requester: null, due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null,
  blocker_reason: null, workflow_template_id: "w", publish_date: "2026-10-04", opportunity_id: "o1", created_by: "tanvi",
  created_at: "2026-10-01T09:00:00Z", updated_at: "", completed_at: "2026-10-02T09:00:00Z", ...over,
});
const ev = (id: number, event_type: string, occurred_at: string): TaskEvent => ({
  id, task_id: "t1", task_stage_id: null, stage_code: null, event_type, actor_id: null, from_owner_id: null, to_owner_id: null,
  from_value: null, to_value: null, note: null, source: "user", occurred_at,
});
const template: WorkflowTemplate = {
  id: "w", code: "script_copy", name: "Script or copy", description: null, default_for_task_type: "content_development", sort_order: 1, is_active: true,
  workflow_template_stages: [
    { id: "a", position: 1, stage_code: "brief_intake", is_optional: false },
    { id: "b", position: 2, stage_code: "writing_scripting", is_optional: false },
    { id: "c", position: 3, stage_code: "revisions", is_optional: true },
  ],
};
const stages = [
  stage({}),
  stage({ id: "s2", position: 2, stage_code: "writing_scripting", ready_at: "2026-10-01T13:00:00Z", entered_at: "2026-10-01T13:00:00Z",
    picked_up_at: "2026-10-01T17:00:00Z", completed_at: "2026-10-02T01:00:00Z", revision_count: 1 }),
  stage({ id: "s3", position: 3, stage_code: "revisions", state: "skipped", picked_up_at: null }),
];
const events = [
  ev(3, "approved", "2026-10-02T09:00:00Z"), ev(1, "submitted_for_approval", "2026-10-02T01:00:00Z"),
  ev(2, "changes_requested", "2026-10-02T03:00:00Z"), ev(4, "submitted_for_approval", "2026-10-02T05:00:00Z"),
];

describe("flow by task type", () => {
  const rows = flowByType([task()], stagesByTask(stages), eventsByTask(events), [template], ["content_development", "editing"]);
  const row = rows[0]!;
  it("separates start wait, hand-off wait and stage time from recorded timestamps", () => {
    expect(rows).toHaveLength(1); // types with no tasks and no default workflow are left out
    expect(row.cycles).toEqual([1440]);
    expect(row.startWaits).toEqual([60]);
    expect(row.handoffWaits).toEqual([240]);
    expect(row.cells.get("writing_scripting")!.totals).toEqual([720]);
    expect(row.cells.get("writing_scripting")!.works).toEqual([480]);
    expect(row.reworked).toBe(1);
  });
  it("keeps skipped stages in the workflow map but out of the timings", () => {
    const rev = row.cells.get("revisions")!;
    expect(rev.inWorkflow).toBe(true);
    expect(rev.used).toBe(0);
    expect(rev.totals).toEqual([]);
  });
  it("names the slowest stage", () => expect(slowestStage(row)).toEqual({ stage: "writing_scripting", minutes: 720 }));
});

describe("approval waits", () => {
  it("pairs each decision with the submission before it, in time order", () => {
    expect(decisionWaits(eventsByTask(events).get("t1")!)).toEqual([120, 240]);
  });
});

describe("idea to execution", () => {
  const opp = { id: "o1", status: "converted", created_at: "2026-09-30T09:00:00Z", decided_at: "2026-09-30T21:00:00Z" } as Opportunity;
  const flow = ideaToExecution({
    opportunities: [opp], links: [{ opportunity_id: "o1", signal_id: "x", linked_at: "", radar_signals: { collected_at: "2026-09-30T06:00:00Z" } }],
    tasks: [task()], stages: stagesByTask(stages), events: eventsByTask(events),
  });
  it("has one lag per gap between steps", () => expect(flow.lags).toHaveLength(flow.steps.length - 1));
  it("measures each hop and the end-to-end lead time", () => {
    const lag = (l: string) => flow.lags.find((x) => x.label === l)!.values;
    expect(lag("signal → idea")).toEqual([180]);
    expect(lag("idea → decision")).toEqual([720]);
    expect(lag("approval → task")).toEqual([720]);
    expect(lag("created → picked up")).toEqual([120]);
    expect(lag("picked up → submitted")).toEqual([840]);
    expect(lag("approval → publish date")).toEqual([2 * 1440]);
    expect(flow.leadTimes).toEqual([(2 * 24 + 3) * 60]);
  });
  it("records nothing, not zero, when a step has no timestamp", () => {
    const empty = ideaToExecution({ opportunities: [{ ...opp, decided_at: null }], links: [], tasks: [], stages: new Map(), events: new Map() });
    expect(empty.lags.find((x) => x.label === "idea → decision")!.values).toEqual([]);
  });
});

describe("flow by goal", () => {
  it("shows where a goal's open work sits", () => {
    const open = task({ id: "t2", status: "in_progress", completed_at: null });
    const [g] = flowByGoal([{ id: "g1" } as never], [task(), open],
      stagesByTask([stage({ id: "x", task_id: "t2", state: "active", stage_code: "internal_review" })]), "2026-10-01T10:00:00Z");
    expect(g!.open).toBe(1);
    expect(g!.done).toBe(1);
    expect([...g!.openByStage]).toEqual([["internal_review", 1]]);
    expect(g!.oldestOpenMinutes).toBe(60);
  });
});
