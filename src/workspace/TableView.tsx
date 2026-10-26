// Table (D-040): sortable, groupable list of work with bulk actions for admins.
import { useMemo, useState } from "react";
import { type TaskWithStage, useBinAction, useGoals, useLookups, useTasks, useUpdateTask } from "../lib/api.ts";
import { partsOf, RISK_LABEL, rollup } from "../lib/deliverables.ts";
import {formatDate, isOverdue, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { PriorityMark, StatusBadge } from "../components/Badges.tsx";
import { DeleteButton } from "../components/DeleteButton.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useGroupBy, useTaskFilters, useTaskPanel } from "./filters.ts";
import { groupTasks, phaseOf, PHASES, stageStep } from "./phases.ts";

type SortKey = "title" | "phase" | "owner" | "due" | "priority";
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function TableView() {
  const tasks = useTasks();
  const goals = useGoals();
  const { label, memberName, isAdminMember, members, ready } = useLookups();
  const { member: me } = useMember();
  const isAdmin = me.role === "admin";
  const { scope } = useScope();
  const { f } = useTaskFilters();
  const [group] = useGroupBy();
  const panel = useTaskPanel();
  const today = todayInIndia();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const all = (tasks.data ?? []) as TaskWithStage[];

  const items = useMemo(() => {
    const list = all.filter((t) => t.kind !== "deliverable" && matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data }));
    const phaseRank = (t: TaskWithStage) => PHASES.findIndex((p) => p.key === phaseOf(t, isAdminMember));
    const val = (t: TaskWithStage): string | number =>
      sort.key === "title" ? t.title.toLowerCase() : sort.key === "phase" ? phaseRank(t)
      : sort.key === "owner" ? memberName(t.owner_id) : sort.key === "priority" ? PRIORITY_RANK[t.priority ?? ""] ?? 9 : t.due_date ?? "9999-99-99";
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir || a.ref - b.ref);
  }, [all, f, me.id, today, scope, sort, isAdminMember, memberName]);
  const deliverables = all.filter((t) => t.kind === "deliverable" && t.status !== "cancelled");

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;

  const groups = groupTasks(items, group, { all, goals: goals.data ?? [], label, memberName,
    deliverables: deliverables.filter((d) => items.some((p) => p.parent_id === d.id)) });
  const th = (key: SortKey, text: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {text}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const cols = isAdmin ? 9 : 7;

  return (
    <>
      {isAdmin && picked.size > 0 && <BulkBar ids={[...picked]} titleOf={(id) => all.find((t) => t.id === id)?.title ?? "a task"}
        members={(members.data ?? []).filter((m) => m.is_active)} deliverables={deliverables.filter((d) => d.status !== "done" && d.status !== "requested")}
        onKeep={(ids) => setPicked(new Set(ids))} onDone={() => setPicked(new Set())} />}
      {items.length === 0 ? <StatePanel title="Nothing matches these filters" /> : (
        <div className="table-wrap">
          <table className="wtable">
            <thead>
              <tr>
                {isAdmin && <th className="wtable__check"><input type="checkbox" aria-label="Select all shown"
                  checked={picked.size > 0 && picked.size === items.length} onChange={(e) => setPicked(e.target.checked ? new Set(items.map((t) => t.id)) : new Set())} /></th>}
                {th("title", "Task")}{th("phase", "Phase")}<th>Stage</th>{th("owner", "Owner")}{th("due", "Due")}{th("priority", "Priority")}<th>Channel / goal</th>{isAdmin && <th aria-label="Delete" />}
              </tr>
            </thead>
            {groups.map((g) => {
              const r = g.deliverable ? rollup(g.deliverable, partsOf(g.deliverable.id, all), today) : null;
              const closed = collapsed.has(g.key);
              return (
                <tbody key={g.key}>
                  {group !== "none" && (
                    <tr className="wtable__group">
                      <td colSpan={cols}>
                        <button type="button" className="group-toggle" aria-expanded={!closed}
                          onClick={() => setCollapsed((s) => { const n = new Set(s); if (closed) n.delete(g.key); else n.add(g.key); return n; })}>
                          <span className="caret" aria-hidden="true" /> {g.title}
                        </button>
                        <span className="small muted"> · {g.tasks.length}</span>
                        {r && g.deliverable && <>
                          {" "}<span className={`risk risk--${r.risk}`}>{RISK_LABEL[r.risk]}</span>
                          <span className="small"> {r.done}/{r.total - r.cancelled} tasks done</span>
                          <button type="button" className="link small" onClick={() => panel.open(g.deliverable!.ref)}>Open deliverable</button>
                        </>}
                      </td>
                    </tr>
                  )}
                  {!closed && g.tasks.map((t) => {
                    const step = stageStep(t);
                    const phase = PHASES.find((p) => p.key === phaseOf(t, isAdminMember));
                    const goal = goals.data?.find((x) => x.id === t.goal_id);
                    const parent = group !== "deliverable" && t.parent_id ? all.find((x) => x.id === t.parent_id) : undefined;
                    return (
                      <tr key={t.id} className={t.ref === panel.ref ? "is-selected" : undefined}>
                        {isAdmin && <td className="wtable__check"><input type="checkbox" aria-label={`Select ${t.title}`} checked={picked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} /></td>}
                        <td className="wrap">
                          <button type="button" className="link wtable__title" onClick={() => panel.open(t.ref)}>{t.title}</button>
                          {parent && <div className="small muted">↳ {parent.title}</div>}
                        </td>
                        <td>{phase ? phase.label : "—"}{t.status === "blocked" && <span className="flagchip flagchip--blocked">Blocked</span>}
                          {(t.status === "changes_requested" || t.status === "in_review") && <> <StatusBadge code={t.status} label={label("task_status", t.status)} /></>}</td>
                        <td className="small">{step ? `${label("workflow_stage", step.code)} · ${step.step}/${step.of}` : "—"}</td>
                        <td>{memberName(t.task_stages.find((s) => s.state === "active")?.owner_id ?? t.owner_id)}</td>
                        <td className={isOverdue(t.due_date, t.status, today) ? "due--late" : undefined}>{formatDate(t.due_date)}</td>
                        <td><PriorityMark code={t.priority} label={label("priority", t.priority)} /></td>
                        <td className="small">{t.channel ? label("channel", t.channel) : "—"}{goal ? <div className="muted">{goal.title}</div> : null}</td>
                        {isAdmin && <td className="wtable__del"><DeleteButton kind="task" id={t.id} title={t.title} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </>
  );
}

/** Admin bulk actions on the selected rows. Each change goes through the same rules as a single edit;
 *  rows that could not be changed stay selected and are named, with the reason. */
function BulkBar({ ids, titleOf, members, deliverables, onKeep, onDone }: {
  ids: string[]; titleOf: (id: string) => string; members: { id: string; display_name: string }[]; deliverables: TaskWithStage[];
  onKeep: (ids: string[]) => void; onDone: () => void;
}) {
  const update = useUpdateTask();
  const bin = useBinAction();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ title: string; message: string }[]>([]);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [into, setInto] = useState("");

  async function each(fn: (id: string) => Promise<unknown>) {
    setBusy(true); setFailures([]);
    const bad: { id: string; title: string; message: string }[] = [];
    for (const id of ids) {
      try { await fn(id); } catch (e) { bad.push({ id, title: titleOf(id), message: e instanceof Error ? e.message : String(e) }); }
    }
    setBusy(false); setFailures(bad);
    if (bad.length) onKeep(bad.map((b) => b.id)); else { setOwner(""); setDue(""); setInto(""); onDone(); }
  }

  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <span className="bulkbar__item">
        <select disabled={busy} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Assign owner">
          <option value="">Assign to…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <button type="button" className="button button--small" disabled={busy || !owner} onClick={() => each((id) => update.mutateAsync({ id, patch: { owner_id: owner } }))}>Apply</button>
      </span>
      <span className="bulkbar__item">
        <label className="small">Due <input type="date" disabled={busy} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="button" className="button button--small" disabled={busy || !due} onClick={() => each((id) => update.mutateAsync({ id, patch: { due_date: due } }))}>Apply</button>
      </span>
      <span className="bulkbar__item">
        <select disabled={busy} value={into} onChange={(e) => setInto(e.target.value)} aria-label="Move into deliverable">
          <option value="">Move into deliverable…</option>
          <option value="~none">Not part of a deliverable</option>
          {deliverables.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <button type="button" className="button button--small" disabled={busy || !into} onClick={() => each((id) => update.mutateAsync({ id, patch: { parent_id: into === "~none" ? null : into } }))}>Apply</button>
      </span>
      <button type="button" className="button button--small button--quiet button--danger-text" disabled={busy}
        onClick={() => { const reason = window.prompt(`Reason for deleting ${ids.length} task(s)? They go to the Recycle Bin.`); if (reason?.trim()) each((id) => bin.mutateAsync({ fn: "task_remove", args: { p_task: id, p_reason: reason.trim() } })); }}>Delete</button>
      <button type="button" className="link small" onClick={onDone}>Clear selection</button>
      {busy && <span className="small muted">Saving…</span>}
      {failures.length > 0 && (
        <div className="form__error small bulkbar__errors" role="alert">
          {failures.length} could not be changed (still selected):
          <ul>{failures.map((f, i) => <li key={i}><strong>{f.title}</strong> — {f.message}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
