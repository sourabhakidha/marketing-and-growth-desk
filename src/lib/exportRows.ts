// CSV layouts shared by the Exports page and every section's Export button,
// so a file has the same columns wherever it was downloaded from.
// Timestamps stay ISO 8601 UTC; missing values stay blank, never zero.
import type { AiDraft, AuditEvent, Goal, GoalProgress, Learning, Opportunity, RadarSignal, Task, TaskEvent, TaskStage } from "./api.ts";
import type { CsvValue } from "./csv.ts";
import { goalRef, minutesBetween, taskRef } from "./format.ts";

export interface CsvTable { columns: string[]; rows: CsvValue[][] }
export interface Lookups {
  memberName: (id: string | null | undefined) => string;
  label: (vocabulary: string, code: string | null | undefined) => string;
}

const person = (lk: Lookups, id: string | null | undefined) => (id ? lk.memberName(id) : null);

export function taskTable(tasks: Task[], currentStage: (taskId: string) => string | null, goals: Goal[], lk: Lookups): CsvTable {
  return {
    columns: ["task_ref", "task_id", "title", "task_type", "work_origin", "status", "priority", "owner", "reviewer",
      "due_date", "publish_date", "opportunity_id", "goal_ref", "goal_id", "counts_toward_goal", "workflow_current_stage", "estimated_minutes",
      "deliverable_format", "channel", "requester", "deliverable_url", "blocker_reason", "created_by", "created_at", "updated_at", "approved_at",
      "impact_outcome", "impact_rationale", "impact_audience_channel", "impact_success_metrics", "impact_evidence", "impact_dependencies", "impact_risks",
      "kind", "part_of_ref"],
    rows: tasks.map((t) => {
      const parent = t.parent_id ? tasks.find((x) => x.id === t.parent_id) : undefined;
      const cur = currentStage(t.id);
      const g = goals.find((x) => x.id === t.goal_id);
      return [taskRef(t.ref), t.id, t.title, lk.label("task_type", t.task_type), lk.label("work_origin", t.work_origin),
        lk.label("task_status", t.status), t.priority ? lk.label("priority", t.priority) : null, lk.memberName(t.owner_id),
        person(lk, t.reviewer_id), t.due_date, t.publish_date, t.opportunity_id, g ? goalRef(g.ref) : null, t.goal_id,
        t.counts_toward_goal, cur ? lk.label("workflow_stage", cur) : null, t.estimated_minutes,
        t.deliverable_format, t.channel ? lk.label("channel", t.channel) : null, t.requester, t.deliverable_url, t.blocker_reason, lk.memberName(t.created_by),
        t.created_at, t.updated_at, t.completed_at,
        t.impact_outcome, t.impact_rationale, t.impact_audience, t.impact_metrics, t.impact_evidence, t.impact_dependencies, t.impact_risks,
        t.kind ?? "task", parent ? taskRef(parent.ref) : (t.parent_id ?? null)];
    }),
  };
}

export function stageTable(stages: TaskStage[], tasks: Task[], lk: Lookups): CsvTable {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    columns: ["task_ref", "task_id", "stage_id", "position", "stage", "state", "optional", "stage_owner",
      "entered_at", "ready_at", "picked_up_at", "completed_at", "wait_minutes", "stage_minutes", "revision_count"],
    rows: stages.map((s) => {
      const t = byId.get(s.task_id);
      return [t ? taskRef(t.ref) : null, s.task_id, s.id, s.position, lk.label("workflow_stage", s.stage_code), s.state,
        s.is_optional, person(lk, s.owner_id), s.entered_at, s.ready_at, s.picked_up_at,
        s.completed_at, minutesBetween(s.ready_at, s.picked_up_at), minutesBetween(s.entered_at, s.completed_at), s.revision_count];
    }),
  };
}

export function goalTable(goals: Goal[], progress: GoalProgress[], lk: Lookups): CsvTable {
  return {
    columns: ["goal_ref", "goal_id", "title", "success_definition", "owner", "start_date", "end_date", "progress_method",
      "target_quantity", "target_unit", "linked_tasks", "approved_tasks", "accepted_deliverables", "task_progress_pct", "status", "completion_note", "created_at",
      "business_outcome", "business_rationale", "success_measures", "importance", "outcome_kind", "outcome_metric", "outcome_baseline",
      "outcome_target", "outcome_unit", "outcome_status", "outcome_actual", "outcome_evidence", "outcome_assessed_at", "outcome_assessed_by", "channel"],
    rows: goals.map((g) => {
      const p = progress.find((x) => x.goal_id === g.id);
      return [goalRef(g.ref), g.id, g.title, g.success_definition, lk.memberName(g.owner_id), g.start_date, g.end_date,
        g.progress_method, g.target_quantity, g.target_unit, p?.linked_tasks ?? 0, p?.done_tasks ?? 0,
        p?.accepted_deliverables ?? 0, p?.progress_pct ?? null, lk.label("goal_status", g.status), g.completion_note, g.created_at,
        g.outcome_statement, g.outcome_rationale, g.success_measures, g.importance, g.outcome_kind, g.outcome_metric, g.outcome_baseline,
        g.outcome_target, g.outcome_unit, g.outcome_status, g.outcome_actual, g.outcome_evidence, g.outcome_assessed_at, person(lk, g.outcome_assessed_by),
        g.channel ? lk.label("channel", g.channel) : null];
    }),
  };
}

