import type { Config } from "@netlify/functions";
import { requireMember } from "../lib/auth.ts";
import { callModel } from "../lib/ai.ts";
import { aiConfig } from "../lib/env.ts";
import { briefMessages, briefSpec, collectRefs, goalMessages, goalSpec, taskMessages, taskSpec } from "../lib/impact.ts";

// Background function: fills in a queued impact_assessments row (D-030).
// Runs AS the requesting member (RLS applies); the AI key never leaves the server.
// The result is a proposal shown next to the task/goal — it changes nothing else.
const MAX_BRIEF_INPUT = 60_000;

const TASK_FIELDS = "id, ref, title, brief, task_type, work_origin, status, priority, due_date, publish_date, estimated_minutes, "
  + "deliverable_format, channel, completion_criteria, blocker_reason, goal_id, opportunity_id, "
  + "impact_outcome, impact_rationale, impact_audience, impact_metrics, impact_evidence, impact_dependencies, impact_risks";
const GOAL_FIELDS = "id, ref, title, description, success_definition, start_date, end_date, status, progress_method, target_quantity, target_unit, "
  + "outcome_statement, outcome_rationale, success_measures, importance, outcome_kind, outcome_metric, outcome_baseline, outcome_target, "
  + "outcome_unit, outcome_status, outcome_actual, outcome_evidence";

type Row = Record<string, unknown>;
const tRef = (r: Row) => `T-${r.ref}`;
const gRef = (r: Row) => `G-${r.ref}`;

export default async (req: Request) => {
  let me: Awaited<ReturnType<typeof requireMember>>;
  try {
    me = await requireMember(req);
  } catch {
    return;
  }
  const { assessmentId } = (await req.json().catch(() => ({}))) as { assessmentId?: string };
  if (!assessmentId) return;

  const fail = (message: string) => me.db.from("impact_assessments")
    .update({ status: "failed", error: message.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", assessmentId);

  const { data: a } = await me.db.from("impact_assessments")
    .select("id, subject, task_id, goal_id, period_kind, period_from, period_to, input, status, created_by")
    .eq("id", assessmentId).maybeSingle();
  if (!a || a.created_by !== me.memberId || a.status !== "queued") return;

  const cfg = aiConfig();
  if (!cfg) { await fail("AI is not configured: add GEMINI_API_KEY (or OPENAI_API_KEY + OPENAI_MODEL) in Netlify, then redeploy."); return; }

  try {
    await me.db.from("impact_assessments").update({ status: "running" }).eq("id", assessmentId);
    let result: { output: unknown; model: string; promptTokens: number | null; completionTokens: number | null };

    if (a.subject === "task") {
      const task = (await me.db.from("tasks").select(TASK_FIELDS).eq("id", a.task_id).maybeSingle()).data as unknown as Row | null;
      if (!task) throw new Error("Task not found");
      const stage = (await me.db.from("task_stages").select("stage_code, owner_id").eq("task_id", task.id as string).eq("state", "active").maybeSingle()).data;
      const goal = task.goal_id ? (await me.db.from("goals").select(GOAL_FIELDS).eq("id", task.goal_id as string).maybeSingle()).data as unknown as Row | null : null;
      const siblings = goal ? ((await me.db.from("tasks").select("ref, title, status, impact_outcome").eq("goal_id", goal.id as string).neq("id", task.id as string).limit(20)).data ?? []) as unknown as Row[] : [];
      const opp = task.opportunity_id
        ? (await me.db.from("opportunities").select("ref, title, objective, strategic_rationale, audience, audience_tension").eq("id", task.opportunity_id as string).maybeSingle()).data
        : null;
      const input = {
        task: { ref: tRef(task), ...task, id: undefined, goal_id: undefined, opportunity_id: undefined, current_stage: stage?.stage_code ?? null },
        linked_goal: goal ? { ref: gRef(goal), ...goal, id: undefined, other_linked_tasks: siblings.map((s) => ({ ref: tRef(s), title: s.title, status: s.status, impact_outcome: s.impact_outcome })) } : null,
        source_opportunity: opp,
        note: task.goal_id ? undefined : "This task is standalone (no linked goal). That is allowed.",
      };
      result = await callModel(taskMessages(input), cfg, undefined, taskSpec());
    } else if (a.subject === "goal") {
      const goal = (await me.db.from("goals").select(GOAL_FIELDS).eq("id", a.goal_id).maybeSingle()).data as unknown as Row | null;
      if (!goal) throw new Error("Goal not found");
      const progress = (await me.db.from("goal_progress").select("linked_tasks, done_tasks, accepted_deliverables, progress_pct").eq("goal_id", goal.id as string).maybeSingle()).data;
      const tasks = ((await me.db.from("tasks").select(TASK_FIELDS).eq("goal_id", goal.id as string).neq("status", "cancelled").order("ref").limit(40)).data ?? []) as unknown as Row[];
      const ids = tasks.map((t) => t.id as string);
      const stages = ids.length ? ((await me.db.from("task_stages").select("task_id, stage_code").in("task_id", ids).eq("state", "active")).data ?? []) as unknown as Row[] : [];
      const prior = ids.length ? ((await me.db.from("impact_assessments").select("task_id, output, created_at").in("task_id", ids).eq("status", "ready").order("created_at", { ascending: false })).data ?? []) as unknown as Row[] : [];
      const latest = (id: string) => (prior.find((p) => p.task_id === id)?.output ?? null) as Row | null;
      const input = {
        goal: { ref: gRef(goal), ...goal, id: undefined },
        task_completion_progress: progress
          ? { ...progress, note: "This is task-completion progress from the goal's progress method. It is NOT business-outcome achievement." }
          : null,
        linked_tasks: tasks.map((t) => {
          const prev = latest(t.id as string);
          return {
            ref: tRef(t), title: t.title, task_type: t.task_type, status: t.status, priority: t.priority, due_date: t.due_date,
            estimated_minutes: t.estimated_minutes, blocker_reason: t.blocker_reason, current_stage: stages.find((s) => s.task_id === t.id)?.stage_code ?? null,
            impact_outcome: t.impact_outcome, impact_rationale: t.impact_rationale, impact_metrics: t.impact_metrics,
            impact_evidence: t.impact_evidence, impact_dependencies: t.impact_dependencies, impact_risks: t.impact_risks,
            prior_ai_assessment: prev ? {
              expected_impact: (prev.expected_impact as Row | undefined)?.rating, goal_contribution: (prev.goal_contribution as Row | undefined)?.rating,
            } : null,
          };
        }),
      };
      result = await callModel(goalMessages(input), cfg, undefined, goalSpec(tasks.map(tRef)));
    } else {
      const text = JSON.stringify(a.input ?? {});
      if (text.length > MAX_BRIEF_INPUT) throw new Error("Too much data for one brief. Choose a shorter period.");
      const input = { period: { kind: a.period_kind, from: a.period_from, to: a.period_to }, ...(a.input as object) };
      result = await callModel(briefMessages(input), cfg, undefined, briefSpec(collectRefs(a.input)));
    }

    await me.db.from("impact_assessments").update({
      status: "ready",
      output: result.output,
      model: result.model,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      completed_at: new Date().toISOString(),
    }).eq("id", assessmentId);
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Assessment failed");
  }
};

export const config: Config = { path: "/api/impact-assess", method: ["POST"], background: true };
