// Goal → Deliverable → Task views (D-041): the Goals tab (goal cards with their
// deliverables) and the Deliverables tab. Each deliverable expands into columns
// for the steps its tasks actually run, then Done.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { type Goal, type TaskWithStage, useBinAction, useCreateDeliverable, useCreateTask, useGoals, useLookups, useSaveGoal, useTasks } from "../lib/api.ts";
import { deadlineOf, RISK_LABEL } from "../lib/deliverables.ts";
import { overlaps } from "../lib/dateRange.ts";
import { buildHierarchy, type DeliverableNode, DONE_COL, type GoalNode, NO_STEP_COL, stepColumns } from "../lib/hierarchy.ts";
import { IMPORTANCE_LABEL, OUTCOME_STATUS_LABEL } from "../lib/impact.ts";
import { formatDate, isOverdue, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { MoveToBinDialog } from "../components/DeleteDialog.tsx";
import { DeleteButton } from "../components/DeleteButton.tsx";
import { Modal } from "../components/Modal.tsx";
import { PopupMenu } from "../components/PopupMenu.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, taskRange, useTaskFilters, useTaskPanel } from "./filters.ts";
import { GoalForm, goalToValues, valuesToGoal } from "./GoalForm.tsx";
import { EMPTY_IMPACT_VALUES, EMPTY_STRUCTURE_VALUES, planToTasks, TaskForm, type TaskFormValues, valuesToTask } from "./TaskForm.tsx";
import { initials } from "./Board.tsx";

const TargetIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.8" /><circle cx="12" cy="12" r="1.3" fill="currentColor" />
  </svg>
);

function Bar({ pct }: { pct: number | null }) {
  return <div className="hbar" aria-hidden="true"><span style={{ width: `${pct ?? 0}%` }} /></div>;
}

/** Visible-work filtering shared by both tabs: a deliverable shows when it or any of its tasks matches. */
function useFiltered() {
  const tasks = useTasks();
  const goals = useGoals();
  const { member: me } = useMember();
  const { scope } = useScope();
  const { f, active } = useTaskFilters();
  const today = todayInIndia();
  const all = (tasks.data ?? []) as TaskWithStage[];
  const h = useMemo(() => {
    const ctx = { meId: me.id, today, scope, all };
    const range = taskRange(f, today);
    const filtering = active || scope === "me";
    const matchTask = (t: TaskWithStage) => matchesFilters(t, f, ctx);
    const full = buildHierarchy(goals.data ?? [], all, today, f.status === "all" || f.status === "cancelled");
    const keepD = (n: DeliverableNode) => !filtering || matchTask(n.d) || n.tasks.some(matchTask);
    const showD = (n: DeliverableNode): DeliverableNode => ({ ...n, tasks: filtering ? n.tasks.filter(matchTask) : n.tasks });
    const goalsShown = full.goals
      .filter((g) => (!f.goal || f.goal === g.goal.id) && f.goal !== "none" && overlaps(g.goal.start_date, g.goal.end_date, range))
      .map((g) => ({ ...g, deliverables: g.deliverables.filter(keepD).map(showD), directTasks: g.directTasks.filter((t) => !filtering || matchTask(t)) }))
      .filter((g) => !filtering || g.deliverables.length || g.directTasks.length || (scope === "me" && g.goal.owner_id === me.id && !active));
    return {
      goals: goalsShown,
      unlinkedDeliverables: f.goal && f.goal !== "none" ? [] : full.unlinkedDeliverables.filter(keepD).map(showD),
      looseTasks: f.goal && f.goal !== "none" ? [] : full.looseTasks.filter((t) => !filtering || matchTask(t)),
    };
  }, [all, goals.data, f, active, me.id, today, scope]);
  return { h, ready: tasks.isSuccess && goals.isSuccess, error: tasks.error ?? goals.error };
}

