import { describe, expect, it } from "vitest";
import { EMPTY_TASK_IMPACT, type PlanItem, type Task, type TaskSession, type WorkDay } from "./api.ts";
import { buildDayRows, dailyCsv, hhmm, istMinutes, minutesOf, summarize, trend, vsBaseline } from "./ops.ts";

const day = (over: Partial<WorkDay>): WorkDay => ({
  id: "w", member_id: "nikita", day: "2026-10-26", planned_start: "10:00:00", planned_end: "18:00:00",
  checked_in_at: null, checked_out_at: null, plan_changed_by: null, plan_changed_at: null, ...over,
});
const block = (over: Partial<PlanItem>): PlanItem => ({
  id: "p", member_id: "nikita", day: "2026-10-26", task_id: "t1", title: null, starts_at: "11:00:00", ends_at: "12:00:00",
  suggested: false, accepted_at: null, created_by: "nikita", updated_by: null, removed_at: null, ...over,
});
const session = (over: Partial<TaskSession>): TaskSession => ({
  id: "s", member_id: "nikita", task_id: "t1", plan_item_id: null, day: "2026-10-26",
  started_at: "2026-10-26T05:40:00Z", ended_at: "2026-10-26T07:10:00Z", ended_by: "punch_out", note: null, ...over,
});
const task = (over: Partial<Task>): Task => ({
  ...EMPTY_TASK_IMPACT, id: "t1", ref: 1, title: "Script", brief: null, task_type: "content_development", work_origin: "planned", priority: null,
  status: "in_progress", owner_id: "nikita", reviewer_id: null, goal_id: null, counts_toward_goal: false, deliverable_format: null, channel: null,
  requester: null, due_date: null, estimated_minutes: null, completion_criteria: null, deliverable_url: null, blocker_reason: null,
  workflow_template_id: null, publish_date: null, opportunity_id: null, created_by: "tanvi", created_at: "2026-10-20T04:00:00Z", updated_at: "", completed_at: null, ...over,
} as Task);

describe("Daily Ops figures", () => {
  it("reads clock times in India time", () => {
    expect(minutesOf("10:30:00")).toBe(630);
    expect(hhmm(630)).toBe("10:30");
    expect(istMinutes("2026-10-26T04:45:00Z")).toBe(615); // 10:15 IST
  });

  // 26 Oct: planned 10:00–18:00, checked in 10:25 IST (25 min late), out 18:05; 1.5 h on t1 (planned), approved t1 late
  const days = [
    day({ checked_in_at: "2026-10-26T04:55:00Z", checked_out_at: "2026-10-26T12:35:00Z" }),
    day({ id: "w2", day: "2026-10-27", checked_in_at: "2026-10-27T04:30:00Z" }),          // forgot to check out
  ];
  const plan = [block({}), block({ id: "p2", task_id: null, title: "Team sync", starts_at: "16:00:00", ends_at: "16:30:00" }), block({ id: "p3", task_id: "t2", starts_at: "14:00:00", ends_at: "15:00:00" })];
  const sessions = [session({}), session({ id: "s2", day: "2026-10-27", started_at: "2026-10-27T05:00:00Z", ended_at: "2026-10-27T06:00:00Z" })];
  const tasks = [
    task({ status: "done", due_date: "2026-10-25", completed_at: "2026-10-26T11:00:00Z" }),
    task({ id: "t3", title: "Overdue", due_date: "2026-10-20" }),
    task({ id: "t4", title: "Saail's", owner_id: "saail", status: "done", completed_at: "2026-10-26T09:00:00Z" }),
  ];
  const rows = buildDayRows({ memberIds: ["nikita"], from: "2026-10-26", to: "2026-10-28", days, plan, sessions, tasks, today: "2026-10-28" });

  it("builds one row per worked or planned day, with hours, lateness and plan kept", () => {
    expect(rows.map((r) => r.day)).toEqual(["2026-10-26", "2026-10-27"]);
    const r = rows[0]!;
    expect(r.plannedMin).toBe(480);
    expect(Math.round(r.workedMs! / 60_000)).toBe(460);
    expect(r.lateStartMin).toBe(25);
    expect(Math.round(r.taskMs / 60_000)).toBe(90);
    expect(r.blocksWorked).toBe(1);
    expect(r.approved.map((t) => t.id)).toEqual(["t1"]);
    expect(r.approvedLate).toHaveLength(1);
    expect(rows[1]!.noCheckout).toBe(true);
    expect(rows[1]!.workedMs).toBeNull();
  });

  it("summarises a person: hours, focus, productivity, delays and workload", () => {
    const s = summarize("nikita", rows, tasks, "2026-10-28");
    expect(s.daysWorked).toBe(2);
    expect(s.workedH).toBe(7.7);
    expect(s.taskH).toBe(2.5);
    expect(s.approved).toBe(1);
    expect(s.approvedLate).toBe(1);
    expect(s.avgDaysLate).toBe(1);
    expect(s.lateStarts).toBe(1);
    expect(s.missingCheckouts).toBe(1);
    expect(s.adherencePct).toBe(50);           // 2 task blocks planned, 1 worked on
    expect(s.overdueNow).toBe(1);
    expect(s.perDay).toBe(1);
  });

  it("compares with the person's usual level and gives a daily trend", () => {
    expect(vsBaseline(1.2, 1)).toBe(20);
    expect(vsBaseline(1, null)).toBeNull();
    expect(trend("nikita", rows, "2026-10-26", "2026-10-28").map((x) => x.approved)).toEqual([1, 0, 0]);
  });

  it("exports a daily summary with names, not ids", () => {
    const csv = dailyCsv(rows, (id) => (id === "nikita" ? "Nikita" : id), (id) => (id === "t1" ? "Script" : id));
    expect(csv.rows[0]!.slice(0, 7)).toEqual(["2026-10-26", "Nikita", "10:00", 8, "10:25", "18:05", 7.7]);
    expect(csv.rows[0]![10]).toBe("Script");
  });
});
