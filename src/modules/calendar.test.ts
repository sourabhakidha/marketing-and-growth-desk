import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type Goal, type Task } from "../lib/api.ts";
import { buildEntries, overloads } from "./Calendar.tsx";

const task = (over: Partial<Task>): Task => ({ ...EMPTY_TASK_IMPACT,
  id: "t", ref: 1, title: "T", brief: null, task_type: "editing", work_origin: "planned", priority: null, status: "in_progress",
  owner_id: "a", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null, channel: null, requester: null,
  due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null, blocker_reason: null,
  workflow_template_id: null, publish_date: null, opportunity_id: null, created_by: "a", created_at: "", updated_at: "", completed_at: null, ...over,
});

describe("calendar entries", () => {
  it("derives due, publish and goal entries from the records", () => {
    const goal = { id: "g", ref: 2, title: "G", owner_id: "b", start_date: "2026-11-01", end_date: "2026-11-07", status: "on_track" } as Goal;
    const e = buildEntries([task({ due_date: "2026-11-03", publish_date: "2026-11-05" })], [goal], false);
    expect(e.map((x) => x.kind)).toEqual(["goal_start", "due", "publish", "goal_end"]);
    expect(e[1]!.href).toBe("/workspace/tasks/1");
  });
  it("hides closed work unless asked", () => {
    const closed = task({ due_date: "2026-11-03", status: "done" });
    expect(buildEntries([closed], [], false)).toHaveLength(0);
    expect(buildEntries([closed], [], true)).toHaveLength(1);
  });
  it("flags a person with 3+ open tasks due the same day", () => {
    const e = buildEntries([1, 2, 3].map((i) => task({ id: `t${i}`, ref: i, due_date: "2026-11-03" })), [], false);
    expect(overloads(e).get("2026-11-03")).toEqual(["a"]);
    expect(overloads(e.slice(0, 2)).size).toBe(0);
  });
});
