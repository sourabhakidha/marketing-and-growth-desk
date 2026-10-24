import { useMemo } from "react";
import { type TaskWithStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { formatDate, goalRef, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { PriorityMark } from "../components/Badges.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useTaskFilters, useTaskPanel } from "./filters.ts";
import { currentStage } from "./pipeline.ts";

/** Tasks grouped by overall status (Bible §6.6 "Task board"). Stage is shown on each card, separately. */
export function TaskBoard() {
  const tasks = useTasks();
  const goals = useGoals();
  const { options, label, memberName, ready } = useLookups();
  const { member: me } = useMember();
  const { f } = useTaskFilters();
  const panel = useTaskPanel();
  const today = todayInIndia();

  const filtered = useMemo(() => (tasks.data ?? []).filter((t) => matchesFilters(t, f, { meId: me.id, today })), [tasks.data, f, me.id, today]);

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;

  const showCancelled = f.status === "all" || f.status === "cancelled";
  const columns = options("task_status").filter((s) => showCancelled || s.code !== "cancelled");

  return (tasks.data ?? []).length === 0 ? (
    <StatePanel title="No tasks yet"><p>Use <strong>New activity</strong> to create the first task.</p></StatePanel>
  ) : (
    <div className="board" aria-label="Tasks by status">
      {columns.map((col) => {
        const items = filtered.filter((t) => t.status === col.code);
        return (
          <section key={col.code} className={`board__col board__col--${col.code}`} aria-label={col.label}>
            <h2 className="board__title">{col.label} <span className="count">{items.length}</span></h2>
            {items.length === 0 && <p className="board__empty">—</p>}
            {items.map((t) => (
              <TaskCard key={t.id} t={t} today={today} label={label} memberName={memberName} selected={t.ref === panel.ref}
                onOpen={() => panel.open(t.ref)} goal={goals.data?.find((g) => g.id === t.goal_id)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ t, today, label, memberName, goal, selected, onOpen }: {
  t: TaskWithStage; today: string; selected: boolean; onOpen: () => void;
  label: (v: string, c: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string;
  goal?: { ref: number; title: string };
}) {
  const stage = currentStage(t);
  const overdue = isOverdue(t.due_date, t.status, today);
  const waiting = stage && !stage.picked_up_at && stage.owner_id;
  return (
    <button type="button" className={`task-card${selected ? " is-selected" : ""}`} onClick={onOpen}>
      <span className="task-card__top">
        <span className="ref">{taskRef(t.ref)}</span>
        <PriorityMark code={t.priority} label={label("priority", t.priority)} />
      </span>
      <span className="task-card__title">{t.title}</span>
      <span className="task-card__meta">{label("task_type", t.task_type)}</span>
      {stage && (
        <span className="task-card__stage">
          Stage: <strong>{label("workflow_stage", stage.stage_code)}</strong>
          {stage.owner_id && stage.owner_id !== t.owner_id && <> · {memberName(stage.owner_id)}</>}
          {waiting && <span className="tag tag--wait">waiting pick-up</span>}
        </span>
      )}
      {t.status === "blocked" && <span className="task-card__blocker">Blocked: {t.blocker_reason ?? "reason not recorded"}</span>}
      <span className="task-card__foot">
        <span>{memberName(t.owner_id)}</span>
        <span className={overdue ? "due due--late" : "due"}>{t.due_date ? `${overdue ? "Overdue · " : "Due "}${formatDate(t.due_date)}` : "No due date"}</span>
      </span>
      {goal && <span className="task-card__goal">{goalRef(goal.ref)} · {goal.title}</span>}
    </button>
  );
}
