import { useState } from "react";
import { fetchAll, fetchAllExtra, useLookups } from "../lib/api.ts";
import { downloadCsv, toCsv } from "../lib/csv.ts";
import { inRange, overlaps, rangeLabel, rangeSlug } from "../lib/dateRange.ts";
import {
  auditTable, type CsvTable, draftTable, eventTable, goalTable, learningTable, opportunityTable, signalTable, stageTable, taskTable,
} from "../lib/exportRows.ts";
import { todayInIndia } from "../lib/format.ts";
import { ErrorText } from "../components/Form.tsx";
import { DateRangePicker, useDateRange } from "../components/DateRange.tsx";
import { useMember } from "../lib/session.tsx";
import { isMyTask, useScope } from "../lib/scope.tsx";
import type { Task, TaskStage } from "../lib/api.ts";

type ExportKey = "tasks" | "goals" | "workflow" | "events" | "audit" | "radar" | "opportunities" | "learnings" | "drafts";

const EXPORTS: { key: ExportKey; title: string; description: string; period: string }[] = [
  { key: "tasks", title: "Tasks", period: "created in the period",
    description: "One row per task: type, origin, status, priority, owner, due date, goal, workflow, current stage, timestamps, link." },
  { key: "goals", title: "Goals", period: "active during the period (no dates = always active)",
    description: "Goal, owner, timeframe, progress method, target, linked/approved counts, progress, status." },
  { key: "workflow", title: "Workflow history", period: "stage started in the period",
    description: "One row per task stage: owner, entered / ready / picked-up / completed times, wait and stage minutes, revisions." },
  { key: "events", title: "Task events", period: "happened in the period",
    description: "Every hand-off, pick-up, return, block, approval and comment, with actor and time." },
  { key: "audit", title: "Activity log (audit)", period: "happened in the period",
    description: "Every recorded data change across Marketing Desk: actor, entity, old and new values." },
  { key: "radar", title: "Radar signals", period: "collected in the period",
    description: "Signal ID, source, URL, published and collected time, topics, region, evidence class, status, note." },
  { key: "opportunities", title: "Opportunities", period: "created in the period",
    description: "ID, title, linked signal IDs, audience need, rationale, angle, format, objective, priority, score, decision, next action." },
  { key: "learnings", title: "Learnings", period: "recorded in the period",
    description: "ID, linked records, observation, period, evidence, interpretation, confidence, limitations, next test, review state." },
  { key: "drafts", title: "AI drafts", period: "created in the period",
    description: "Draft ID, kind, linked task/opportunity, request, model, status, decision, claims flagged for review." },
];

/** CSV exports built from the same shared records everyone sees (Bible §17.1). Timestamps are ISO 8601 UTC. */
export function Exports() {
  const lk = useLookups();
  const dates = useDateRange();
  const r = dates.range;
  const { member: me } = useMember();
  const { isMe } = useScope();
  const [busy, setBusy] = useState<ExportKey | null>(null);

  /** "Me": tasks I own, created, review, or hold/held a stage of. */
  // tasks in the Recycle Bin are already excluded by fetchAll.tasks; their stages/events follow
  const myTaskIds = (tasks: Task[], stages: TaskStage[]) => new Set(isMe
    ? tasks.filter((t) => isMyTask({ ...t, task_stages: stages.filter((st) => st.task_id === t.id) }, me.id)).map((t) => t.id)
    : tasks.map((t) => t.id));
  const [error, setError] = useState<unknown>(null);

  async function build(key: ExportKey): Promise<CsvTable> {
    switch (key) {
      case "tasks": {
        const [tasks, stages, goals] = await Promise.all([fetchAll.tasks(), fetchAll.stages(), fetchAll.goals()]);
        const mine = myTaskIds(tasks, stages);
        return taskTable(tasks.filter((t) => inRange(t.created_at, r) && mine.has(t.id)),
          (id) => stages.find((s) => s.task_id === id && s.state === "active")?.stage_code ?? null, goals, lk);
      }
      case "workflow": {
        const [tasks, stages] = await Promise.all([fetchAll.tasks(), fetchAll.stages()]);
        const mine = myTaskIds(tasks, stages);
        return stageTable(stages.filter((s) => inRange(s.entered_at, r) && mine.has(s.task_id)), tasks, lk);
      }
      case "goals": {
        const [goals, progress, tasks, stages] = await Promise.all([fetchAll.goals(), fetchAll.goalProgress(), fetchAll.tasks(), fetchAll.stages()]);
        const mine = myTaskIds(tasks, stages);
        const myGoals = new Set(tasks.filter((t) => mine.has(t.id)).map((t) => t.goal_id));
        return goalTable(goals.filter((g) => overlaps(g.start_date, g.end_date, r) && (!isMe || g.owner_id === me.id || myGoals.has(g.id))), progress, lk);
      }
      case "events": {
        const [events, tasks, stages] = await Promise.all([fetchAll.taskEvents(r), fetchAll.tasks(), fetchAll.stages()]);
        const mine = myTaskIds(tasks, stages);
        return eventTable(events.filter((e) => mine.has(e.task_id) && (!isMe || e.actor_id === me.id || mine.has(e.task_id))), tasks, lk);
      }
      case "audit": return auditTable(await fetchAll.auditEvents(r));
      case "radar": return signalTable((await fetchAllExtra.signals(r)).filter((x) => !isMe || x.collected_by === me.id));
      case "opportunities": {
        const [opps, links] = await Promise.all([fetchAllExtra.opportunities(), fetchAllExtra.opportunitySignals()]);
        return opportunityTable(opps.filter((o) => inRange(o.created_at, r) && (!isMe || o.created_by === me.id || o.decided_by === me.id)), links, lk);
      }
      case "learnings": return learningTable((await fetchAllExtra.learnings())
        .filter((l) => inRange(l.created_at, r) && (!isMe || l.created_by === me.id || l.owner_id === me.id)), lk);
      case "drafts": return draftTable((await fetchAllExtra.drafts(r)).filter((d) => !isMe || d.created_by === me.id), lk);
    }
  }

  async function run(key: ExportKey) {
    setBusy(key);
    setError(null);
    try {
      const { columns, rows } = await build(key);
      downloadCsv(`marketing-desk-${key}${isMe ? "-mine" : ""}-${rangeSlug(r)}-exported-${todayInIndia()}.csv`, toCsv(columns, rows));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="muted">CSV files open in Excel or Google Sheets. Text is UTF-8 (Hindi and Marathi display correctly), timestamps are UTC, and cells that could run as spreadsheet formulas are neutralised. Missing values are left blank, never filled with zero. Nothing is deleted from Marketing Desk, so any past period can be exported again.</p>
      <div className="filters">
        <DateRangePicker {...dates} />
        <span className="muted small">Period: <strong>{rangeLabel(r)}</strong> (India dates, weeks start Monday)</span>
        {isMe && <span className="scope-note">Your records only (the activity-log export always covers everyone)</span>}
      </div>
      <ErrorText error={error} />
      <div className="export-grid">
        {EXPORTS.map((x) => (
          <section key={x.key} className="card">
            <h2>{x.title}</h2>
            <p className="muted small">{x.description}</p>
            {r.preset !== "all" && <p className="small">Includes records {x.period}.</p>}
            <button type="button" className="button" disabled={busy !== null} onClick={() => run(x.key)}>
              {busy === x.key ? "Preparing…" : "Download CSV"}
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
