import { useMemo, useState } from "react";
import { Link } from "react-router";
import { activeStage, type TaskWithStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { formatDate, goalRef, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { PriorityMark } from "../components/Badges.tsx";
import { Loading, StatePanel } from "../components/States.tsx";

interface Filters { q: string; owner: string; type: string; origin: string; priority: string; goal: string; mine: boolean; showCancelled: boolean }
const initial: Filters = { q: "", owner: "", type: "", origin: "", priority: "", goal: "", mine: false, showCancelled: false };

export function TaskBoard() {
  const tasks = useTasks();
  const goals = useGoals();
  const { members, options, label, memberName, ready } = useLookups();
  const { member: me } = useMember();
  const [f, setF] = useState(initial);
  const today = todayInIndia();

  const filtered = useMemo(() => (tasks.data ?? []).filter((t) => {
    const stage = activeStage(t);
    if (f.mine && t.owner_id !== me.id && stage?.owner_id !== me.id) return false;
    if (f.owner && t.owner_id !== f.owner) return false;
    if (f.type && t.task_type !== f.type) return false;
    if (f.origin && t.work_origin !== f.origin) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.goal === "none" ? t.goal_id : f.goal && t.goal_id !== f.goal) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !taskRef(t.ref).toLowerCase().includes(q)) return false;
    }
    return true;
  }), [tasks.data, f, me.id]);

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;

  const columns = options("task_status").filter((s) => f.showCancelled || s.code !== "cancelled");
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const active = JSON.stringify(f) !== JSON.stringify(initial);

  return (
    <>
      <div className="filters" role="search">
        <input type="search" placeholder="Search title or T-number" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search tasks" />
        <select value={f.owner} onChange={(e) => set("owner", e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <select value={f.type} onChange={(e) => set("type", e.target.value)} aria-label="Task type">
          <option value="">All types</option>
          {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select value={f.origin} onChange={(e) => set("origin", e.target.value)} aria-label="Work origin">
          <option value="">All origins</option>
          {options("work_origin").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select value={f.priority} onChange={(e) => set("priority", e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {options("priority").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select value={f.goal} onChange={(e) => set("goal", e.target.value)} aria-label="Goal">
          <option value="">Any goal</option>
          <option value="none">No goal</option>
          {(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{goalRef(g.ref)} · {g.title}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={f.mine} onChange={(e) => set("mine", e.target.checked)} /> My work</label>
        <label className="check"><input type="checkbox" checked={f.showCancelled} onChange={(e) => set("showCancelled", e.target.checked)} /> Show cancelled</label>
        {active && <button type="button" className="link" onClick={() => setF(initial)}>Clear</button>}
      </div>

      {(tasks.data ?? []).length === 0 ? (
        <StatePanel title="No tasks yet">
          <p>Use <strong>New activity</strong> to create the first task. Tasks you create are visible to the whole team.</p>
        </StatePanel>
      ) : (
        <div className="board" aria-label="Tasks by status">
          {columns.map((col) => {
            const items = filtered.filter((t) => t.status === col.code);
            return (
              <section key={col.code} className={`board__col board__col--${col.code}`} aria-label={col.label}>
                <h2 className="board__title">{col.label} <span className="count">{items.length}</span></h2>
                {items.length === 0 && <p className="board__empty">—</p>}
                {items.map((t) => (
                  <TaskCard key={t.id} t={t} today={today} label={label} memberName={memberName} goalTitle={goals.data?.find((g) => g.id === t.goal_id)} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function TaskCard({ t, today, label, memberName, goalTitle }: {
  t: TaskWithStage; today: string;
  label: (v: string, c: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string;
  goalTitle?: { ref: number; title: string };
}) {
  const stage = activeStage(t);
  const overdue = isOverdue(t.due_date, t.status, today);
  const waiting = stage && !stage.picked_up_at && stage.owner_id;
  return (
    <Link to={`/workspace/tasks/${t.ref}`} className="task-card">
      <div className="task-card__top">
        <span className="ref">{taskRef(t.ref)}</span>
        <PriorityMark code={t.priority} label={label("priority", t.priority)} />
      </div>
      <h3>{t.title}</h3>
      <p className="task-card__meta">{label("task_type", t.task_type)} · {label("work_origin", t.work_origin)}</p>
      {stage && (
        <p className="task-card__stage">
          Stage: <strong>{label("workflow_stage", stage.stage_code)}</strong>
          {stage.owner_id && stage.owner_id !== t.owner_id && <> · {memberName(stage.owner_id)}</>}
          {waiting && <span className="tag tag--wait">waiting for pick-up</span>}
        </p>
      )}
      {t.status === "blocked" && t.blocker_reason && <p className="task-card__blocker">Blocked: {t.blocker_reason}</p>}
      <div className="task-card__foot">
        <span>{memberName(t.owner_id)}</span>
        <span className={overdue ? "due due--late" : "due"}>{t.due_date ? `${overdue ? "Overdue · " : "Due "}${formatDate(t.due_date)}` : "No due date"}</span>
      </div>
      {goalTitle && <p className="task-card__goal">{goalRef(goalTitle.ref)} · {goalTitle.title}</p>}
    </Link>
  );
}
