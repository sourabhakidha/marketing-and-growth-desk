import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { type Goal, useBinAction, useGoalProgress, useGoals, useImpactAssessments, useLookups, useSaveGoal, useTasks } from "../lib/api.ts";
import { MoveToBinDialog } from "../components/DeleteDialog.tsx";
import {formatDate, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { isMyTask, useScope } from "../lib/scope.tsx";
import { ProgressBar, StatusBadge } from "../components/Badges.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { GoalForm, goalToValues, valuesToGoal } from "./GoalForm.tsx";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import { inRange, overlaps } from "../lib/dateRange.ts";
import { goalTable } from "../lib/exportRows.ts";
import { GOAL_FLAG_TEXT, goalRollup } from "../lib/impact.ts";
import { GoalImpactPanel } from "../modules/ImpactParts.tsx";

const GOAL_DATE_BASES = [
  { value: "active", label: "Active during period" },
  { value: "created", label: "Created in period" },
];

const METHOD_LABEL: Record<Goal["progress_method"], string> = {
  task_checklist: "Linked-task checklist",
  accepted_deliverables: "Accepted deliverables",
  manual: "Manually verified",
};

export function Goals() {
  const goals = useGoals();
  const progress = useGoalProgress();
  const tasks = useTasks();
  const { label, memberName, ready } = useLookups();
  const { member: me } = useMember();
  const save = useSaveGoal();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const del = useBinAction();
  const isAdmin = me.role === "admin";
  const dates = useDateRange({ bases: GOAL_DATE_BASES });
  const assessments = useImpactAssessments();
  const { isMe } = useScope();
  const today = todayInIndia();
  const { hash } = useLocation();
  const loaded = !goals.isPending && ready;
  // links from the Workspace and Impact pages land on one goal (#goal-<n>)
  useEffect(() => {
    if (!loaded || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("is-target"); }
  }, [loaded, hash]);

  if (goals.isPending || !ready) return <Loading />;
  if (goals.isError) return <StatePanel title="Could not load goals" tone="error"><p>{goals.error.message}</p></StatePanel>;
  if (goals.data.length === 0) {
    return (
      <StatePanel title="No goals yet">
        <p>{isAdmin ? "Use + Create new → Goal to set the first outcome, then add deliverables and tasks to it." : "Sourabh or Tanvi can set goals. Tasks can exist without one."}</p>
      </StatePanel>
    );
  }

  // a goal without start/end dates counts as open-ended
  const myGoalIds = new Set((tasks.data ?? []).filter((t) => isMyTask(t, me.id)).map((t) => t.goal_id).filter(Boolean) as string[]);
  const shown = goals.data.filter((g) => (dates.basis === "created" ? inRange(g.created_at, dates.range) : overlaps(g.start_date, g.end_date, dates.range))
    && (!isMe || g.owner_id === me.id || myGoalIds.has(g.id)));
  const rollups = new Map(shown.map((g) => [g.id, goalRollup(g, tasks.data ?? [], progress.data?.find((x) => x.goal_id === g.id), assessments.data ?? [], today)]));
  const attention = shown.flatMap((g) => {
    const r = rollups.get(g.id)!;
    const key = (["important_without_work", "no_supporting_work", "overloaded", "unclear_contributors", "tasks_done_outcome_open", "no_outcome_defined"] as const)
      .find((f) => r.flags.includes(f));
    return key && r.active ? [{ g, text: GOAL_FLAG_TEXT[key] }] : [];
  });

  return (
    <div className="goal-list">
      <div className="filters">
        <DateRangePicker {...dates} />
        <span className="muted small">{shown.length} of {goals.data.length} goals</span>
        <span className="filters__end">
          <ExportCsvButton name="goals" range={dates.range} build={() => goalTable(shown, progress.data ?? [], { label, memberName })} />
        </span>
      </div>
      {shown.length === 0 && <p className="muted small">No goals in this period.</p>}
      {attention.length > 0 && (
        <section className="card goal-attention" aria-label="Goals needing attention">
          <h2>Needs attention</h2>
          <ul className="small">{attention.map(({ g, text }) => <li key={g.id}><a href={`#goal-${g.ref}`}>{g.title}</a> — {text}</li>)}</ul>
        </section>
      )}
      {shown.map((g) => {
        const p = progress.data?.find((x) => x.goal_id === g.id);
        const linked = (tasks.data ?? []).filter((t) => t.goal_id === g.id);
        const text =
          g.progress_method === "accepted_deliverables"
            ? `${p?.accepted_deliverables ?? 0} of ${g.target_quantity} ${g.target_unit ?? "deliverables"} approved`
            : g.progress_method === "task_checklist"
              ? p && p.linked_tasks > 0 ? `${p.done_tasks} of ${p.linked_tasks} linked tasks approved` : "No linked tasks yet"
              : g.manual_progress != null ? `${g.manual_progress}% (verified by an admin)` : "Not assessed yet";
        return (
          <section key={g.id} id={`goal-${g.ref}`} className="card goal">
            <header className="goal__header">
              <div>
                <h2>{g.title}</h2>
                <p className="muted small">
                  {memberName(g.owner_id)}{g.channel ? ` · ${label("channel", g.channel)}` : ""} · {g.start_date || g.end_date ? `${formatDate(g.start_date)} – ${formatDate(g.end_date)}` : "No timeframe set"} · {METHOD_LABEL[g.progress_method]}
                </p>
              </div>
              <div className="goal__side">
                <StatusBadge code={g.status} label={label("goal_status", g.status)} />
                {isAdmin && <button type="button" className="button button--small" onClick={() => { save.reset(); setEditing(g); }}>Edit</button>}
                {isAdmin && <button type="button" className="button button--small button--quiet button--danger-text" onClick={() => { del.reset(); setDeleting(g); }}>Delete</button>}
              </div>
            </header>
            <ProgressBar pct={p?.progress_pct ?? null} label={`Task progress: ${text}`} />
            <GoalImpactPanel goal={g} rollup={rollups.get(g.id)!} />
            {g.success_definition && <p className="small"><strong>Success:</strong> {g.success_definition}</p>}
            {linked.length > 0 ? (
              <ul className="linked-tasks">
                {linked.map((t) => (
                  <li key={t.id}>
                    <Link to={`/workspace/tasks/${t.ref}`}>{t.title}</Link>
                    <StatusBadge code={t.status} label={label("task_status", t.status)} />
                    {g.progress_method === "accepted_deliverables" && t.counts_toward_goal && <span className="tag">deliverable</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">No tasks linked. Link a task from its Goal field.</p>}
            {g.completion_note && <p className="small"><strong>Outcome:</strong> {g.completion_note}</p>}
          </section>
        );
      })}
      <MoveToBinDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} busy={del.isPending} error={del.error}
        what="goal" refText={deleting?.title ?? ""}
        onConfirm={(reason) => deleting && del.mutate({ fn: "goal_remove", args: { p_goal: deleting.id, p_reason: reason } }, { onSuccess: () => setDeleting(null) })} />
      <Modal title="Edit goal" open={Boolean(editing)} onClose={() => setEditing(null)} wide>
        {editing && (
          <GoalForm mode="edit" initial={goalToValues(editing)} busy={save.isPending} error={save.error}
            onCancel={() => setEditing(null)}
            onSubmit={(v) => save.mutate({ id: editing.id, input: valuesToGoal(v) }, { onSuccess: () => setEditing(null) })} />
        )}
      </Modal>
    </div>
  );
}