export function eventTable(events: TaskEvent[], tasks: Task[], lk: Lookups): CsvTable {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    columns: ["event_id", "occurred_at", "task_ref", "task_id", "task_title", "event_type", "stage", "actor", "from_owner", "to_owner", "from_value", "to_value", "note", "source"],
    rows: events.map((e) => {
      const t = byId.get(e.task_id);
      return [e.id, e.occurred_at, t ? taskRef(t.ref) : null, e.task_id, t?.title ?? null, e.event_type, e.stage_code,
        e.actor_id ? lk.memberName(e.actor_id) : "System", person(lk, e.from_owner_id), person(lk, e.to_owner_id),
        e.from_value, e.to_value, e.note, e.source];
    }),
  };
}

export function auditTable(audit: AuditEvent[]): CsvTable {
  const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
  return {
    columns: ["event_id", "occurred_at", "actor_user_id", "source", "entity_type", "entity_id", "event_type", "old_value", "new_value", "details"],
    rows: audit.map((a) => [a.id, a.occurred_at, a.actor_user_id, a.source, a.entity_type, a.entity_id, a.event_type,
      json(a.old_value), json(a.new_value), json(a.details)]),
  };
}

export function signalTable(signals: RadarSignal[]): CsvTable {
  return {
    columns: ["signal_ref", "signal_id", "source_type", "source_name", "publisher", "url", "title", "published_at", "collected_at", "topics", "region", "evidence_class", "status", "notes", "excerpt"],
    rows: signals.map((s) => [`S-${s.ref}`, s.id, s.source_type, s.source_name, s.publisher, s.url, s.title, s.published_at, s.collected_at,
      s.topic_tags.join("; "), s.region, s.evidence_class, s.status, s.notes, s.excerpt]),
  };
}

export function opportunityTable(opps: Opportunity[], links: { opportunity_id: string; signal_id: string }[], lk: Lookups): CsvTable {
  return {
    columns: ["opportunity_ref", "opportunity_id", "title", "linked_signal_ids", "audience", "audience_tension", "strategic_rationale", "content_angle",
      "suggested_format", "objective", "proof_checks", "priority", "scores", "status", "decided_by", "decided_at", "decision_note", "next_action", "created_by", "created_at"],
    rows: opps.map((o) => [`O-${o.ref}`, o.id, o.title, links.filter((l) => l.opportunity_id === o.id).map((l) => l.signal_id).join("; "),
      o.audience, o.audience_tension, o.strategic_rationale, o.content_angle, o.suggested_format, o.objective, o.proof_checks, o.priority,
      Object.keys(o.scores ?? {}).length ? JSON.stringify(o.scores) : null, o.status, person(lk, o.decided_by), o.decided_at,
      o.decision_note, o.next_action, lk.memberName(o.created_by), o.created_at]),
  };
}

export function learningTable(ls: Learning[], lk: Lookups): CsvTable {
  return {
    columns: ["learning_ref", "learning_id", "title", "class", "task_id", "goal_id", "opportunity_id", "observation", "period_start", "period_end", "evidence",
      "interpretation", "confidence", "limitations", "next_test", "owner", "review_date", "status", "decided_by", "decided_at", "decision_note", "created_by", "created_at"],
    rows: ls.map((l) => [`L-${l.ref}`, l.id, l.title, l.learning_class, l.task_id, l.goal_id, l.opportunity_id, l.observation, l.period_start, l.period_end,
      l.evidence, l.interpretation, l.confidence, l.limitations, l.next_test, person(lk, l.owner_id), l.review_date, l.status,
      person(lk, l.decided_by), l.decided_at, l.decision_note, lk.memberName(l.created_by), l.created_at]),
  };
}

export function draftTable(ds: AiDraft[], lk: Lookups): CsvTable {
  return {
    columns: ["draft_ref", "draft_id", "kind", "task_id", "opportunity_id", "language", "format", "duration", "instructions", "status", "model",
      "prompt_tokens", "completion_tokens", "claims_requiring_review", "review_flags", "decision_note", "decided_at", "error", "created_by", "created_at"],
    rows: ds.map((d) => [`D-${d.ref}`, d.id, d.kind, d.task_id, d.opportunity_id, d.language, d.format, d.duration, d.instructions, d.status, d.model,
      d.prompt_tokens, d.completion_tokens, d.output?.claims_requiring_review.join("; ") ?? null, d.output?.review_flags?.join("; ") ?? null,
      d.decision_note, d.decided_at, d.error, lk.memberName(d.created_by), d.created_at]),
  };
}
