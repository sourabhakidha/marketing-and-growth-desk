import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type Task, type TaskStage } from "./api.ts";
import { at, buildTimeline, rollup } from "./deliverables.ts";

const today = "2026-10-26";
const task = (over: Partial<Task> = {}): Task => ({
  ...EMPTY_TASK_IMPACT,
  id: "t", ref: 1, title: "T", brief: null, task_type: "editing", work_origin: "planned", priority: null, status: "in_progress",
  owner_id: "saail", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null, channel: "meta_ads",
  requester: null, due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null, blocker_reason: null,
  workflow_template_id: null, publish_date: null, opportunity_id: null, created_by: "tanvi", created_at: "2026-10-20T04:00:00Z",
  updated_at: "", completed_at: null, ...over,
});
const d = task({ id: "d", ref: 10, kind: "deliverable", publish_date: "2026-10-30", title: "Marathi video" });

describe("deliverable roll-up", () => {
  it("progress counts done parts; cancelled parts don't count", () => {
    const r = rollup(d, [task({ id: "a", status: "done" }), task({ id: "b" }), task({ id: "c", status: "cancelled" })], today);
    expect(r.pct).toBe(50);
    expect(r.risk).toBe("on_track");
  });
  it("blocked beats at-risk; at-risk explains why; next = the open part due first", () => {
    const parts = [task({ id: "a", ref: 2, due_date: "2026-10-31" }), task({ id: "b", ref: 3, due_date: "2026-10-28" })];
    const late = rollup(d, parts, today);
    expect(late.risk).toBe("at_risk");
    expect(late.reasons.join(" ")).toMatch(/due after the deliverable/);
    expect(late.next!.id).toBe("b");
    expect(rollup(d, [...parts, task({ id: "x", status: "blocked" })], today).risk).toBe("blocked");
    expect(rollup(d, [], today).risk).toBe("no_parts");
  });
});

describe("journey timeline", () => {
  const st = (over: Partial<TaskStage>): TaskStage => ({
    id: "s", task_id: "a", position: 1, stage_code: "editing_assembly", is_optional: false, owner_id: "saail", state: "done",
    entered_at: "2026-10-21T04:00:00Z", ready_at: "2026-10-21T04:00:00Z", picked_up_at: "2026-10-21T08:00:00Z",
    completed_at: "2026-10-22T04:00:00Z", revision_count: 0, ...over,
  });
  it("draws waiting and working from recorded times only; skips stages never entered", () => {
    const tl = buildTimeline(d, [task({ id: "a" })], [st({}), st({ id: "p", position: 2, state: "pending", entered_at: null })], new Date("2026-10-26T04:00:00Z"));
    const segs = tl.rows[0]!.segments;
    expect(segs.map((s) => s.kind)).toEqual(["wait", "work"]);
    expect(segs[0]!.end).toBe(Date.parse("2026-10-21T08:00:00Z"));
    expect(at(tl, tl.start)).toBe(0);
    expect(at(tl, tl.end)).toBe(100);
  });
  it("an active stage runs to now", () => {
    const now = new Date("2026-10-26T04:00:00Z");
    const tl = buildTimeline(d, [task({ id: "a" })], [st({ state: "active", completed_at: null })], now);
    expect(tl.rows[0]!.segments.at(-1)!.end).toBe(now.getTime());
    expect(tl.rows[0]!.segments.at(-1)!.open).toBe(true);
  });
});
