import { useState } from "react";
import { fetchAll, useLookups } from "../lib/api.ts";
import { downloadCsv, toCsv, type CsvValue } from "../lib/csv.ts";
import { goalRef, minutesBetween, taskRef, todayInIndia } from "../lib/format.ts";
import { ErrorText } from "../components/Form.tsx";

type ExportKey = "tasks" | "goals" | "workflow" | "events" | "audit";

const EXPORTS: { key: ExportKey; title: string; description: string }[] = [
  { key: "tasks", title: "Tasks", description: "One row per task: type, origin, status, priority, owner, due date, goal, workflow, current stage, timestamps, link." },
  { key: "goals", title: "Goals", description: "Goal, owner, timeframe, progress method, target, linked/approved counts, progress, status." },
  { key: "workflow", title: "Workflow history", description: "One row per task stage: owner, entered / ready / picked-up / completed times, wait and stage minutes, revisions." },
  { key: "events", title: "Task events", description: "Every hand-off, pick-up, return, block, approval and comment, with actor and time." },
  { key: "audit", title: "Activity log (audit)", description: "Every recorded data change across Marketing Desk: actor, entity, old and new values." },
];

/** CSV exports built from the same shared records everyone sees (Bible §17.1). Timestamps are ISO 8601 UTC. */
export function Exports() {
  const { memberName, label } = useLookups();
  const [busy, setBusy] = useState<ExportKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const day = todayInIndia();

  async function run(key: ExportKey) {
    setBusy(key);
    setError(null);
    try {
      let columns: string[] = [];
      let rows: CsvValue[][] = [];
      if (key === "tasks" || key === "workflow") {
        const [tasks, stages, goals] = await Promise.all([fetchAll.tasks(), fetchAll.stages(), fetchAll.goals()]);
        const taskById = new Map(tasks.map((t) => [t.id, t]));
        if (key === "tasks") {
          columns = ["task_ref", "task_id", "title", "task_type", "work_origin", "status", "priority", "owner", "reviewer",
            "due_date", "goal_ref", "goal_id", "counts_toward_goal", "workflow_current_stage", "estimated_minutes",
            "deliverable_format", "channel", "requester", "deliverable_url", "blocker_reason", "created_by", "created_at", "updated_at", "approved_at"];
          rows = tasks.map((t) => {
            const cur = stages.find((s) => s.task_id === t.id && s.state === "active");
            const g = goals.find((x) => x.id === t.goal_id);
            return [taskRef(t.ref), t.id, t.title, label("task_type", t.task_type), label("work_origin", t.work_origin),
              label("task_status", t.status), t.priority ? label("priority", t.priority) : null, memberName(t.owner_id),
              t.reviewer_id ? memberName(t.reviewer_id) : null, t.due_date, g ? goalRef(g.ref) : null, t.goal_id,
              t.counts_toward_goal, cur ? label("workflow_stage", cur.stage_code) : null, t.estimated_minutes,
              t.deliverable_format, t.channel, t.requester, t.deliverable_url, t.blocker_reason, memberName(t.created_by),
              t.created_at, t.updated_at, t.completed_at];
          });
        } else {
          columns = ["task_ref", "task_id", "stage_id", "position", "stage", "state", "optional", "stage_owner",
            "entered_at", "ready_at", "picked_up_at", "completed_at", "wait_minutes", "stage_minutes", "revision_count"];
          rows = stages.map((s) => {
            const t = taskById.get(s.task_id);
            return [t ? taskRef(t.ref) : null, s.task_id, s.id, s.position, label("workflow_stage", s.stage_code), s.state,
              s.is_optional, s.owner_id ? memberName(s.owner_id) : null, s.entered_at, s.ready_at, s.picked_up_at,
              s.completed_at, minutesBetween(s.ready_at, s.picked_up_at), minutesBetween(s.entered_at, s.completed_at), s.revision_count];
          });
        }
      } else if (key === "goals") {
        const [goals, progress] = await Promise.all([fetchAll.goals(), fetchAll.goalProgress()]);
        columns = ["goal_ref", "goal_id", "title", "success_definition", "owner", "start_date", "end_date", "progress_method",
          "target_quantity", "target_unit", "linked_tasks", "approved_tasks", "accepted_deliverables", "progress_pct", "status", "completion_note", "created_at"];
        rows = goals.map((g) => {
          const p = progress.find((x) => x.goal_id === g.id);
          return [goalRef(g.ref), g.id, g.title, g.success_definition, memberName(g.owner_id), g.start_date, g.end_date,
            g.progress_method, g.target_quantity, g.target_unit, p?.linked_tasks ?? 0, p?.done_tasks ?? 0,
            p?.accepted_deliverables ?? 0, p?.progress_pct ?? null, label("goal_status", g.status), g.completion_note, g.created_at];
        });
      } else if (key === "events") {
        const [events, tasks] = await Promise.all([fetchAll.taskEvents(), fetchAll.tasks()]);
        const taskById = new Map(tasks.map((t) => [t.id, t]));
        columns = ["event_id", "occurred_at", "task_ref", "task_id", "event_type", "stage", "actor", "from_owner", "to_owner", "from_value", "to_value", "note", "source"];
        rows = events.map((e) => {
          const t = taskById.get(e.task_id);
          return [e.id, e.occurred_at, t ? taskRef(t.ref) : null, e.task_id, e.event_type, e.stage_code,
            e.actor_id ? memberName(e.actor_id) : "System", e.from_owner_id ? memberName(e.from_owner_id) : null,
            e.to_owner_id ? memberName(e.to_owner_id) : null, e.from_value, e.to_value, e.note, e.source];
        });
      } else {
        const audit = await fetchAll.auditEvents();
        columns = ["event_id", "occurred_at", "actor_user_id", "source", "entity_type", "entity_id", "event_type", "old_value", "new_value", "details"];
        rows = audit.map((a) => [a.id, a.occurred_at, a.actor_user_id, a.source, a.entity_type, a.entity_id, a.event_type,
          a.old_value == null ? null : JSON.stringify(a.old_value), a.new_value == null ? null : JSON.stringify(a.new_value),
          a.details == null ? null : JSON.stringify(a.details)]);
      }
      downloadCsv(`marketing-desk-${key}-${day}.csv`, toCsv(columns, rows));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="muted">CSV files open in Excel or Google Sheets. Text is UTF-8 (Hindi and Marathi display correctly), timestamps are UTC, and cells that could run as spreadsheet formulas are neutralised. Missing values are left blank, never filled with zero.</p>
      <ErrorText error={error} />
      <div className="export-grid">
        {EXPORTS.map((x) => (
          <section key={x.key} className="card">
            <h2>{x.title}</h2>
            <p className="muted small">{x.description}</p>
            <button type="button" className="button" disabled={busy !== null} onClick={() => run(x.key)}>
              {busy === x.key ? "Preparing…" : "Download CSV"}
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
