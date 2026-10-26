import { describe, expect, it } from "vitest";
import { isMyGoal, isMyTask } from "./scope.tsx";

describe("Team / Me: what counts as mine", () => {
  const t = { owner_id: "saail", created_by: "tanvi", reviewer_id: null, task_stages: [{ owner_id: "saail" }, { owner_id: "nikita" }] };
  it("owner, creator/requester, reviewer, or anyone who holds or held a stage", () => {
    expect(isMyTask(t, "saail")).toBe(true);
    expect(isMyTask(t, "tanvi")).toBe(true);
    expect(isMyTask(t, "nikita")).toBe(true);
    expect(isMyTask({ ...t, reviewer_id: "sourabh" }, "sourabh")).toBe(true);
    expect(isMyTask(t, "sourabh")).toBe(false);
  });
  it("a goal is mine if I own it or one of my tasks is linked to it", () => {
    expect(isMyGoal({ id: "g1", owner_id: "tanvi" }, new Set(["g1"]), "nikita")).toBe(true);
    expect(isMyGoal({ id: "g2", owner_id: "tanvi" }, new Set(["g1"]), "nikita")).toBe(false);
  });
});
