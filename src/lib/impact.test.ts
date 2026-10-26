import { describe, expect, it } from "vitest";
import { EMPTY_GOAL_OUTCOME, EMPTY_TASK_IMPACT, type Goal, type ImpactAssessment, type Task } from "./api.ts";
import { resolveRange } from "./dateRange.ts";
import { goalRollup, missingImpact, outcomePct, periodBrief, rankTasks } from "./impact.ts";

const today = "2026-10-25";
const task = (over: Partial<Task> = {}): Task => ({
  ...EMPTY_TASK_IMPACT,
  id: "t1", ref: 1, title: "Script", brief: null, task_type: "content_development", work_origin: "planned", priority: null,
  status: "in_progress", owner_id: "nikita", reviewer_id: null, goal_id: "g1", counts_toward_goal: false, deliverable_format: null,
  channel: null, requester: null, due_date: null, estimated_minutes: 120, completion_criteria: null, deliverable_url: null,
  blocker_reason: null, workflow_template_id: null, publish_date: null, opportunity_id: null, created_by: "tanvi",
  created_at: "2026-10-20T06:00:00Z", updated_at: "2026-10-20T06:00:00Z", completed_at: null, ...over,
});
const goal = (over: Partial<Goal> = {}): Goal => ({
  ...EMPTY_GOAL_OUTCOME,
  id: "g1", ref: 1, title: "More caregiver installs", description: null, success_definition: null, owner_id: "tanvi",
  start_date: "2026-10-01", end_date: "2026-12-31", target_quantity: null, target_unit: null, progress_method: "task_checklist",
  manual_progress: null, status: "on_track", completion_note: null, created_at: "2026-10-01T06:00:00Z",
  outcome_statement: "Grow caregiver installs", outcome_rationale: "Caregivers drive refills", success_measures: "Installs / week", ...over,
});
const assessment = (taskId: string, output: object, created_at = "2026-10-21T06:00:00Z"): ImpactAssessment => ({
  id: `a-${taskId}-${created_at}`, ref: 1, subject: "task", task_id: taskId, goal_id: null, period_kind: null, period_from: null, period_to: null,
  status: "ready", output: output as Record<string, unknown>, model: "m", error: null, created_by: "tanvi", created_at, completed_at: created_at,
});
const rated = (rating: string, reasoning = "because") => ({ rating, reasoning });

describe("impact case", () => {
  it("names the missing parts of a task's impact case", () => {
    expect(missingImpact(task({ impact_outcome: "x", impact_evidence: "hypothesis" }))).toEqual(["rationale", "audience / channel", "success metrics"]);
  });
});

describe("goal roll-up", () => {
  it("keeps task completion apart from outcome achievement", () => {
    const g = goal({ outcome_kind: "measurable", outcome_metric: "installs", outcome_baseline: 100, outcome_target: 300, outcome_actual: 150 });
    const r = goalRollup(g, [task({ status: "done", completed_at: "2026-10-22T06:00:00Z" })], { goal_id: "g1", linked_tasks: 1, done_tasks: 1, accepted_deliverables: 0, progress_pct: 100 }, [], today);
    expect(r.taskCompletionPct).toBe(100);
    expect(r.outcomePct).toBe(25);
    expect(r.flags).toContain("tasks_done_outcome_open");
  });
  it("has no outcome percentage without recorded measurable values", () => {
    expect(outcomePct(goal())).toBeNull();
    expect(outcomePct(goal({ outcome_kind: "measurable", outcome_metric: "m", outcome_target: 10 }))).toBeNull();
  });
  it("flags important outcomes with no supporting work", () => {
    expect(goalRollup(goal({ importance: "critical" }), [], undefined, [], today).flags).toContain("important_without_work");
    expect(goalRollup(goal({ importance: "low" }), [], undefined, [], today).flags).toContain("no_supporting_work");
  });
  it("flags overloaded goals, unclear contributors, missing impact cases and blocked work", () => {
    const many = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, ref: i + 1 }));
    const blocked = task({ id: "tb", ref: 50, status: "blocked", blocker_reason: "No footage" });
    const r = goalRollup(goal(), [...many, blocked], undefined,
      [assessment("t0", { expected_impact: rated("high"), goal_contribution: rated("unclear"), recommended_action: rated("clarify") })], today);
    expect(r.flags).toEqual(expect.arrayContaining(["overloaded", "unclear_contributors", "tasks_missing_impact", "blocked_work"]));
    expect(r.impact.high).toBe(1);
    expect(r.impact.unassessed).toBe(8);
    expect(r.risks.some((x) => x.text.includes("No footage"))).toBe(true);
  });
  it("uses the newest finished assessment", () => {
    const r = goalRollup(goal(), [task()], undefined, [
      assessment("t1", { expected_impact: rated("low"), goal_contribution: rated("direct"), recommended_action: rated("proceed") }, "2026-10-20T06:00:00Z"),
      assessment("t1", { expected_impact: rated("high"), goal_contribution: rated("direct"), recommended_action: rated("proceed") }, "2026-10-22T06:00:00Z"),
    ], today);
    expect(r.impact.high).toBe(1);
    expect(r.impact.low).toBe(0);
  });
});

describe("ranking and period brief", () => {
  it("ranks with reasons and never invents an AI rating", () => {
    const g = goal({ importance: "high" });
    const ranked = rankTasks([task({ id: "a", ref: 1 }), task({ id: "b", ref: 2, goal_id: null, priority: "low" })], [g], []);
    expect(ranked[0]!.ref).toBe("T-1");
    expect(ranked[0]!.reasons).toContain("Not assessed by AI yet");
    expect(ranked[1]!.reasons).toContain("Standalone task");
  });
  it("summarises the period: capacity per goal and person, neglected goals, low-impact work, actions", () => {
    const week = resolveRange("this_week", today);
    const t1 = task({ id: "a", ref: 1, impact_outcome: "o", impact_rationale: "r", impact_audience: "a", impact_metrics: "m", impact_evidence: "historical" });
    const t2 = task({ id: "b", ref: 2, goal_id: null, owner_id: "saail", estimated_minutes: 60 });
    const empty = goal({ id: "g2", ref: 2, importance: "high", title: "Retention" });
    const b = periodBrief({
      range: week, today, tasks: [t1, t2], goals: [goal(), empty], progress: [],
      assessments: [assessment("b", { expected_impact: rated("low", "Small audience"), goal_contribution: rated("no_goal"), recommended_action: rated("deprioritise") })],
      activityTaskIds: new Set(["a"]), memberName: (id) => id,
    });
    expect(b.activeTasks).toHaveLength(2);
    expect(b.byGoal.find((r) => r.key === "none")!.openHours).toBe(1);
    expect(b.byPerson.map((p) => p.label)).toEqual(["nikita", "saail"]);
    expect(b.lowImpact.map((x) => x.ref)).toEqual(["T-2"]);
    expect(b.neglectedGoals.map((x) => x.ref)).toEqual(["G-2"]);
    expect(b.actions[0]!.action).toMatch(/Plan and assign work for “Retention”/);
  });
});
