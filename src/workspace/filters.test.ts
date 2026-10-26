import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type TaskWithStage } from "../lib/api.ts";
import { matchesFilters, EMPTY_FILTERS } from "./filters.ts";

type S = TaskWithStage["task_stages"][number];
const st = (position: number, stage_code: string, state: S["state"], over: Partial<S> = {}): S => ({
  id: `s${position}`, position, stage_code, is_optional: false, state, owner_id: state === "pending" ? null : "nikita",
  picked_up_at: state === "active" ? "2026-10-23T05:00:00Z" : null, ready_at: "2026-10-23T04:00:00Z", revision_count: 0, ...over,
});
const task = (over: Partial<TaskWithStage> = {}): TaskWithStage => ({ ...EMPTY_TASK_IMPACT,
  id: "t1", ref: 1, title: "Write script", brief: null, task_type: "content_development", work_origin: "planned", priority: "high",
  status: "in_progress", owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null,
  channel: null, requester: null, due_date: "2026-10-27", estimated_minutes: null, completion_criteria: null, deliverable_url: null,
  blocker_reason: null, workflow_template_id: "w", publish_date: null, opportunity_id: null, created_by: "tanvi",
  created_at: "", updated_at: "", completed_at: null,
  task_stages: [st(1, "brief_intake", "done"), st(2, "writing_scripting", "active"), st(3, "internal_review", "pending"),
    st(4, "revisions", "pending", { is_optional: true }), st(5, "approval", "pending")],
  ...over,
});

describe("workspace filters", () => {
  const ctx = { meId: "saail", today: "2026-10-24" };
  it("hides cancelled by default, shows done; 'active' hides both", () => {
    expect(matchesFilters(task({ status: "cancelled" }), EMPTY_FILTERS, ctx)).toBe(false);
    expect(matchesFilters(task({ status: "done" }), EMPTY_FILTERS, ctx)).toBe(true);
    expect(matchesFilters(task({ status: "done" }), { ...EMPTY_FILTERS, status: "active" }, ctx)).toBe(false);
  });
  it("owner matches task owner or current stage owner; my work likewise", () => {
    const t = task({ owner_id: "tanvi" });
    expect(matchesFilters(t, { ...EMPTY_FILTERS, owner: "nikita" }, ctx)).toBe(true);
    expect(matchesFilters(t, { ...EMPTY_FILTERS, mine: true }, ctx)).toBe(false);
  });
  it("due buckets use the India calendar day and ignore closed work for overdue", () => {
    expect(matchesFilters(task({ due_date: "2026-10-20" }), { ...EMPTY_FILTERS, due: "overdue" }, ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: "2026-10-20", status: "done" }), { ...EMPTY_FILTERS, due: "overdue" }, ctx)).toBe(false);
    expect(matchesFilters(task({ due_date: "2026-10-30" }), { ...EMPTY_FILTERS, due: "week" }, ctx)).toBe(true);
    expect(matchesFilters(task({ due_date: null }), { ...EMPTY_FILTERS, due: "none" }, ctx)).toBe(true);
  });
  it("goal filter supports 'no goal'", () => {
    expect(matchesFilters(task({ goal_id: "g1" }), { ...EMPTY_FILTERS, goal: "none" }, ctx)).toBe(false);
    expect(matchesFilters(task({ goal_id: "g1" }), { ...EMPTY_FILTERS, goal: "g1" }, ctx)).toBe(true);
  });
});


describe("task date range filter", () => {
  const ctx = { meId: "nikita", today: "2026-10-25" };
  const lastWeek = { ...EMPTY_FILTERS, range: "last_week" };
  const t = (over: Partial<TaskWithStage>) => task({ created_at: "2026-10-14T06:00:00Z", status: "done", completed_at: "2026-10-21T06:00:00Z", ...over });
  it("filters by created date by default", () => {
    expect(matchesFilters(t({}), lastWeek, ctx)).toBe(true);
    expect(matchesFilters(t({ created_at: "2026-10-20T06:00:00Z" }), lastWeek, ctx)).toBe(false);
  });
  it("can use approval date or 'open during the period' instead", () => {
    expect(matchesFilters(t({}), { ...lastWeek, on: "approved" }, ctx)).toBe(false);
    expect(matchesFilters(t({}), { ...lastWeek, range: "this_week", on: "approved" }, ctx)).toBe(true);
    expect(matchesFilters(t({ created_at: "2026-10-01T06:00:00Z" }), { ...lastWeek, on: "open" }, ctx)).toBe(true);
    expect(matchesFilters(t({ created_at: "2026-10-01T06:00:00Z", completed_at: "2026-10-05T06:00:00Z" }), { ...lastWeek, on: "open" }, ctx)).toBe(false);
  });
});

describe("Team / Me switch", () => {
  it("'Me' keeps only my tasks", () => {
    const ctx = { meId: "saail", today: "2026-10-25" };
    expect(matchesFilters(task(), EMPTY_FILTERS, { ...ctx, scope: "me" })).toBe(false);
    expect(matchesFilters(task(), EMPTY_FILTERS, { ...ctx, scope: "team" })).toBe(true);
    expect(matchesFilters(task({ owner_id: "saail" }), EMPTY_FILTERS, { ...ctx, scope: "me" })).toBe(true);
  });
});

describe("goal filter for tasks inside a deliverable (audit fix)", () => {
  const d = task({ id: "d", kind: "deliverable", goal_id: "g1" });
  const inside = task({ id: "p", parent_id: "d", goal_id: null });
  const ctx = { meId: "saail", today: "2026-10-24", all: [d, inside] };
  it("a task with no goal of its own serves its deliverable's goal", () => {
    expect(matchesFilters(inside, { ...EMPTY_FILTERS, goal: "g1" }, ctx)).toBe(true);
    expect(matchesFilters(inside, { ...EMPTY_FILTERS, goal: "none" }, ctx)).toBe(false);
    expect(matchesFilters(inside, { ...EMPTY_FILTERS, goal: "g2" }, ctx)).toBe(false);
  });
});
