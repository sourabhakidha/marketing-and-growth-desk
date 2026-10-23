import { useState } from "react";
import { Link } from "react-router";
import { type Goal, useGoalProgress, useGoals, useLookups, useSaveGoal, useTasks } from "../lib/api.ts";
import { formatDate, goalRef, taskRef } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { ProgressBar, StatusBadge } from "../components/Badges.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { GoalForm, goalToValues, valuesToGoal } from "./GoalForm.tsx";

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
  const isAdmin = me.role === "admin";

  if (goals.isPending || !ready) return <Loading />;
  if (goals.isError) return <StatePanel title="Could not load goals" tone="error"><p>{goals.error.message}</p></StatePanel>;
  if (goals.data.length === 0) {
    return (
      <StatePanel title="No goals yet">
        <p>{isAdmin ? "Use New activity → Goal to set the first outcome, then link tasks to it." : "Sourabh or Tanvi can set goals. Tasks can exist without one."}</p>
      </StatePanel>
    );
  }

  return (
    <div className="goal-list">
      {goals.data.map((g) => {
        const p = progress.data?.find((x) => x.goal_id === g.id);
        const linked = (tasks.data ?? []).filter((t) => t.goal_id === g.id);
        const text =
          g.progress_method === "accepted_deliverables"
            ? `${p?.accepted_deliverables ?? 0} of ${g.target_quantity} ${g.target_unit ?? "deliverables"} approved`
            : g.progress_method === "task_checklist"
              ? p && p.linked_tasks > 0 ? `${p.done_tasks} of ${p.linked_tasks} linked tasks approved` : "No linked tasks yet"
              : g.manual_progress != null ? `${g.manual_progress}% (verified by an admin)` : "Not assessed yet";
        return (
          <section key={g.id} className="card goal">
            <header className="goal__header">
              <div>
                <span className="ref">{goalRef(g.ref)}</span>
                <h2>{g.title}</h2>
                <p className="muted small">
                  {memberName(g.owner_id)} · {g.start_date || g.end_date ? `${formatDate(g.start_date)} – ${formatDate(g.end_date)}` : "No timeframe set"} · {METHOD_LABEL[g.progress_method]}
                </p>
              </div>
              <div className="goal__side">
                <StatusBadge code={g.status} label={label("goal_status", g.status)} />
                {isAdmin && <button type="button" className="button button--small" onClick={() => { save.reset(); setEditing(g); }}>Edit</button>}
              </div>
            </header>
            <ProgressBar pct={p?.progress_pct ?? null} label={text} />
            {g.success_definition && <p className="small"><strong>Success:</strong> {g.success_definition}</p>}
            {linked.length > 0 ? (
              <ul className="linked-tasks">
                {linked.map((t) => (
                  <li key={t.id}>
                    <Link to={`/workspace/tasks/${t.ref}`}>{taskRef(t.ref)} · {t.title}</Link>
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
