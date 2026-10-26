// One person's workday (D-046): working hours, check-in/out, the planned blocks and what was
// actually worked, side by side on a day calendar. Used for "My day" (self) and by admins in
// "Team plans", where changes become suggestions the person accepts.
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type PlanItem, type TaskSession, type TaskWithStage, useLookups, useOpsAction, usePlanItems, useSessions, useTasks, useWorkDays } from "../lib/api.ts";
import { addDays, weekStart } from "../lib/dateRange.ts";
import { formatDate, todayInIndia } from "../lib/format.ts";
import { hhmm, hours, istClock, istMinutes, minutesOf, sessionMs } from "../lib/ops.ts";
import { useMember } from "../lib/session.tsx";
import { ErrorText, Field } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading } from "../components/States.tsx";
import { useTaskPanel } from "../workspace/filters.ts";

const PX_PER_HOUR = 52;
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" });

export function DayPlanner({ memberId, day, setDay }: { memberId: string; day: string; setDay: (d: string) => void }) {
  const { member: me } = useMember();
  const { memberName } = useLookups();
  const isSelf = memberId === me.id;
  const today = todayInIndia();
  const week = weekStart(day);
  const days = useWorkDays(week, addDays(week, 6));
  const plan = usePlanItems(week, addDays(week, 6));
  const sessions = useSessions(addDays(week, -1), addDays(week, 6));
  const tasks = useTasks();
  const act = useOpsAction();
  const panel = useTaskPanel();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [punchTask, setPunchTask] = useState("");
  const [outNote, setOutNote] = useState("");

  const w = (days.data ?? []).find((x) => x.member_id === memberId && x.day === day);
  const blocks = (plan.data ?? []).filter((p) => p.member_id === memberId && p.day === day);
  const mySessions = (sessions.data ?? []).filter((s) => s.member_id === memberId && s.day === day);
  const openSession = (sessions.data ?? []).find((s) => s.member_id === memberId && !s.ended_at);
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const title = (id: string | null) => (id ? taskById.get(id)?.title ?? "A task" : "");
  const canEdit = day >= today;               // past days are a record
  const suggestions = blocks.filter((b) => b.suggested && !b.accepted_at);
  const workable = useMemo(() => workableTasks(tasks.data ?? [], memberId), [tasks.data, memberId]);

  if (days.isPending || plan.isPending || sessions.isPending || tasks.isPending) return <Loading />;

  // calendar window: planned hours, or 9–19, widened to fit anything recorded
  const ps = minutesOf(w?.planned_start), pe = minutesOf(w?.planned_end);
  const marks = [ps, pe, ...blocks.flatMap((b) => [minutesOf(b.starts_at), minutesOf(b.ends_at)]),
    ...mySessions.flatMap((s) => [istMinutes(s.started_at), s.ended_at ? istMinutes(s.ended_at) : day === today ? istMinutes(new Date(now).toISOString()) : NaN]),
    w?.checked_in_at ? istMinutes(w.checked_in_at) : NaN, w?.checked_out_at ? istMinutes(w.checked_out_at) : NaN].filter(Number.isFinite);
  const startH = Math.max(0, Math.floor(Math.min(9 * 60, ...marks) / 60));
  const endH = Math.min(24, Math.ceil(Math.max(19 * 60, ...marks) / 60));
  const y = (min: number) => ((min - startH * 60) / 60) * PX_PER_HOUR;
  const heightPx = (endH - startH) * PX_PER_HOUR;
  const nowMin = istMinutes(new Date(now).toISOString());

  const workedMs = w?.checked_in_at ? (w.checked_out_at ? Date.parse(w.checked_out_at) : day === today ? now : NaN) - Date.parse(w.checked_in_at) : NaN;
  const taskMs = mySessions.reduce((n, s) => n + sessionMs(s, now), 0);
  const checkedIn = Boolean(w?.checked_in_at && !w.checked_out_at);

  return (
    <div className="dp">
      <nav className="dp-week" aria-label="Choose a day">
        <button type="button" className="icon-button" aria-label="Previous week" onClick={() => setDay(addDays(week, -7))}>‹</button>
        {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => {
          const has = (plan.data ?? []).some((p) => p.member_id === memberId && p.day === d) || (days.data ?? []).some((x) => x.member_id === memberId && x.day === d && (x.checked_in_at || x.planned_start));
          return (
            <button key={d} type="button" className={`dp-week__day${d === day ? " is-on" : ""}${d === today ? " is-today" : ""}`} onClick={() => setDay(d)} aria-pressed={d === day}>
              <span className="small">{WEEKDAY.format(new Date(`${d}T12:00:00+05:30`))}</span>
              <strong>{Number(d.slice(8))}</strong>
              {has && <span className="dp-week__dot" aria-label="has a plan or record" />}
            </button>
          );
        })}
        <button type="button" className="icon-button" aria-label="Next week" onClick={() => setDay(addDays(week, 7))}>›</button>
        {day !== today && <button type="button" className="link small" onClick={() => setDay(today)}>Today</button>}
      </nav>

      <section className="card dp-status" aria-label="The day">
        <div className="dp-status__main">
          <h2>{isSelf ? (day === today ? "Your day" : formatDate(day)) : `${memberName(memberId)} · ${formatDate(day)}`}</h2>
          <p className="small muted">
            Working hours: <strong>{w?.planned_start ? `${w.planned_start.slice(0, 5)} – ${w.planned_end!.slice(0, 5)}` : "not set"}</strong>
            {w?.plan_changed_by && w.plan_changed_by !== memberId && <> · set by {memberName(w.plan_changed_by)}</>}
            {canEdit && <> · <button type="button" className="link" onClick={() => { act.reset(); setHoursOpen(true); }}>{w?.planned_start ? "Change" : "Set hours"}</button></>}
          </p>
          <p className="small">
            Checked in <strong>{istClock(w?.checked_in_at)}</strong> · checked out <strong>{w?.checked_out_at ? istClock(w.checked_out_at) : checkedIn && day !== today ? "missing" : "—"}</strong>
            {Number.isFinite(workedMs) && <> · worked <strong>{hours(workedMs)} h</strong></>} · on tasks <strong>{hours(taskMs)} h</strong>
          </p>
        </div>
        {isSelf && day === today && (
          <div className="dp-status__actions">
            {!checkedIn
              ? <button type="button" className="button button--primary" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_check_in", args: {} })}>{w?.checked_out_at ? "Check in again" : "Check in"}</button>
              : <button type="button" className="button" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_check_out", args: {} })}>Check out</button>}
          </div>
        )}
      </section>

      {isSelf && day === today && (
        <section className={`card dp-punch${openSession ? " is-live" : ""}`} aria-label="Punch in on a task">
          {openSession ? (
            <>
              <p><span className="dp-live" aria-hidden="true" /> Working on <button type="button" className="link" onClick={() => { const t = taskById.get(openSession.task_id); if (t) panel.open(t.ref); }}><strong>{title(openSession.task_id)}</strong></button> since {istClock(openSession.started_at)} · {hours(sessionMs(openSession, now))} h</p>
              <div className="dp-punch__row">
                <input value={outNote} onChange={(e) => setOutNote(e.target.value)} placeholder="Note (optional): what got done" aria-label="Note for this session" />
                <button type="button" className="button" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_punch_out", args: { p_note: outNote || null } }, { onSuccess: () => setOutNote("") })}>Punch out</button>
              </div>
            </>
          ) : <p className="small muted">Not punched in on a task. Punch in from a planned block below, or pick any task:</p>}
          <div className="dp-punch__row">
            <select value={punchTask} onChange={(e) => setPunchTask(e.target.value)} aria-label="Task to punch in on">
              <option value="">Choose a task…</option>
              <TaskOptions tasks={workable} />
            </select>
            <button type="button" className="button button--primary" disabled={!punchTask || act.isPending}
              onClick={() => act.mutate({ fn: "ops_punch_in", args: { p_task: punchTask, p_plan_item: null } }, { onSuccess: () => setPunchTask("") })}>
              {openSession ? "Switch to this task" : "Punch in"}
            </button>
          </div>
          <p className="small muted">Times are stamped automatically. Punching in also checks you in; switching tasks punches you out of the last one.</p>
        </section>
      )}
      <ErrorText error={act.error} />

      {suggestions.length > 0 && (
        <div className="dp-suggest" role="status">
          <span>{isSelf ? `${suggestions.length} block${suggestions.length > 1 ? "s were" : " was"} suggested by ${memberName(suggestions[0]!.updated_by ?? suggestions[0]!.created_by)}.` : `${suggestions.length} suggested block${suggestions.length > 1 ? "s" : ""} not accepted yet.`}</span>
          {isSelf && <button type="button" className="button button--small button--primary" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_plan_accept", args: { p_day: day } })}>Accept</button>}
        </div>
      )}

      <section className="card" aria-labelledby="dp-cal">
        <div className="dp-head">
          <div>
            <h2 id="dp-cal">Plan and actual</h2>
            <p className="small muted">{canEdit ? "Plan blocks inside the working hours. Select a block to change it." : "A past day: shown as recorded."}</p>
          </div>
          {canEdit && <button type="button" className="button button--small" disabled={!w?.planned_start} title={w?.planned_start ? undefined : "Set working hours first"} onClick={() => { act.reset(); setEditing("new"); }}>+ Plan a block</button>}
        </div>
        <div className="dp-cal" style={{ height: heightPx + 28 }}>
          <div className="dp-cal__hours" aria-hidden="true">
            {Array.from({ length: endH - startH + 1 }, (_, i) => <span key={i} style={{ top: i * PX_PER_HOUR + 22 }}>{hhmm((startH + i) * 60)}</span>)}
          </div>
          {(["plan", "actual"] as const).map((col) => (
            <div key={col} className="dp-cal__col">
              <p className="dp-cal__title">{col === "plan" ? "Plan" : "Actual"}</p>
              <div className="dp-cal__body" style={{ height: heightPx }}>
                {Array.from({ length: endH - startH }, (_, i) => <span key={i} className="dp-cal__line" style={{ top: i * PX_PER_HOUR }} />)}
                {Number.isFinite(ps) && <span className="dp-cal__hoursband" style={{ top: y(ps), height: y(pe) - y(ps) }} />}
                {day === today && nowMin >= startH * 60 && nowMin <= endH * 60 && <span className="dp-cal__now" style={{ top: y(nowMin) }} />}
                {col === "plan" && blocks.map((b) => (
                  <PlanBlock key={b.id} b={b} top={y(minutesOf(b.starts_at))} height={y(minutesOf(b.ends_at)) - y(minutesOf(b.starts_at))}
                    label={b.task_id ? title(b.task_id) : b.title ?? ""} worked={mySessions.some((s) => s.task_id === b.task_id)}
                    onOpen={canEdit ? () => { act.reset(); setEditing(b); } : undefined} />
                ))}
                {col === "actual" && <Actual sessions={mySessions} y={y} now={now} today={day === today} title={title}
                  checkIn={w?.checked_in_at ?? null} checkOut={w?.checked_out_at ?? null} />}
              </div>
            </div>
          ))}
        </div>

        <ul className="dp-list" aria-label="Planned blocks">
          {blocks.length === 0 && <li className="small muted">Nothing planned{canEdit ? " yet" : ""}.</li>}
          {blocks.map((b) => (
            <li key={b.id}>
              <span className="dp-list__time">{b.starts_at.slice(0, 5)}–{b.ends_at.slice(0, 5)}</span>
              <span className="dp-list__what">{b.task_id ? title(b.task_id) : b.title}{b.suggested && <span className={`chip${b.accepted_at ? "" : " chip--warn"}`}>{b.accepted_at ? "suggested · accepted" : "suggested"}</span>}</span>
              {isSelf && day === today && b.task_id && openSession?.task_id !== b.task_id && (
                <button type="button" className="button button--small" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_punch_in", args: { p_task: b.task_id!, p_plan_item: b.id } })}>Punch in</button>
              )}
              {canEdit && <button type="button" className="link small" onClick={() => { act.reset(); setEditing(b); }}>Edit</button>}
            </li>
          ))}
        </ul>
      </section>

      {hoursOpen && <HoursDialog memberId={memberId} day={day} start={w?.planned_start ?? "10:00"} end={w?.planned_end ?? "18:30"} onClose={() => setHoursOpen(false)} />}
      {editing && <BlockDialog memberId={memberId} day={day} item={editing === "new" ? null : editing} tasks={workable} isSelf={isSelf}
        hours={[w?.planned_start ?? "", w?.planned_end ?? ""]} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Tasks a person can plan or punch in on: open work, theirs first (owner or current step), then everyone else's. */
export function workableTasks(all: TaskWithStage[], memberId: string) {
  const parents = new Set(all.filter((t) => t.parent_id && !t.removed_at).map((t) => t.parent_id));
  const open = all.filter((t) => !t.removed_at && !["done", "cancelled", "requested"].includes(t.status) && !(t.kind === "deliverable" && parents.has(t.id)));
  const mine = (t: TaskWithStage) => t.owner_id === memberId || t.task_stages.some((s) => s.state === "active" && s.owner_id === memberId);
  return { mine: open.filter(mine), others: open.filter((t) => !mine(t)) };
}

function TaskOptions({ tasks }: { tasks: ReturnType<typeof workableTasks> }) {
  return (
    <>
      {tasks.mine.length > 0 && <optgroup label="Assigned to them">{tasks.mine.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>}
      {tasks.others.length > 0 && <optgroup label="Other open work">{tasks.others.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>}
    </>
  );
}

function PlanBlock({ b, top, height, label, worked, onOpen }: { b: PlanItem; top: number; height: number; label: string; worked: boolean; onOpen?: () => void }) {
  const cls = `dp-block${b.task_id ? "" : " dp-block--other"}${b.suggested && !b.accepted_at ? " dp-block--suggested" : ""}${worked ? " dp-block--worked" : ""}`;
  const body = <><span className="dp-block__time">{b.starts_at.slice(0, 5)}–{b.ends_at.slice(0, 5)}</span><span className="dp-block__label">{label}</span></>;
  return onOpen
    ? <button type="button" className={cls} style={{ top, height: Math.max(18, height - 2) }} onClick={onOpen} title={label}>{body}</button>
    : <div className={cls} style={{ top, height: Math.max(18, height - 2) }} title={label}>{body}</div>;
}

function Actual({ sessions, y, now, today, title, checkIn, checkOut }: {
  sessions: TaskSession[]; y: (m: number) => number; now: number; today: boolean; title: (id: string) => string; checkIn: string | null; checkOut: string | null;
}) {
  const nowIso = new Date(now).toISOString();
  return (
    <>
      {checkIn && <span className="dp-mark" style={{ top: y(istMinutes(checkIn)) }}>In {istClock(checkIn)}</span>}
      {checkOut && <span className="dp-mark dp-mark--out" style={{ top: y(istMinutes(checkOut)) }}>Out {istClock(checkOut)}</span>}
      {sessions.map((s) => {
        const a = istMinutes(s.started_at);
        const b = s.ended_at ? istMinutes(s.ended_at) : today ? istMinutes(nowIso) : a;
        return (
          <div key={s.id} className={`dp-block dp-block--session${s.ended_at ? "" : " is-live"}`} style={{ top: y(a), height: Math.max(14, y(b) - y(a) - 2) }}
            title={`${title(s.task_id)} · ${istClock(s.started_at)}–${s.ended_at ? istClock(s.ended_at) : "now"}${s.note ? ` · ${s.note}` : ""}`}>
            <span className="dp-block__time">{istClock(s.started_at)}–{s.ended_at ? istClock(s.ended_at) : "now"}</span>
            <span className="dp-block__label">{title(s.task_id)}</span>
          </div>
        );
      })}
    </>
  );
}

function HoursDialog({ memberId, day, start, end, onClose }: { memberId: string; day: string; start: string; end: string; onClose: () => void }) {
  const act = useOpsAction();
  const [s, setS] = useState(start.slice(0, 5));
  const [e, setE] = useState(end.slice(0, 5));
  function submit(ev: FormEvent) {
    ev.preventDefault();
    act.mutate({ fn: "ops_set_hours", args: { p_member: memberId, p_day: day, p_start: s, p_end: e } }, { onSuccess: onClose });
  }
  return (
    <Modal title={`Working hours · ${formatDate(day)}`} open onClose={onClose}>
      <form className="grid-form" onSubmit={submit}>
        <Field label="From" required><input type="time" value={s} onChange={(x) => setS(x.target.value)} required /></Field>
        <Field label="To" required><input type="time" value={e} onChange={(x) => setE(x.target.value)} required /></Field>
        <p className="small muted field--wide">Planned blocks must fit inside these hours. Check-in and check-out are recorded separately when they happen.</p>
        <div className="field--wide"><ErrorText error={act.error} />
          <div className="form__actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={act.isPending}>Save hours</button></div>
        </div>
      </form>
    </Modal>
  );
}

function BlockDialog({ memberId, day, item, tasks, isSelf, hours: [hs, he], onClose }: {
  memberId: string; day: string; item: PlanItem | null; tasks: ReturnType<typeof workableTasks>; isSelf: boolean; hours: [string, string]; onClose: () => void;
}) {
  const act = useOpsAction();
  const [kind, setKind] = useState<"task" | "other">(item && !item.task_id ? "other" : "task");
  const [task, setTask] = useState(item?.task_id ?? "");
  const [what, setWhat] = useState(item?.title ?? "");
  const [s, setS] = useState(item?.starts_at.slice(0, 5) ?? hs.slice(0, 5));
  const [e, setE] = useState(item?.ends_at.slice(0, 5) ?? hhmm(Math.min(minutesOf(hs) + 60, minutesOf(he))));
  function submit(ev: FormEvent) {
    ev.preventDefault();
    act.mutate({ fn: "ops_plan_save", args: { p_id: item?.id ?? null, p_member: memberId, p_day: day, p_task: kind === "task" ? task || null : null, p_title: kind === "other" ? what : null, p_start: s, p_end: e } }, { onSuccess: onClose });
  }
  return (
    <Modal title={item ? "Planned block" : "Plan a block"} open onClose={onClose}>
      <form className="grid-form" onSubmit={submit}>
        {!isSelf && <p className="small field--wide dp-note">Your change is sent as a suggestion; they accept it from their day.</p>}
        <div className="field--wide run-choice" role="radiogroup" aria-label="What the block is">
          <label className={`run-option${kind === "task" ? " is-on" : ""}`}><input type="radio" checked={kind === "task"} onChange={() => setKind("task")} /><span><strong>A task</strong></span></label>
          <label className={`run-option${kind === "other" ? " is-on" : ""}`}><input type="radio" checked={kind === "other"} onChange={() => setKind("other")} /><span><strong>Something else</strong><span className="small muted">A meeting, review, break…</span></span></label>
        </div>
        {kind === "task"
          ? <Field label="Task" required wide><select value={task} onChange={(x) => setTask(x.target.value)}><option value="">Choose…</option><TaskOptions tasks={tasks} /></select></Field>
          : <Field label="What" required wide><input value={what} onChange={(x) => setWhat(x.target.value)} placeholder="e.g. Team sync" /></Field>}
        <Field label="From" required hint={`Hours ${hs.slice(0, 5)}–${he.slice(0, 5)}`}><input type="time" value={s} onChange={(x) => setS(x.target.value)} required /></Field>
        <Field label="To" required><input type="time" value={e} onChange={(x) => setE(x.target.value)} required /></Field>
        <div className="field--wide"><ErrorText error={act.error} />
          <div className="form__actions">
            {item && <button type="button" className="button button--quiet button--danger-text" disabled={act.isPending} onClick={() => act.mutate({ fn: "ops_plan_remove", args: { p_id: item.id } }, { onSuccess: onClose })}>Remove</button>}
            <button type="button" className="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={act.isPending || (kind === "task" ? !task : !what.trim())}>{isSelf ? "Save" : "Suggest"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
