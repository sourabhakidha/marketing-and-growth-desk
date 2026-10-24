import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { matchesFilters, useTaskFilters } from "../workspace/filters.ts";
import { type Goal, type Task, useGoals, useLookups, useTasks, useUpdateTask } from "../lib/api.ts";
import { formatDate, goalRef, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { ErrorText, Field } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";

type EntryKind = "due" | "publish" | "goal_start" | "goal_end";
export interface CalEntry { key: string; date: string; kind: EntryKind; title: string; ref: string; href: string; ownerId: string; status: string; task?: Task; goal?: Goal }

const KIND_LABEL: Record<EntryKind, string> = { due: "Due", publish: "Publish", goal_start: "Goal starts", goal_end: "Goal ends" };
const OVERLOAD = 3;

/** Calendar entries are derived from the task and goal records themselves (Bible §11.1). */
export function buildEntries(tasks: Task[], goals: Goal[], showClosed: boolean): CalEntry[] {
  const out: CalEntry[] = [];
  for (const t of tasks) {
    if (!showClosed && (t.status === "done" || t.status === "cancelled")) continue;
    if (t.due_date) out.push({ key: `${t.id}-due`, date: t.due_date, kind: "due", title: t.title, ref: taskRef(t.ref), href: `/workspace/tasks/${t.ref}`, ownerId: t.owner_id, status: t.status, task: t });
    if (t.publish_date) out.push({ key: `${t.id}-pub`, date: t.publish_date, kind: "publish", title: t.title, ref: taskRef(t.ref), href: `/workspace/tasks/${t.ref}`, ownerId: t.owner_id, status: t.status, task: t });
  }
  for (const g of goals) {
    if (!showClosed && ["achieved", "not_achieved", "cancelled"].includes(g.status)) continue;
    if (g.start_date) out.push({ key: `${g.id}-s`, date: g.start_date, kind: "goal_start", title: g.title, ref: goalRef(g.ref), href: "/workspace/goals", ownerId: g.owner_id, status: g.status, goal: g });
    if (g.end_date) out.push({ key: `${g.id}-e`, date: g.end_date, kind: "goal_end", title: g.title, ref: goalRef(g.ref), href: "/workspace/goals", ownerId: g.owner_id, status: g.status, goal: g });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** People with more than OVERLOAD open tasks due the same day — an indicator, not a capacity measure. */
export function overloads(entries: CalEntry[]): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (e.kind !== "due" || e.status === "done" || e.status === "cancelled") continue;
    const day = counts.get(e.date) ?? new Map<string, number>();
    day.set(e.ownerId, (day.get(e.ownerId) ?? 0) + 1);
    counts.set(e.date, day);
  }
  const out = new Map<string, string[]>();
  for (const [date, byOwner] of counts) {
    const heavy = [...byOwner.entries()].filter(([, n]) => n >= OVERLOAD).map(([o]) => o);
    if (heavy.length) out.set(date, heavy);
  }
  return out;
}

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // weeks start Monday
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return iso(d); });
}