// ---------------------------------------------------------------- Goals tab
export function GoalsTab() {
  const { h, ready, error } = useFiltered();
  const { member } = useMember();
  const [expand, setExpand] = useState<{ all: boolean; key: number }>({ all: true, key: 0 });
  if (error) return <StatePanel title="Could not load the workspace" tone="error"><p>{error.message}</p></StatePanel>;
  if (!ready) return <Loading />;
  const nothing = !h.goals.length && !h.unlinkedDeliverables.length && !h.looseTasks.length;
  return (
    <div className="hier" key={expand.key}>
      <ExpandControls set={(all) => setExpand((e) => ({ all, key: e.key + 1 }))} />
      {nothing && <StatePanel title="Nothing here yet"><p>{member.role === "admin" ? "Start with + Create new → Goal, then add deliverables and their tasks." : "Use + Create new to request a deliverable or a task."}</p></StatePanel>}
      {h.goals.map((g) => <GoalCard key={g.goal.id} node={g} expanded={expand.all} />)}
      {h.unlinkedDeliverables.length > 0 && (
        <section className="hier__group">
          <h2 className="hier__grouptitle">Deliverables without a goal</h2>
          <div className="hier__children">{h.unlinkedDeliverables.map((n, i) => <DeliverableCard key={n.d.id} node={n} index={i + 1} expanded={expand.all} />)}</div>
        </section>
      )}
      {h.looseTasks.length > 0 && <LooseTasks title="Tasks not in a deliverable" tasks={h.looseTasks} />}
    </div>
  );
}

// ---------------------------------------------------------------- Deliverables tab
export function DeliverablesTab() {
  const { h, ready, error } = useFiltered();
  const [expand, setExpand] = useState<{ all: boolean; key: number }>({ all: false, key: 0 });
  if (error) return <StatePanel title="Could not load deliverables" tone="error"><p>{error.message}</p></StatePanel>;
  if (!ready) return <Loading />;
  const order = { blocked: 0, at_risk: 1, on_track: 2, no_parts: 3, done: 4 } as const;
  const rows = [...h.goals.flatMap((g) => g.deliverables.map((n) => ({ n, goal: g.goal as Goal | undefined }))), ...h.unlinkedDeliverables.map((n) => ({ n, goal: undefined }))]
    .sort((a, b) => order[a.n.r.risk] - order[b.n.r.risk] || (deadlineOf(a.n.d) ?? "9999").localeCompare(deadlineOf(b.n.d) ?? "9999"));
  if (!rows.length) return <StatePanel title="No deliverables yet"><p>Use + Create new → Deliverable, e.g. “5 Marathi video scripts”.</p></StatePanel>;
  return (
    <div className="hier" key={expand.key}>
      <ExpandControls set={(all) => setExpand((e) => ({ all, key: e.key + 1 }))} />
      <div className="hier__children hier__children--flat">
        {rows.map(({ n, goal }, i) => <DeliverableCard key={n.d.id} node={n} index={i + 1} expanded={expand.all} goalTitle={goal?.title ?? "No goal"} />)}
      </div>
    </div>
  );
}

function ExpandControls({ set }: { set: (all: boolean) => void }) {
  return (
    <div className="hier__controls">
      <button type="button" className="link small" onClick={() => set(true)}>Expand all</button>
      <span className="muted small">·</span>
      <button type="button" className="link small" onClick={() => set(false)}>Collapse all</button>
    </div>
  );
}

