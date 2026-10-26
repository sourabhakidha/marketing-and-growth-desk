import { describe, expect, it } from "vitest";
import { EMPTY_IMPACT_VALUES, planToTasks, type TaskFormValues, validateTask } from "./TaskForm.tsx";

const deliverable = (over: Partial<TaskFormValues> = {}): TaskFormValues => ({
  title: "5 Marathi images", task_type: "content_development", work_origin: "planned", owner_id: "tanvi", priority: "high", due_date: "2026-11-05",
  goal_id: "g", counts_toward_goal: false, brief: "", deliverable_format: "Static image", channel: "meta_ads", requester: "", estimate_hours: "",
  completion_criteria: "", reviewer_id: "", workflow_template_id: "", deliverable_url: "", publish_date: "2026-11-06",
  ...EMPTY_IMPACT_VALUES, impact_outcome: "More installs", kind: "deliverable", parent_id: "", production: "workflow",
  plan: [
    { code: "writing_scripting", on: true, owner_id: "nikita", due_date: "2026-11-01" },
    { code: "internal_review", on: false, owner_id: "tanvi", due_date: "" },
    { code: "asset_creation", on: true, owner_id: "saail", due_date: "2026-11-03" },
  ],
  ...over,
});

describe("workflow deliverable plan (D-045)", () => {
  it("makes one single-step task per ticked step, in order, each with its own owner and due date", () => {
    const ts = planToTasks(deliverable(), (c) => ({ writing_scripting: "Writing", asset_creation: "Design / Production" })[c] ?? c);
    expect(ts.map((t) => [t.title, t.owner_id, t.due_date, t.initial_stages])).toEqual([
      ["Writing — 5 Marathi images", "nikita", "2026-11-01", ["writing_scripting"]],
      ["Design / Production — 5 Marathi images", "saail", "2026-11-03", ["asset_creation"]],
    ]);
    expect(ts.map((t) => t.task_type)).toEqual(["content_development", "graphic_designing"]);
  });

  it("tasks inherit channel and priority, but not the goal, publish date or impact (those stay on the deliverable)", () => {
    const [t] = planToTasks(deliverable(), (c) => c);
    expect(t!.channel).toBe("meta_ads");
    expect(t!.priority).toBe("high");
    expect(t!.goal_id).toBeNull();
    expect(t!.publish_date).toBeNull();
    expect(t!.impact_outcome).toBeNull();
    expect(t!.kind).toBe("task");
  });

  it("a standalone deliverable makes no tasks; a workflow needs a ticked step with an owner", () => {
    expect(planToTasks(deliverable({ production: "standalone" }), (c) => c)).toEqual([]);
    expect(validateTask(deliverable({ plan: [{ code: "writing_scripting", on: false, owner_id: "x", due_date: "" }] }))).toMatch(/Tick at least one step/);
    expect(validateTask(deliverable({ plan: [{ code: "writing_scripting", on: true, owner_id: "", due_date: "" }] }))).toMatch(/who does each/);
  });
});