/** Standalone page, or embedded in the Workspace where the shared filters apply and tasks open in the side panel. */
export function Calendar({ embedded = false }: { embedded?: boolean } = {}) {
  const tasks = useTasks();
  const shared = useTaskFilters();
  const [params] = useSearchParams();
  const goals = useGoals();
  const { members, memberName, options, ready } = useLookups();
  const { member: me } = useMember();
  const isAdmin = me.role === "admin";
  const today = todayInIndia();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [view, setView] = useState<"month" | "agenda">("month");
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");
  const [kinds, setKinds] = useState<Record<EntryKind, boolean>>({ due: true, publish: true, goal_start: true, goal_end: true });
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<CalEntry | null>(null);

  const scopedTasks = useMemo(() => (embedded
    ? (tasks.data ?? []).filter((t) => matchesFilters(t, shared.f, { meId: me.id, today }))
    : (tasks.data ?? [])), [embedded, tasks.data, shared.f, me.id, today]);
  const scopedGoals = useMemo(() => (embedded
    ? (goals.data ?? []).filter((g) => (!shared.f.goal || shared.f.goal === g.id) && shared.f.goal !== "none" && (!shared.f.owner || g.owner_id === shared.f.owner)
        && !shared.f.type && !shared.f.priority && !shared.f.q && !shared.f.due && !shared.f.mine)
    : (goals.data ?? [])), [embedded, goals.data, shared.f]);
  const entries = useMemo(() => buildEntries(scopedTasks, scopedGoals, showClosed)
    .filter((e) => kinds[e.kind])
    .filter((e) => !owner || e.ownerId === owner)
    .filter((e) => !type || (e.task && e.task.task_type === type)), [scopedTasks, scopedGoals, showClosed, kinds, owner, type]);
  const heavy = useMemo(() => overloads(entries), [entries]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEntry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [entries]);

  if (tasks.isPending || goals.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load the calendar" tone="error"><p>{tasks.error.message}</p></StatePanel>;

  const days = monthGrid(cursor.y, cursor.m);
  const monthLabel = new Date(Date.UTC(cursor.y, cursor.m, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const move = (delta: number) => setCursor((c) => { const d = new Date(Date.UTC(c.y, c.m + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const agenda = entries.filter((e) => e.date >= today).slice(0, 120);
  const hrefFor = (e: CalEntry) => {
    if (!embedded || !e.task) return e.href;
    const n = new URLSearchParams(params);
    n.set("task", String(e.task.ref));
    n.delete("action");
    return `?${n.toString()}`;
  };

  return (
    <>
      {!embedded && <header className="page-header page-header--row">
        <div>
          <h1>Calendar</h1>
          <p className="muted">Due dates, publish dates and goal timeframes, taken straight from the task and goal records. Changing a date here changes the record.</p>
        </div>
      </header>}

      <div className="filters">
        <div className="segmented" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={view === "month"} className={view === "month" ? "is-on" : ""} onClick={() => setView("month")}>Month</button>
          <button type="button" role="radio" aria-checked={view === "agenda"} className={view === "agenda" ? "is-on" : ""} onClick={() => setView("agenda")}>Upcoming</button>
        </div>
        {!embedded && <>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Everyone</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Task type">
          <option value="">All task types</option>
          {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        </>}
        {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
          <label key={k} className="check"><input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds((p) => ({ ...p, [k]: e.target.checked }))} /> {KIND_LABEL[k]}</label>
        ))}
        <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Include done / cancelled</label>
      </div>

      {view === "month" ? (
        <section className="cal" aria-label={monthLabel}>
          <div className="cal__bar">
            <button type="button" className="button button--small" onClick={() => move(-1)} aria-label="Previous month">←</button>
            <h2>{monthLabel}</h2>
            <button type="button" className="button button--small" onClick={() => move(1)} aria-label="Next month">→</button>
            <button type="button" className="link small" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>Today</button>
          </div>
          <div className="cal__grid" role="grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal__dow" role="columnheader">{d}</div>)}
            {days.map((d) => {
              const items = byDay.get(d) ?? [];
              const overload = heavy.get(d);
              return (
                <div key={d} role="gridcell" className={`cal__day${d.startsWith(monthPrefix) ? "" : " cal__day--out"}${d === today ? " cal__day--today" : ""}`}>
                  <div className="cal__date">{Number(d.slice(8))}
                    {overload && <span className="tag tag--warn" title={`${overload.map(memberName).join(", ")}: ${OVERLOAD}+ tasks due`}>load</span>}
                  </div>
                  {items.slice(0, 4).map((e) => <EntryPill key={e.key} e={e} href={hrefFor(e)} today={today} onEdit={isAdmin && e.task ? () => setEditing(e) : undefined} />)}
                  {items.length > 4 && <button type="button" className="link small" onClick={() => setView("agenda")}>+{items.length - 4} more</button>}
                </div>
              );
            })}
          </div>
          <p className="muted small">“load” marks a day where one person has {OVERLOAD} or more open tasks due — a prompt to check, not a capacity calculation.</p>
        </section>
      ) : (
        <section className="card">
          {agenda.length === 0 ? <p className="muted">Nothing scheduled from today onward.</p> : (
            <ol className="agenda">
              {agenda.map((e, i) => (
                <li key={e.key}>
                  {(i === 0 || agenda[i - 1]!.date !== e.date) && <h3 className="agenda__date">{formatDate(e.date)}{e.date === today && " · Today"}</h3>}
                  <div className="agenda__row">
                    <span className={`kind kind--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    <Link to={hrefFor(e)}><span className="ref">{e.ref}</span> {e.title}</Link>
                    <span className="muted small">{memberName(e.ownerId)}</span>
                    {isAdmin && e.task && <button type="button" className="link small" onClick={() => setEditing(e)}>Reschedule</button>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {editing?.task && <Reschedule entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EntryPill({ e, href, today, onEdit }: { e: CalEntry; href: string; today: string; onEdit?: () => void }) {
  const late = e.kind === "due" && isOverdue(e.date, e.status, today);
  return (
    <div className={`pill-entry kind--${e.kind}${late ? " pill-entry--late" : ""}${e.status === "done" || e.status === "cancelled" ? " pill-entry--closed" : ""}`}>
      <Link to={href} title={`${KIND_LABEL[e.kind]}: ${e.title}`}><strong>{KIND_LABEL[e.kind]}</strong> {e.title}</Link>
      {onEdit && <button type="button" className="icon-button icon-button--tiny" aria-label={`Reschedule ${e.title}`} onClick={onEdit}>✎</button>}
    </div>
  );
}

function Reschedule({ entry, onClose }: { entry: CalEntry; onClose: () => void }) {
  const t = entry.task!;
  const update = useUpdateTask();
  const [due, setDue] = useState(t.due_date ?? "");
  const [publish, setPublish] = useState(t.publish_date ?? "");
  return (
    <Modal title={`Reschedule ${taskRef(t.ref)}`} open onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t.title}. The change is saved on the task and recorded in its history.</p>
        <Field label="Due date"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Publish date"><input type="date" value={publish} onChange={(e) => setPublish(e.target.value)} /></Field>
        <ErrorText error={update.error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button button--primary" disabled={update.isPending}
            onClick={() => update.mutate({ id: t.id, patch: { due_date: due || null, publish_date: publish || null } }, { onSuccess: onClose })}>
            {update.isPending ? "Saving…" : "Save dates"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