// ---------------------------------------------------------------- goal card
function GoalCard({ node, expanded }: { node: GoalNode; expanded: boolean }) {
  const { goal: g } = node;
  const { member } = useMember();
  const { memberName, label } = useLookups();
  const isAdmin = member.role === "admin";
  const save = useSaveGoal();
  const bin = useBinAction();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <section className="hier__group" aria-label={`Goal: ${g.title}`}>
      <article className="goal-card">
        <div className="goal-card__main">
          <span className="goal-card__icon"><TargetIcon /></span>
          <div className="goal-card__text">
            <p className="goal-card__kind">Goal</p>
            <h2 className="goal-card__title">{g.title}</h2>
            {(g.outcome_statement || g.description) && <p className="goal-card__desc">{g.outcome_statement ?? g.description}</p>}
            <p className="small muted goal-card__meta">
              {g.start_date || g.end_date ? `${formatDate(g.start_date)} – ${formatDate(g.end_date)}` : "No dates set"}
              {" · "}{memberName(g.owner_id)}{g.channel ? ` · ${label("channel", g.channel)}` : ""}
            </p>
          </div>
          <div className="goal-card__progress">
            <div className="goal-card__pct"><strong>{node.pct ?? 0}%</strong><span className="small muted">{node.doneDeliverables} of {node.totalDeliverables} deliverables done</span></div>
            <Bar pct={node.pct} />
            <span className="small muted">Work progress — not proof the outcome was achieved</span>
          </div>
        </div>
        <aside className="goal-card__impact">
          <p className="goal-card__impact-k">Business impact</p>
          <p className="small">{g.outcome_rationale ?? <span className="muted">No rationale recorded yet.</span>}</p>
          <p className="small muted">Outcome: {OUTCOME_STATUS_LABEL[g.outcome_status]}{g.importance ? ` · ${IMPORTANCE_LABEL[g.importance]} importance` : ""}</p>
          <Link className="link small" to={`/goals#goal-${g.ref}`}>View details</Link>
        </aside>
        <div className="goal-card__menu">
          <DeleteButton kind="goal" id={g.id} title={g.title} />
          <PopupMenu label="Goal actions" buttonClassName="icon-button kebab" align="end" button={<span aria-hidden="true">⋯</span>}>
            <Link role="menuitem" className="popup__item" to={`/goals#goal-${g.ref}`}>View details</Link>
            <button type="button" role="menuitem" className="popup__item" onClick={() => setAdding(true)}>{isAdmin ? "+ Add deliverable" : "+ Request a deliverable"}</button>
            {isAdmin && <button type="button" role="menuitem" className="popup__item" onClick={() => { save.reset(); setEditing(true); }}>Edit goal</button>}
            {isAdmin && <button type="button" role="menuitem" className="popup__item popup__item--signout" onClick={() => { bin.reset(); setDeleting(true); }}>Delete goal</button>}
          </PopupMenu>
        </div>
      </article>

      <div className="hier__children">
        {node.deliverables.map((n, i) => <DeliverableCard key={n.d.id} node={n} index={i + 1} expanded={expanded} />)}
        {node.directTasks.length > 0 && <LooseTasks title="Tasks linked to this goal (not in a deliverable)" tasks={node.directTasks} nested />}
        <button type="button" className="hier__add" onClick={() => setAdding(true)}>{isAdmin ? "+ Add deliverable" : "+ Request a deliverable"}</button>
      </div>

      <Modal title="Edit goal" open={editing} onClose={() => setEditing(false)} wide>
        {editing && <GoalForm mode="edit" initial={goalToValues(g)} busy={save.isPending} error={save.error} onCancel={() => setEditing(false)}
          onSubmit={(v) => save.mutate({ id: g.id, input: valuesToGoal(v) }, { onSuccess: () => setEditing(false) })} />}
      </Modal>
      <MoveToBinDialog open={deleting} onClose={() => setDeleting(false)} busy={bin.isPending} error={bin.error} what="goal" refText={g.title}
        onConfirm={(reason) => bin.mutate({ fn: "goal_remove", args: { p_goal: g.id, p_reason: reason } }, { onSuccess: () => setDeleting(false) })} />
      {adding && <NewDeliverableModal goalId={g.id} onClose={() => setAdding(false)} />}
    </section>
  );
}

export function blankDeliverable(ownerId: string, goalId = ""): TaskFormValues {
  return {
    title: "", task_type: "content_development", work_origin: "planned", owner_id: ownerId, priority: "", due_date: "", goal_id: goalId,
    counts_toward_goal: false, brief: "", deliverable_format: "", channel: "", requester: "", estimate_hours: "", completion_criteria: "",
    reviewer_id: "", workflow_template_id: "", deliverable_url: "", publish_date: "", ...EMPTY_IMPACT_VALUES, ...EMPTY_STRUCTURE_VALUES, kind: "deliverable",
  };
}

export function blankTask(ownerId: string, parent?: TaskWithStage): TaskFormValues {
  return {
    title: "", task_type: "", work_origin: parent?.work_origin ?? "planned", owner_id: ownerId, priority: parent?.priority ?? "", due_date: "",
    goal_id: "", counts_toward_goal: false, brief: "", deliverable_format: "", channel: parent?.channel ?? "", requester: "", estimate_hours: "",
    completion_criteria: "", reviewer_id: "", workflow_template_id: "", deliverable_url: "", publish_date: "",
    ...EMPTY_IMPACT_VALUES, ...EMPTY_STRUCTURE_VALUES, parent_id: parent?.id ?? "",
  };
}

export function NewDeliverableModal({ goalId = "", onClose }: { goalId?: string; onClose: () => void }) {
  const { member } = useMember();
  const create = useCreateDeliverable();
  const { label } = useLookups();
  return (
    <Modal title={member.role === "admin" ? "New deliverable" : "Request a deliverable"} open onClose={onClose} wide>
      <TaskForm mode="create" initial={blankDeliverable(member.id, goalId)} restrictedEditable busy={create.isPending} error={create.error}
        onCancel={onClose} onSubmit={(v) => create.mutate({
          deliverable: { ...valuesToTask(v), created_by: member.id },
          tasks: planToTasks(v, (c) => label("workflow_stage", c)).map((t) => ({ ...t, created_by: member.id })),
        }, { onSuccess: onClose })} />
    </Modal>
  );
}

