// Deliverable journey page (D-045): the whole story of one deliverable — how it was produced,
// who did each step and when, how long work waited, worked and sat in review, where it was
// late or reworked and where it went well — as a flow diagram, a timeline by person, a time
// split, a scorecard, a per-person table and the activity log.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { type TaskEvent, useEventsFor, useGoals, useLookups, useStagesFor, useTasks } from "../lib/api.ts";
import { partsOf } from "../lib/deliverables.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { indiaDate } from "../lib/dateRange.ts";
import { buildJourney, type Journey, type JourneyTask, pos, toDays } from "../lib/journey.ts";
import { useMember } from "../lib/session.tsx";
import { StatusBadge } from "../components/Badges.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { initials } from "./Board.tsx";
import { useTaskPanel } from "./filters.ts";
import { NewTaskModal } from "./Hierarchy.tsx";
import { EVENT_TEXT } from "./TaskDetail.tsx";

const fin = Number.isFinite;
const d1 = (milli: number) => { const d = toDays(milli); return d === 0 && milli > 0 ? "<0.1 d" : `${d} d`; };
const hoursOrDays = (milli: number) => milli < 86_400_000 ? `${Math.max(0, Math.round(milli / 3_600_000))} h` : `${toDays(milli)} d`;

export function DeliverableJourneyPage() {
  const ref = Number(useParams().ref);
  const tasks = useTasks();
  const goals = useGoals();
  const { label, memberName, options, ready } = useLookups();
  const { member } = useMember();
  const panel = useTaskPanel();
  const [adding, setAdding] = useState(false);
  const d = (tasks.data ?? []).find((t) => t.ref === ref && t.kind === "deliverable");
  const parts = useMemo(() => (d ? partsOf(d.id, tasks.data ?? []) : []), [d, tasks.data]);
  const ids = useMemo(() => (d ? [d.id, ...parts.map((p) => p.id)] : []), [d, parts]);
  const stages = useStagesFor(ids);
  const events = useEventsFor(ids);
  const steps = options("workflow_stage");

  const j = useMemo(() => d && stages.data && events.data
    ? buildJourney({ deliverable: d, parts, stages: stages.data, events: events.data,
      stepRank: (c) => { const i = steps.findIndex((o) => o.code === c); return i < 0 ? 900 : i; }, stepLabel: (c) => label("workflow_stage", c) })
    : null, [d, parts, stages.data, events.data, steps, label]);

  if (tasks.isPending || !ready) return <Loading />;
  if (!d) return <StatePanel title="Deliverable not found"><p><Link to="/workspace/deliverables">Back to deliverables</Link></p></StatePanel>;
  if (stages.isError || events.isError) return <StatePanel title="Could not load the journey" tone="error"><p>{(stages.error ?? events.error)?.message}</p></StatePanel>;
  if (!j) return <Loading />;

  const goal = goals.data?.find((g) => g.id === d.goal_id);
  const done = j.tasks.filter((x) => x.task.status === "done").length;
  const judged = j.tasks.filter((x) => x.daysLate !== null);
  const onTime = judged.filter((x) => x.daysLate! <= 0).length;
  const elapsed = (fin(j.finished) ? j.finished : j.now) - Math.min(...j.tasks.map((x) => x.ready).filter(fin), Date.parse(d.created_at));
  const rework = j.tasks.reduce((n, x) => n + x.rework, 0);
  const takesTasks = !d.removed_at && !["requested", "done", "cancelled"].includes(d.status);

  return (
    <div className="jr">
      <header className="jr__head">
        <div className="jr__headtext">
          <p className="crumbs"><Link to="/workspace/deliverables">Deliverables</Link> / Journey</p>
          <h2 className="jr__title">{d.title}</h2>
          <p className="jr__meta">
            <span className="chip">{j.mode === "workflow" ? `Workflow · ${j.tasks.length} task${j.tasks.length === 1 ? "" : "s"}` : "Standalone"}</span>
            <StatusBadge code={d.status} label={label("task_status", d.status)} />
            {goal && <span>Goal: <Link to={`/goals#goal-${goal.ref}`}>{goal.title}</Link></span>}
            <span>Owner {memberName(d.owner_id)}</span>
            {j.deadline && <span>Due {formatDate(d.publish_date ?? d.due_date)}</span>}
          </p>
        </div>
        <div className="jr__headside">
          <span className={`jr__verdict jr__verdict--${j.verdict.tone}`}>{j.verdict.text}</span>
          <div className="row-actions">
            <button type="button" className="button button--small" onClick={() => panel.open(d.ref)}>Open details</button>
            {takesTasks && <button type="button" className="button button--small" onClick={() => setAdding(true)}>{member.role === "admin" ? "+ Add task" : "+ Request a task"}</button>}
          </div>
        </div>
      </header>

      <ul className="wov__kpis jr__kpis">
        <Kpi k="Tasks done" v={`${done}/${j.tasks.length}`} sub={j.mode === "standalone" ? "done by one person" : `${j.columns.length} step${j.columns.length === 1 ? "" : "s"}`} />
        <Kpi k="People" v={j.people.length} sub={j.people.map((p) => memberName(p.id).split(" ")[0]).join(", ")} />
        <Kpi k={fin(j.finished) ? "Took" : "Running for"} v={d1(elapsed)} sub="from hand-over to approval" />
        <Kpi k="Working" v={d1(j.split.workMs)} sub={`waiting ${d1(j.split.waitMs)} · review ${d1(j.split.reviewMs)}`} />
        <Kpi k="On time" v={judged.length ? `${onTime}/${judged.length}` : "—"} sub={judged.length ? "approved tasks with a due date" : "nothing approved with a due date"} />
        <Kpi k="Rework" v={rework} sub={rework ? "rounds of changes" : "approved first time"} />
      </ul>

      <section className="card" aria-labelledby="jr-flow">
        <h2 id="jr-flow">How it flowed</h2>
        <p className="small muted">Each column is a step, in order. The arrows show the time from one step finishing to the next being picked up.</p>
        <Flow j={j} />
      </section>

      <section className="card" aria-labelledby="jr-time">
        <div className="jr__sechead">
          <div>
            <h2 id="jr-time">Timeline by person</h2>
            <p className="small muted">Who did what, and when. Select a bar to open the task.</p>
          </div>
          <ul className="wov__legend" aria-label="Timeline key">
            <li><span className="jr__sw jr__sw--wait" aria-hidden="true" />Waiting to start</li>
            <li><span className="jr__sw jr__sw--work" aria-hidden="true" />Working</li>
            <li><span className="jr__sw jr__sw--review" aria-hidden="true" />In review</li>
            <li><span className="jr__due" aria-hidden="true">◆</span>Due date</li>
            <li><span className="jr__sw jr__sw--deadline" aria-hidden="true" />Deliverable date</li>
          </ul>
        </div>
        <Swimlanes j={j} />
      </section>

      <div className="wov__cols wov__cols--even">
        <section className="card" aria-labelledby="jr-split">
          <h2 id="jr-split">Where the time went</h2>
          <p className="small muted">All tasks added together. Waiting includes the time between one step finishing and the next being picked up.</p>
          <TimeSplit j={j} />
        </section>
        <section className="card" aria-labelledby="jr-people">
          <h2 id="jr-people">Who did what</h2>
          <div className="table-wrap">
            <table className="wtable wov__people">
              <thead><tr><th>Person</th><th>Steps</th><th>Tasks</th><th>Working</th><th>Waiting</th><th>Review</th><th>On time</th><th>Rework</th></tr></thead>
              <tbody>
                {j.people.map((p) => (
                  <tr key={p.id}>
                    <td>{memberName(p.id)}</td>
                    <td className="wrap">{p.steps.map((c) => label("workflow_stage", c)).join(", ") || "—"}</td>
                    <td>{p.tasks}</td><td>{d1(p.workMs)}</td><td>{d1(p.waitMs)}</td><td>{d1(p.reviewMs)}</td>
                    <td>{p.onTime + p.late ? `${p.onTime}/${p.onTime + p.late}` : "—"}</td><td>{p.rework}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="wov__cols wov__cols--even">
        <Points title="What went well" tone="good" items={j.wentWell} empty="Nothing to call out yet — it shows once steps are picked up and approved." />
        <Points title="Where we lost time" tone="bad" items={j.lostTime} empty="No delays, waits or rework recorded." />
      </div>

      <section className="card" aria-labelledby="jr-log">
        <h2 id="jr-log">Activity, step by step</h2>
        <p className="small muted">Every recorded action on the deliverable and its tasks, oldest first.</p>
        <Log events={events.data ?? []} titles={new Map(ids.map((id) => [id, id === d.id ? d.title : parts.find((p) => p.id === id)?.title ?? ""]))} deliverableId={d.id} />
      </section>
      {adding && <NewTaskModal parent={d} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string | number; sub: string }) {
  return <li className="wov__kpi"><div><span className="wov__k">{k}</span><strong className="wov__v">{v}</strong><span className="wov__sub">{sub}</span></div></li>;
}

function stateOf(x: JourneyTask): { key: string; text: string } {
  const s = x.task.status;
  if (s === "done") return x.daysLate === null ? { key: "done", text: "Approved" } : x.daysLate > 0 ? { key: "late", text: `${x.daysLate} d late` } : { key: "done", text: x.daysLate < 0 ? `${-x.daysLate} d early` : "On time" };
  if (s === "blocked") return { key: "blocked", text: "Blocked" };
  if (s === "in_review") return { key: "review", text: "In review" };
  if (s === "requested") return { key: "todo", text: "Requested" };
  if (x.overdueOpen) return { key: "late", text: "Overdue" };
  return fin(x.started) ? { key: "doing", text: "In progress" } : { key: "todo", text: "Not started" };
}

function Flow({ j }: { j: Journey }) {
  const { label, memberName } = useLookups();
  const panel = useTaskPanel();
  if (!j.tasks.length) return <p className="small muted">No tasks yet.</p>;
  return (
    <div className="jr-flow" role="list">
      {j.columns.map((c, i) => {
        const h = i > 0 ? j.handovers[i - 1]! : null;
        return (
          <div key={c.step ?? "none"} className="jr-flow__pair" role="listitem">
            {h && (
              <div className="jr-flow__link" aria-label={fin(h.gapMs) ? (h.gapMs < 0 ? "steps overlapped" : `${hoursOrDays(h.gapMs)} between steps`) : "not reached yet"}>
                <span className={`jr-flow__gap${fin(h.gapMs) && h.gapMs >= 86_400_000 ? " is-slow" : ""}`}>
                  {fin(h.gapMs) ? (h.gapMs < 0 ? "overlap" : hoursOrDays(h.gapMs)) : "…"}
                </span>
                <span className="jr-flow__arrow" aria-hidden="true" />
              </div>
            )}
            <div className="jr-flow__col">
              <p className="jr-flow__step"><span className="step-pick__n">{i + 1}</span>{c.step ? label("workflow_stage", c.step) : j.mode === "standalone" ? "Whole deliverable" : "No step"}</p>
              {c.tasks.map((x) => {
                const st = stateOf(x);
                return (
                  <button key={x.task.id} type="button" className={`jr-node jr-node--${st.key}`} onClick={() => panel.open(x.task.ref)}>
                    <span className="jr-node__title">{x.task.title}</span>
                    <span className="jr-node__who"><span className="avatar" aria-hidden="true">{initials(memberName(x.person))}</span>{memberName(x.person)}</span>
                    <span className="jr-node__dates small">
                      {fin(x.started) ? `Started ${formatDate(indiaDate(new Date(x.started).toISOString()))}` : "Not started"}
                      {fin(x.finished) ? ` · approved ${formatDate(indiaDate(new Date(x.finished).toISOString()))}` : x.task.due_date ? ` · due ${formatDate(x.task.due_date)}` : ""}
                    </span>
                    <span className="jr-node__foot small">
                      <span className={`jr-node__state jr-node__state--${st.key}`}>{st.text}</span>
                      {x.workMs > 0 && <span>{hoursOrDays(x.workMs)} work</span>}
                      {x.rework > 0 && <span>↺ {x.rework}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Swimlanes({ j }: { j: Journey }) {
  const { memberName } = useLookups();
  const panel = useTaskPanel();
  const lanes = j.people.map((p) => ({ id: p.id, tasks: j.tasks.filter((x) => x.person === p.id) }));
  // date ticks: about 8 across the span, on India calendar days
  const span = j.end - j.start;
  const stepDays = Math.max(1, Math.ceil(span / 86_400_000 / 8));
  const ticks: number[] = [];
  const first = Date.parse(`${indiaDate(new Date(j.start).toISOString())}T00:00:00+05:30`);
  for (let t = first; t <= j.end; t += stepDays * 86_400_000) if (t >= j.start) ticks.push(t);
  const seg = (a: number, b: number, cls: string, title: string) => fin(a) && fin(b) && b > a
    ? <span className={`jr-seg ${cls}`} style={{ left: `${pos(j, a)}%`, width: `${Math.max(0.6, pos(j, b) - pos(j, a))}%` }} title={title} /> : null;
  if (!j.tasks.length) return <p className="small muted">No tasks yet.</p>;
  return (
    <div className="jr-lanes">
      <div className="jr-lanes__axis" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ left: `${pos(j, t)}%` }}>{formatDate(indiaDate(new Date(t).toISOString())).replace(/\s\d{4}$/, "")}</span>)}
      </div>
      {lanes.map((l) => (
        <div key={l.id} className="jr-lane">
          <div className="jr-lane__who"><span className="avatar" aria-hidden="true">{initials(memberName(l.id))}</span>{memberName(l.id)}</div>
          <div className="jr-lane__track">
            {ticks.map((t) => <span key={t} className="jr-lane__grid" style={{ left: `${pos(j, t)}%` }} aria-hidden="true" />)}
            {j.deadline !== null && <span className="jr-lane__deadline" style={{ left: `${pos(j, j.deadline)}%` }} aria-hidden="true" />}
            <span className="jr-lane__now" style={{ left: `${pos(j, j.now)}%` }} aria-hidden="true" />
            {l.tasks.map((x) => {
              const workEnd = fin(x.submitted) ? x.submitted : fin(x.finished) ? x.finished : j.now;
              const reviewEnd = fin(x.finished) ? x.finished : j.now;
              return (
                <button key={x.task.id} type="button" className="jr-bar" onClick={() => panel.open(x.task.ref)}
                  aria-label={`${x.task.title}: waited ${d1(x.waitMs)}, worked ${d1(x.workMs)}, in review ${d1(x.reviewMs)}`}>
                  {seg(x.waitFrom, fin(x.started) ? x.started : fin(x.finished) ? x.finished : j.now, "jr-seg--wait", `${x.task.title} — waiting to start`)}
                  {seg(x.started, workEnd, "jr-seg--work", `${x.task.title} — working`)}
                  {seg(x.submitted, reviewEnd, "jr-seg--review", `${x.task.title} — in review`)}
                  {x.due !== null && <span className="jr-bar__due" style={{ left: `${pos(j, x.due)}%` }} title={`Due ${formatDate(x.task.due_date)}`}>◆</span>}
                  <span className="jr-bar__label" style={{ left: `${pos(j, fin(x.waitFrom) ? x.waitFrom : fin(x.started) ? x.started : j.now)}%` }}>{x.task.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeSplit({ j }: { j: Journey }) {
  const parts = [
    { key: "work", label: "Working", v: j.split.workMs },
    { key: "wait", label: "Waiting to start", v: j.split.waitMs },
    { key: "review", label: "In review", v: j.split.reviewMs },
    { key: "blocked", label: "Blocked", v: j.split.blockedMs },
  ];
  const total = parts.reduce((n, p) => n + p.v, 0);
  if (!total) return <p className="small muted">No time recorded yet — it fills in as tasks are picked up.</p>;
  return (
    <>
      <div className="jr-split" role="img" aria-label={parts.map((p) => `${p.label} ${d1(p.v)}`).join(", ")}>
        {parts.map((p) => p.v > 0 ? <span key={p.key} className={`jr-split__seg jr-sw--${p.key}`} style={{ flexGrow: p.v }} /> : null)}
      </div>
      <ul className="jr-split__legend">
        {parts.map((p) => (
          <li key={p.key}><span className={`jr__sw jr-sw--${p.key}`} aria-hidden="true" />{p.label}<strong>{d1(p.v)}</strong><span className="muted">{Math.round((100 * p.v) / total)}%</span></li>
        ))}
      </ul>
    </>
  );
}

function Points({ title, tone, items, empty }: { title: string; tone: "good" | "bad"; items: { text: string; taskId?: string }[]; empty: string }) {
  return (
    <section className={`card jr-points jr-points--${tone}`}>
      <h2>{title}</h2>
      {items.length === 0 ? <p className="small muted">{empty}</p> : (
        <ul>{items.slice(0, 12).map((p, i) => <li key={i}><span className="jr-points__mark" aria-hidden="true">{tone === "good" ? "✓" : "!"}</span>{p.text}</li>)}</ul>
      )}
    </section>
  );
}

function Log({ events, titles, deliverableId }: { events: TaskEvent[]; titles: Map<string, string>; deliverableId: string }) {
  const { label, memberName } = useLookups();
  const [all, setAll] = useState(false);
  const shown = events.filter((e) => all || e.event_type !== "comment" || e.note);
  if (!shown.length) return <p className="small muted">Nothing recorded yet.</p>;
  const byDay = new Map<string, TaskEvent[]>();
  for (const e of shown) { const k = indiaDate(e.occurred_at); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
  const days = [...byDay.entries()];
  const visible = all ? days : days.slice(-10);
  return (
    <>
      {!all && days.length > 10 && <button type="button" className="link small" onClick={() => setAll(true)}>Show all {days.length} days</button>}
      <ol className="jr-log">
        {visible.map(([day, es]) => (
          <li key={day}>
            <p className="jr-log__day">{formatDate(day)}</p>
            <ul>
              {es.map((e) => (
                <li key={e.id} className="jr-log__row">
                  <span className="jr-log__time small muted">{formatDateTime(e.occurred_at).split(", ").pop()}</span>
                  <span>
                    <strong>{e.actor_id ? memberName(e.actor_id) : "System"}</strong> {EVENT_TEXT[e.event_type] ?? e.event_type.replace(/_/g, " ")}
                    {e.stage_code && <> · {label("workflow_stage", e.stage_code)}</>}
                    {e.to_owner_id && ["handed_off", "owner_changed", "created"].includes(e.event_type) && <> → {memberName(e.to_owner_id)}</>}
                    <span className="muted"> · {e.task_id === deliverableId ? "the deliverable" : titles.get(e.task_id)}</span>
                    {e.note && <span className="event__note prewrap">{e.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </>
  );
}
