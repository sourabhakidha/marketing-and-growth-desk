// Deliverables and their parts (D-038): the journey section of a deliverable and
// the "Part of" strip on a part. In the Workspace, deliverables are a "Group by" (D-040).
import { useMemo, useState } from "react";
import { type Task, useCreateTask, useLookups, useStagesFor, useTasks, useUpdateTask } from "../lib/api.ts";
import { at, buildTimeline, deadlineOf, partsOf, RISK_LABEL, rollup, type Rollup } from "../lib/deliverables.ts";
import {formatDate, formatDateTime, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { StatusBadge } from "../components/Badges.tsx";
import { ErrorText, Field } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { useTaskPanel } from "./filters.ts";
import { EMPTY_IMPACT_VALUES, EMPTY_STRUCTURE_VALUES, TaskForm, type TaskFormValues, valuesToTask } from "./TaskForm.tsx";

function RiskChip({ r }: { r: Rollup }) {
  return <span className={`risk risk--${r.risk}`}>{RISK_LABEL[r.risk]}</span>;
}

function Progress({ r }: { r: Rollup }) {
  return (
    <div className="dv-progress" role="img" aria-label={`${r.done} of ${r.total - r.cancelled} tasks done`}>
      <div className="dv-progress__track"><div className="dv-progress__fill" style={{ width: `${r.pct ?? 0}%` }} /></div>
      <span className="small"><strong>{r.done}</strong> of {r.total - r.cancelled} tasks done</span>
    </div>
  );
}

/** Opens a task in the side panel when there is one; otherwise its page. */
function useOpenTask() {
  const panel = useTaskPanel();
  return (ref: number) => panel.open(ref);
}

// ---------------------------------------------------------------- on a part: where it belongs
export function PartOfStrip({ task }: { task: Task }) {
  const tasks = useTasks();
  const { label, memberName } = useLookups();
  const open = useOpenTask();
  const d = (tasks.data ?? []).find((t) => t.id === task.parent_id);
  if (!task.parent_id) return null;
  if (!d) return <div className="partof small muted">Part of a deliverable that is not on the desk.</div>;
  const parts = partsOf(d.id, tasks.data ?? []);
  const r = rollup(d, parts, todayInIndia());
  const index = [...parts].sort((a, b) => a.ref - b.ref).findIndex((p) => p.id === task.id) + 1;
  return (
    <section className="partof" aria-label="The deliverable this task belongs to">
      <div className="partof__head">
        <span className="small muted">Task {index} of {parts.length} in the deliverable</span>
        <button type="button" className="link" onClick={() => open(d.ref)}><strong>{d.title}</strong></button>
        <RiskChip r={r} />
        {deadlineOf(d) && <span className="small muted">lands {formatDate(deadlineOf(d))}</span>}
      </div>
      <ol className="partof__siblings">
        {[...parts].sort((a, b) => a.ref - b.ref).map((p) => (
          <li key={p.id} className={p.id === task.id ? "is-me" : undefined}>
            <button type="button" className="link" onClick={() => open(p.ref)}>{p.title}</button>
            <StatusBadge code={p.status} label={label("task_status", p.status)} />
            <span className="small muted">{memberName(p.owner_id)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- on a deliverable: the journey
export function DeliverableJourney({ deliverable }: { deliverable: Task }) {
  const tasks = useTasks();
  const { label, memberName } = useLookups();
  const { member: me } = useMember();
  const isAdmin = me.role === "admin";
  const open = useOpenTask();
  const parts = useMemo(() => partsOf(deliverable.id, tasks.data ?? []).sort((a, b) => a.ref - b.ref), [tasks.data, deliverable.id]);
  const stages = useStagesFor(parts.map((p) => p.id));
  const [adding, setAdding] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const create = useCreateTask();
  const today = todayInIndia();
  const r = rollup(deliverable, parts, today);
  const takesTasks = !deliverable.removed_at && !["requested", "done", "cancelled"].includes(deliverable.status);
  const tl = useMemo(() => buildTimeline(deliverable, parts, stages.data ?? []), [deliverable, parts, stages.data]);

  const newPart: TaskFormValues = {
    title: "", task_type: "", work_origin: deliverable.work_origin, owner_id: me.id, priority: deliverable.priority ?? "", due_date: "",
    goal_id: "", counts_toward_goal: false, brief: "", deliverable_format: "", channel: deliverable.channel ?? "", requester: "", estimate_hours: "",
    completion_criteria: "", reviewer_id: "", workflow_template_id: "", deliverable_url: "", publish_date: "",
    ...EMPTY_IMPACT_VALUES, ...EMPTY_STRUCTURE_VALUES, parent_id: deliverable.id,
  };

  return (
    <section className="card journey" aria-label="Deliverable journey">
      <header className="journey__head">
        <div>
          <p className="eyebrow">Deliverable journey</p>
          <div className="journey__summary">
            <RiskChip r={r} />
            <Progress r={r} />
            {deadlineOf(deliverable) && <span className="small">Lands <strong>{formatDate(deadlineOf(deliverable))}</strong></span>}
            {r.next && <span className="small">Next: <button type="button" className="link" onClick={() => open(r.next!.ref)}>{r.next.title}</button> · {memberName(r.next.owner_id)}{r.next.due_date ? ` · due ${formatDate(r.next.due_date)}` : ""}</span>}
          </div>
          {r.reasons.length > 0 && <p className="small journey__reasons">{r.reasons.join(" · ")}</p>}
        </div>
        <div className="row-actions">
          {takesTasks && <button type="button" className="button button--small" onClick={() => { create.reset(); setAdding(true); }}>{isAdmin ? "+ Add task" : "+ Request a task"}</button>}
          {isAdmin && takesTasks && <button type="button" className="button button--small button--quiet" onClick={() => setGrouping(true)}>Add existing tasks</button>}
        </div>
      </header>

      {parts.length === 0 ? (
        <p className="muted small">No tasks yet. Add the work this deliverable needs — e.g. ideation, writing, design, editing — each with its own owner.</p>
      ) : (
        <>
          <div className="journey__timeline" role="img" aria-label="Timeline of each task's steps">
            <div className="tl-axis">
              <span>{formatDate(new Date(tl.start).toISOString())}</span>
              <span>{formatDate(new Date(tl.end).toISOString())}</span>
            </div>
            {tl.rows.map((row) => (
              <div key={row.task.id} className="tl-row">
                <button type="button" className="tl-row__label link" onClick={() => open(row.task.ref)} title={row.task.title}>
                  <span className="tl-row__title">{row.task.title}</span>
                  <span className="small muted">{memberName(row.task.owner_id)}</span>
                </button>
                <div className="tl-row__track">
                  {row.segments.map((s, i) => (
                    <span key={i} className={`tl-seg tl-seg--${s.kind}${s.open ? " is-open" : ""}${s.rework ? " is-rework" : ""}`}
                      style={{ left: `${at(tl, s.start)}%`, width: `${Math.max(0.6, at(tl, s.end) - at(tl, s.start))}%` }}
                      title={`${label("workflow_stage", s.stage)} — ${s.kind === "wait" ? "waiting" : "working"}: ${formatDateTime(new Date(s.start).toISOString())} → ${s.open ? "now" : formatDateTime(new Date(s.end).toISOString())}${s.rework ? " (reworked)" : ""}`} />
                  ))}
                  {row.due != null && <span className="tl-due" style={{ left: `${at(tl, row.due)}%` }} title={`Due ${formatDate(row.task.due_date)}`} />}
                  {row.segments.length === 0 && <span className="tl-empty small muted">{row.task.status === "requested" ? "awaiting acceptance" : "not started"}</span>}
                </div>
                <StatusBadge code={row.task.status} label={label("task_status", row.task.status)} />
              </div>
            ))}
            <div className="tl-now" style={{ left: `calc(var(--tl-label) + (100% - var(--tl-label) - var(--tl-status)) * ${at(tl, tl.now) / 100})` }} aria-hidden="true" />
            {tl.deadline != null && <div className="tl-deadline" style={{ left: `calc(var(--tl-label) + (100% - var(--tl-label) - var(--tl-status)) * ${at(tl, tl.deadline) / 100})` }} title="Deliverable date" aria-hidden="true" />}
          </div>
          <p className="small muted tl-legend">
            <span className="tl-key tl-key--work" /> working · <span className="tl-key tl-key--wait" /> waiting to be picked up · <span className="tl-key tl-key--due" /> part due ·
            {" "}<span className="tl-key tl-key--deadline" /> deliverable date · <span className="tl-key tl-key--now" /> today. From recorded stage times only.
          </p>
        </>
      )}

      <Modal title={isAdmin ? `Add a task to “${deliverable.title}”` : `Request a task for “${deliverable.title}”`} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <TaskForm mode="create" initial={newPart} restrictedEditable busy={create.isPending} error={create.error} fixedParent
            onCancel={() => setAdding(false)}
            onSubmit={(v) => create.mutate({ ...valuesToTask(v), created_by: me.id }, { onSuccess: () => setAdding(false) })} />
        )}
      </Modal>
      {grouping && <GroupDialog deliverable={deliverable} onClose={() => setGrouping(false)} />}
    </section>
  );
}

/** Admins attach existing standalone tasks to a deliverable (D-038: "group current tasks"). */
function GroupDialog({ deliverable, onClose }: { deliverable: Task; onClose: () => void }) {
  const tasks = useTasks();
  const update = useUpdateTask();
  const { label, memberName } = useLookups();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const candidates = (tasks.data ?? []).filter((t) => (t.kind ?? "task") === "task" && !t.parent_id && t.status !== "cancelled"
    && (!q || `${t.title}`.toLowerCase().includes(q.toLowerCase())));

  async function save() {
    setBusy(true); setError(null);
    try {
      for (const id of picked) await update.mutateAsync({ id, patch: { parent_id: deliverable.id } });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Add existing tasks to “${deliverable.title}”`} open onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">Pick existing tasks that belong to “{deliverable.title}”. They keep their owner, steps and history.</p>
        <Field label="Search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Task title" /></Field>
        {candidates.length === 0 ? <p className="small muted">No standalone tasks match.</p> : (
          <ul className="group-list">
            {candidates.map((t) => (
              <li key={t.id}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(t.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />
                  <span><strong>{t.title}</strong> <span className="small muted">· {label("task_type", t.task_type)} · {memberName(t.owner_id)} · {label("task_status", t.status)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button button--primary" disabled={!picked.size || busy} onClick={save}>{busy ? "Saving…" : `Add ${picked.size || ""} to deliverable`}</button>
        </div>
      </div>
    </Modal>
  );
}