export function NewTaskModal({ parent, onClose }: { parent?: TaskWithStage; onClose: () => void }) {
  const { member } = useMember();
  const create = useCreateTask();
  return (
    <Modal title={`${member.role === "admin" ? "New task" : "Request a task"}${parent ? ` in “${parent.title}”` : ""}`} open onClose={onClose} wide>
      <TaskForm mode="create" initial={blankTask(member.id, parent)} restrictedEditable fixedParent={Boolean(parent)} busy={create.isPending} error={create.error}
        onCancel={onClose} onSubmit={(v) => create.mutate({ ...valuesToTask(v), created_by: member.id }, { onSuccess: onClose })} />
    </Modal>
  );
}

// ---------------------------------------------------------------- deliverable card
function DeliverableCard({ node, index, expanded, goalTitle }: { node: DeliverableNode; index: number; expanded: boolean; goalTitle?: string }) {
  const { d, r, tasks } = node;
  const takesTasks = !d.removed_at && !["requested", "done", "cancelled"].includes(d.status);
  const { label, memberName } = useLookups();
  const { member } = useMember();
  const isAdmin = member.role === "admin";
  const panel = useTaskPanel();
  const bin = useBinAction();
  const [open, setOpen] = useState(expanded && tasks.length > 0);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const counting = r.total - r.cancelled;
  return (
    <article className="dcard" aria-label={`Deliverable: ${d.title}`}>
      <header className="dcard__head">
        <div className="dcard__text">
          <p className="dcard__kind">Deliverable {index}{d.deliverable_format ? ` · ${d.deliverable_format}` : ""}{goalTitle ? <span className="muted"> · {goalTitle}</span> : null}</p>
          <button type="button" className="dcard__title" onClick={() => panel.open(d.ref)}>{d.title}</button>
          {d.brief && <p className="dcard__desc">{d.brief}</p>}
          <p className="dcard__meta">
            {d.channel && <span>{label("channel", d.channel)}</span>}
            <span className="who"><span className="avatar" aria-hidden="true">{initials(memberName(d.owner_id))}</span>{memberName(d.owner_id)}</span>
            {deadlineOf(d) && <span className={isOverdue(deadlineOf(d), d.status, todayInIndia()) ? "due--late" : undefined}>Due {formatDate(deadlineOf(d))}</span>}
            {d.status === "requested" && <span className="flagchip">Requested</span>}
            {(r.risk === "blocked" || r.risk === "at_risk") && <span className={`risk risk--${r.risk}`} title={r.reasons.join(" · ")}>{RISK_LABEL[r.risk]}</span>}
          </p>
          {r.reasons.length > 0 && r.risk !== "done" && <p className="small dcard__reasons">{r.reasons.join(" · ")}</p>}
        </div>
        <div className="dcard__progress">
          <div className="goal-card__pct"><strong>{node.pct}%</strong><span className="small muted">{r.done} of {counting} tasks done</span></div>
          <Bar pct={node.pct} />
        </div>
        <div className="dcard__menu">
          <DeleteButton kind="deliverable" id={d.id} title={d.title} />
          <PopupMenu label="Deliverable actions" buttonClassName="icon-button kebab" align="end" button={<span aria-hidden="true">⋯</span>}>
            <button type="button" role="menuitem" className="popup__item" onClick={() => panel.open(d.ref)}>Open details</button>
            <Link role="menuitem" className="popup__item" to={`/workspace/deliverables/${d.ref}`}>View journey</Link>
            {takesTasks && <button type="button" role="menuitem" className="popup__item" onClick={() => setAdding(true)}>{isAdmin ? "+ Add task" : "+ Request a task"}</button>}
            {isAdmin && <button type="button" role="menuitem" className="popup__item popup__item--signout" onClick={() => { bin.reset(); setDeleting(true); }}>Delete deliverable</button>}
          </PopupMenu>
        </div>
      </header>

      <div className="dcard__tasksbar">
        <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="caret" aria-hidden="true" /> {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </button>
        <Link className="link small" to={`/workspace/deliverables/${d.ref}`}>Journey</Link>
        <Link className="link small" to={`/workspace/tasks?deliverable=${d.id}`}>View all tasks</Link>
        {takesTasks && <button type="button" className="link small" onClick={() => setAdding(true)}>{isAdmin ? "+ Add task" : "+ Request a task"}</button>}
        {d.status === "requested" && <span className="small muted">Tasks can be added once the request is accepted.</span>}
      </div>
      {open && (tasks.length ? <StepColumns tasks={tasks} /> : <p className="small muted dcard__empty">No tasks yet. Add the work this deliverable needs — e.g. ideation, writing, design, editing.</p>)}

      {adding && <NewTaskModal parent={d} onClose={() => setAdding(false)} />}
      <MoveToBinDialog open={deleting} onClose={() => setDeleting(false)} busy={bin.isPending} error={bin.error} what="deliverable" refText={d.title}
        onConfirm={(reason) => bin.mutate({ fn: "task_remove", args: { p_task: d.id, p_reason: reason } }, { onSuccess: () => setDeleting(false) })} />
    </article>
  );
}

function StepColumns({ tasks }: { tasks: TaskWithStage[] }) {
  const { label, options } = useLookups();
  const order = useMemo(() => { const m = new Map(options("workflow_stage").map((o) => [o.code, o.sort_order])); return (c: string) => m.get(c) ?? 999; }, [options]);
  const cols = stepColumns(tasks, order);
  return (
    <div className="steps" role="list" aria-label="Tasks by step">
      {cols.map((c, i) => (
        <section key={c.code} className={`steps__col${c.code === DONE_COL ? " steps__col--done" : ""}`} role="listitem"
          aria-label={`${c.code === DONE_COL ? "Done" : c.code === NO_STEP_COL ? "No step" : label("workflow_stage", c.code)}: ${c.tasks.length}`}>
          <header className="steps__head">
            <span className="steps__n" aria-hidden="true">{c.code === DONE_COL ? "✓" : i + 1}</span>
            <span className="steps__name">{c.code === DONE_COL ? "Done" : c.code === NO_STEP_COL ? "No step" : label("workflow_stage", c.code)}</span>
            <span className="steps__count">{c.tasks.length}</span>
          </header>
          <div className="steps__cards">
            {c.tasks.map((t) => <MiniTask key={t.id} t={t} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function MiniTask({ t }: { t: TaskWithStage }) {
  const { label, memberName } = useLookups();
  const panel = useTaskPanel();
  const stage = t.task_stages.find((s) => s.state === "active");
  const who = stage?.owner_id ?? t.owner_id;
  const late = isOverdue(t.due_date, t.status, todayInIndia());
  const done = t.status === "done";
  return (
    <div className="card-wrap">
    <button type="button" className={`mtask${done ? " is-done" : ""}${t.status === "blocked" ? " is-blocked" : ""}`} onClick={() => panel.open(t.ref)}
      aria-label={`${t.title}. ${label("task_status", t.status)}.`}>
      <span className="mtask__row">
        <span className={`mtask__check${done ? " is-on" : ""}`} aria-hidden="true">{done ? "✓" : ""}</span>
        <span className="mtask__title">{t.title}</span>
      </span>
      <span className="mtask__flags">
        {t.priority && <span className={`priority priority--${t.priority}`}>{label("priority", t.priority)}</span>}
        {t.status === "blocked" && <span className="flagchip flagchip--blocked">Blocked</span>}
        {t.status === "requested" && <span className="flagchip">Requested</span>}
        {t.status === "in_review" && <span className="flagchip">Awaiting sign-off</span>}
        {t.status === "changes_requested" && <span className="flagchip flagchip--warn">Changes requested</span>}
      </span>
      <span className="mtask__foot">
        <span className="who"><span className="avatar" aria-hidden="true">{initials(memberName(who))}</span>{memberName(who)}</span>
        {t.due_date && <span className={late ? "due due--late" : "due"}>{formatDate(t.due_date)}</span>}
      </span>
    </button>
    <DeleteButton kind="task" id={t.id} title={t.title} className="icon-button del-btn del-btn--card" />
    </div>
  );
}

function LooseTasks({ title, tasks, nested = false }: { title: string; tasks: TaskWithStage[]; nested?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={nested ? "dcard dcard--loose" : "hier__group"}>
      <div className={nested ? "dcard__tasksbar" : "hier__loosehead"}>
        <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="caret" aria-hidden="true" /> {title} · {tasks.length}
        </button>
      </div>
      {open && <StepColumns tasks={tasks} />}
    </section>
  );
}
