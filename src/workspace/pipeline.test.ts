import { describe, expect, it } from "vitest";
import type { TaskWithStage } from "../lib/api.ts";
import { matchesFilters, EMPTY_FILTERS } from "./filters.ts";
import { buildPipeline, checkDrop, columnOf, DONE_COLUMN, nextStage, nextStepOwner } from "./pipeline.ts";

const codes = ["brief_intake", "writing_scripting", "internal_review", "revisions", "approval", "completed"];
type S = TaskWithStage["task_stages"][number];
const st = (position: number, stage_code: string, state: S["state"], over: Partial<S> = {}): S => ({
  id: `s${position}`, position, stage_code, is_optional: false, state, owner_id: state === "pending" ? null : "nikita",
  picked_up_at: state === "active" ? "2026-10-23T05:00:00Z" : null, ready_at: "2026-10-23T04:00:00Z", revision_count: 0, ...over,
});
const task = (over: Partial<TaskWithStage> = {}): TaskWithStage => ({
  id: "t1", ref: 1, title: "Write script", brief: null, task_type: "content_development", work_origin: "planned", priority: "high",
  status: "in_progress", owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null,
  channel: null, requester: null, due_date: "2026-10-27", estimated_minutes: null, completion_criteria: null, deliverable_url: null,
  blocker_reason: null, workflow_template_id: "w", publish_date: null, opportunity_id: null, created_by: "tanvi",
  created_at: "", updated_at: "", completed_at: null,
  task_stages: [st(1, "brief_intake", "done"), st(2, "writing_scripting", "active"), st(3, "internal_review", "pending"),
    st(4, "revisions", "pending", { is_optional: true }), st(5, "approval", "pending")],
  ...over,
});
const label = (c: string) => c;
const nikita = { id: "nikita", isAdmin: false };
const saail = { id: "saail", isAdmin: false };
const admin = { id: "tanvi", isAdmin: true };

describe("pipeline columns", () => {
  it("places tasks by current stage, done work at the end, never hides unknown stages", () => {
    const done = task({ id: "t2", ref: 2, status: "done", task_stages: task().task_stages.map((s) => ({ ...s, state: "done" as const })) });
    const odd = task({ id: "t3", ref: 3, task_stages: [st(1, "legacy_stage", "active")] });
    const cols = buildPipeline([task(), done, odd], codes);
    expect(cols.map((c) => c.code)).toEqual(["brief_intake", "writing_scripting", "internal_review", "revisions", "approval", "legacy_stage", DONE_COLUMN]);
    expect(cols.find((c) => c.code === "writing_scripting")!.tasks).toHaveLength(1);
    expect(columnOf(done)).toBe(DONE_COLUMN);
  });
  it("keeps a blocked task in its stage and counts waiting from recorded pick-up only", () => {
    const blocked = task({ status: "blocked", blocker_reason: "No footage" });
    const waiting = task({ id: "t4", ref: 4, task_stages: [st(1, "brief_intake", "active", { picked_up_at: null })] });
    const cols = buildPipeline([blocked, waiting], codes);
    expect(cols.find((c) => c.code === "writing_scripting")!.blocked).toBe(1);
    expect(cols.find((c) => c.code === "writing_scripting")!.waiting).toBe(0);
    expect(cols.find((c) => c.code === "brief_intake")!.waiting).toBe(1);
  });
  it("names who owns the next step", () => {
    expect(nextStepOwner(task())).toBe("nikita");
    expect(nextStepOwner(task({ status: "in_review" }))).toBeNull();
  });
});

describe("drag and drop follows the workflow engine", () => {
  it("allows only the next pending stage, for someone who can hand off", () => {
    const r = checkDrop(task(), "internal_review", nikita, label);
    expect(r.ok).toBe(true);
    expect(nextStage(task())!.stage_code).toBe("internal_review");
    expect(checkDrop(task(), "internal_review", admin, label).ok).toBe(true);
  });
  it("refuses people who cannot act on the task", () => {
    const r = checkDrop(task(), "internal_review", saail, label);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/owner, the current stage owner or an admin/) });
  });
  it("refuses skipping ahead, going back, Done, and blocked / in-review / closed tasks", () => {
    expect(checkDrop(task(), "approval", nikita, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/one stage at a time/) });
    expect(checkDrop(task(), "brief_intake", nikita, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/Return for rework/) });
    expect(checkDrop(task(), DONE_COLUMN, admin, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/admin approval/) });
    expect(checkDrop(task({ status: "blocked" }), "internal_review", admin, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/Unblock/) });
    expect(checkDrop(task({ status: "in_review" }), "internal_review", admin, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/waiting for approval/) });
    expect(checkDrop(task({ status: "done" }), "internal_review", admin, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/Reopen/) });
    expect(checkDrop(task(), "editing_assembly", nikita, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/not part of this task's workflow/) });
  });
  it("mentions an optional next stage can be skipped in the panel", () => {
    const t = task({ task_stages: [st(1, "writing_scripting", "active"), st(2, "revisions", "pending", { is_optional: true }), st(3, "approval", "pending")] });
    expect(checkDrop(t, "approval", nikita, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/optional/) });
  });
  it("on the last stage, points to Submit for approval", () => {
    const t = task({ task_stages: [st(1, "approval", "active")] });
    expect(checkDrop(t, "brief_intake", nikita, label)).toMatchObject({ ok: false, reason: expect.stringMatching(/last stage/) });
  });
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
