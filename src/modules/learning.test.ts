import { describe, expect, it } from "vitest";
import type { TaskStage } from "../lib/api.ts";
import { median, stageStats } from "./Learning.tsx";

const stage = (over: Partial<TaskStage>): TaskStage => ({
  id: "s", task_id: "t", position: 1, stage_code: "internal_review", is_optional: false, owner_id: null, state: "done",
  entered_at: "2026-10-01T10:00:00Z", ready_at: "2026-10-01T10:00:00Z", picked_up_at: "2026-10-01T12:00:00Z",
  completed_at: "2026-10-01T13:00:00Z", revision_count: 0, ...over,
});

describe("process insights", () => {
  it("computes medians from recorded timestamps only", () => {
    const stats = stageStats([
      stage({}),
      stage({ id: "b", picked_up_at: "2026-10-01T14:00:00Z", completed_at: "2026-10-01T15:00:00Z", revision_count: 1 }),
      stage({ id: "c", picked_up_at: null, state: "active", completed_at: null }),
      stage({ id: "d", state: "pending" }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.total).toBe(3);
    expect(stats[0]!.waits).toEqual([120, 240]);
    expect(median(stats[0]!.waits)).toBe(180);
    expect(stats[0]!.revisions).toBe(1);
  });
  it("returns null, not zero, for no data", () => expect(median([])).toBeNull());
});
