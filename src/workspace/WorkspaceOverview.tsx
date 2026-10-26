// Workspace Overview (D-044): one page for the state of the work — summary figures,
// plain-language insights, the Goal → Deliverable → Task map with each deliverable's
// task mix, what is stuck and what it holds up, weekly approvals and per-person load.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { type TaskWithStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { deadlineOf, RISK_LABEL } from "../lib/deliverables.ts";
import { formatDate, todayInIndia } from "../lib/format.ts";
import { type DeliverableNode, type GoalNode } from "../lib/hierarchy.ts";
import { buildOverview, type Overview, type Week } from "../lib/overview.ts";
import { rangeLabel } from "../lib/dateRange.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { taskRange, useTaskFilters, useTaskPanel } from "./filters.ts";
import { type Phase, phaseOf } from "./phases.ts";

// task mix colours: identity comes from the legend and the counts beside each bar
const MIX: { key: Phase | "blocked"; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "review", label: "In review" },
  { key: "doing", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "todo", label: "To do" },
  { key: "requested", label: "Requested" },
];

export function WorkspaceOverview() {
  const tasks = useTasks();
  const goals = useGoals();
  const { memberName, isAdminMember, ready } = useLookups();
  const { member: me } = useMember();
  const { scope } = useScope();
  const { f } = useTaskFilters();
  const today = todayInIndia();
  const range = taskRange(f, today);

  const ov = useMemo(() => tasks.data && goals.data
    ? buildOverview({ goals: goals.data, tasks: tasks.data as TaskWithStage[], today, range, meId: me.id, scope })
    : null, [tasks.data, goals.data, today, range, me.id, scope]);

  if (tasks.isError || goals.isError) return <StatePanel title="Could not load the overview" tone="error"><p>{(tasks.error ?? goals.error)?.message}</p></StatePanel>;
  if (!ov || !ready) return <Loading />;

  const mixOf = (ts: TaskWithStage[]) => {
    const m = new Map<string, number>();
    for (const t of ts) {
      const k = t.status === "blocked" ? "blocked" : phaseOf(t, isAdminMember);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const period = rangeLabel(range);

  return (
    <div className="wov">
      <p className="small muted wov__scope">
        {scope === "me" ? "Your work" : "The whole team"} · period figures for <strong>{period}</strong>. Change the period with the date range above.
      </p>

      <Kpis ov={ov} />

      <div className="wov__cols">
        <section className="card wov__map" aria-labelledby="wov-map">
          <header className="wov__head">
            <div>
              <h2 id="wov-map">Goals, deliverables and tasks</h2>
              <p className="small muted">How each goal is served and where its work stands. Select a deliverable to open it.</p>
            </div>
            <MixLegend />
          </header>
          {ov.hierarchy.goals.length === 0 && ov.hierarchy.unlinkedDeliverables.length === 0
            ? <p className="small muted">No goals or deliverables yet. Use <strong>+ Create new</strong> to add the first goal.</p>
            : (
              <ol className="wov__tree">
                {ov.hierarchy.goals.map((g) => <GoalBranch key={g.goal.id} node={g} mixOf={mixOf} />)}
                {(ov.hierarchy.unlinkedDeliverables.length > 0 || ov.hierarchy.looseTasks.length > 0) && (
                  <li className="wov__goal wov__goal--none">
                    <div className="wov__goalrow wov__goalrow--none">
                      <span className="wov__goaltitle">Not linked to a goal</span>
                      <span className="small">{ov.hierarchy.unlinkedDeliverables.length} deliverables · {ov.hierarchy.looseTasks.length} tasks</span>
                    </div>
                    <ul className="wov__dlist">
                      {ov.hierarchy.unlinkedDeliverables.map((n) => <DeliverableRow key={n.d.id} n={n} mixOf={mixOf} />)}
                      {ov.hierarchy.looseTasks.length > 0 && <LooseRow tasks={ov.hierarchy.looseTasks} mixOf={mixOf} />}
                    </ul>
                  </li>
                )}
              </ol>
            )}
        </section>

        <div className="wov__side">
          <section className="card" aria-labelledby="wov-ins">
            <h2 id="wov-ins">Insights</h2>
            <ul className="wov__insights">
              {ov.insights.map((i, k) => (
                <li key={k} className={`wov__ins wov__ins--${i.tone}`}>
                  <span className="wov__dot" aria-hidden="true" />
                  <span>{i.personId && <strong>{memberName(i.personId)} </strong>}{i.text}{i.href && <> <Link className="link small" to={i.href}>View</Link></>}</span>
                </li>
              ))}
            </ul>
          </section>
          <Stuck ov={ov} />
        </div>
      </div>

      <div className="wov__cols wov__cols--even">
        <section className="card" aria-labelledby="wov-weeks">
          <h2 id="wov-weeks">Work approved per week</h2>
          <p className="small muted">Tasks approved in each Monday-to-Sunday week, last 8 weeks.</p>
          <WeekBars weeks={ov.weeks} />
        </section>
        <section className="card" aria-labelledby="wov-people">
          <h2 id="wov-people">People</h2>
          <p className="small muted">Open work is counted with whoever holds its current step. Approved and on time are for {period}.</p>
          {ov.people.length === 0 ? <p className="small muted">No open or approved work in this view.</p> : (
            <div className="table-wrap">
              <table className="wtable wov__people">
                <thead><tr><th>Person</th><th>Open</th><th>Overdue</th><th>Blocked</th><th>In review</th><th>Approved</th><th>On time</th></tr></thead>
                <tbody>
                  {ov.people.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/workspace/list?owner=${p.id}`}>{memberName(p.id)}</Link></td>
                      <td>{p.open}</td>
                      <td className={p.overdue ? "due--late" : undefined}>{p.overdue}</td>
                      <td>{p.blocked}</td><td>{p.inReview}</td><td>{p.done}</td>
                      <td>{p.onTime === null ? "—" : `${p.onTime}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <p className="small muted">Progress is work done, not proof a business outcome was achieved — outcomes are recorded on each goal.</p>
    </div>
  );
}

function Kpis({ ov }: { ov: Overview }) {
  const c = ov.counts;
  const tiles: { k: string; v: string | number; sub: string; href?: string; tone?: "bad" | "warn" }[] = [
    { k: "Active goals", v: c.activeGoals, sub: c.goalsAtRisk ? `${c.goalsAtRisk} need attention` : "none at risk", href: "/workspace/goals", tone: c.goalsAtRisk ? "warn" : undefined },
    { k: "Deliverables", v: `${c.deliverablesDone}/${c.deliverables}`, sub: c.deliverablesAtRisk ? `done · ${c.deliverablesAtRisk} at risk` : "done", href: "/workspace/deliverables", tone: c.deliverablesAtRisk ? "warn" : undefined },
    { k: "Open tasks", v: c.open, sub: `${c.overdue} overdue · ${c.blocked} blocked`, href: "/workspace/list", tone: c.overdue || c.blocked ? "bad" : undefined },
    { k: "Awaiting decision", v: c.inReview + c.requested, sub: `${c.inReview} in review · ${c.requested} requests`, href: "/workspace/list?status=in_review" },
    { k: "Approved", v: c.done, sub: `${c.created} created in the period`, href: "/workspace/list?status=done" },
    { k: "On time", v: ov.onTimePct === null ? "—" : `${ov.onTimePct}%`, sub: ov.cycleDays === null ? "no approvals with due dates" : `median ${Math.round(ov.cycleDays * 10) / 10} days to approve` },
  ];
  return (
    <ul className="wov__kpis">
      {tiles.map((t) => {
        const body = <><span className="wov__k">{t.k}</span><strong className="wov__v">{t.v}</strong><span className={`wov__sub${t.tone ? ` wov__sub--${t.tone}` : ""}`}>{t.sub}</span></>;
        return <li key={t.k} className="wov__kpi">{t.href ? <Link to={t.href}>{body}</Link> : <div>{body}</div>}</li>;
      })}
    </ul>
  );
}

function MixLegend() {
  return (
    <ul className="wov__legend" aria-label="Task status colours">
      {MIX.map((m) => <li key={m.key}><span className={`wov__sw wov__sw--${m.key}`} aria-hidden="true" />{m.label}</li>)}
    </ul>
  );
}

function MixBar({ mix, total }: { mix: Map<string, number>; total: number }) {
  if (!total) return <span className="small muted">No tasks yet</span>;
  const text = MIX.filter((m) => mix.get(m.key)).map((m) => `${mix.get(m.key)} ${m.label.toLowerCase()}`).join(", ");
  return (
    <span className="wov__mix" role="img" aria-label={text} title={text}>
      {MIX.map((m) => mix.get(m.key) ? <span key={m.key} className={`wov__seg wov__sw--${m.key}`} style={{ flexGrow: mix.get(m.key) }} /> : null)}
    </span>
  );
}

function GoalBranch({ node, mixOf }: { node: GoalNode; mixOf: (t: TaskWithStage[]) => Map<string, number> }) {
  const { label, memberName } = useLookups();
  const g = node.goal;
  return (
    <li className="wov__goal">
      <div className="wov__goalrow">
        <span className="wov__goalicon" aria-hidden="true">◎</span>
        <Link className="wov__goaltitle" to={`/goals#goal-${g.ref}`}>{g.title}</Link>
        <span className="wov__goalmeta">{label("goal_status", g.status)} · {memberName(g.owner_id)}{g.end_date ? ` · ends ${formatDate(g.end_date)}` : ""}</span>
        <span className="wov__goalpct"><strong>{node.pct ?? 0}%</strong> · {node.doneDeliverables}/{node.totalDeliverables} deliverables</span>
        <span className="wov__goalbar" aria-hidden="true"><span style={{ width: `${node.pct ?? 0}%` }} /></span>
      </div>
      <ul className="wov__dlist">
        {node.deliverables.map((n) => <DeliverableRow key={n.d.id} n={n} mixOf={mixOf} />)}
        {node.directTasks.length > 0 && <LooseRow tasks={node.directTasks} mixOf={mixOf} title="Tasks directly on this goal" />}
        {node.deliverables.length === 0 && node.directTasks.length === 0 && <li className="small muted wov__empty">No deliverables or tasks yet.</li>}
      </ul>
    </li>
  );
}

function DeliverableRow({ n, mixOf }: { n: DeliverableNode; mixOf: (t: TaskWithStage[]) => Map<string, number> }) {
  const { memberName } = useLookups();
  const panel = useTaskPanel();
  const { d, r } = n;
  const due = deadlineOf(d);
  const counting = r.total - r.cancelled;
  return (
    <li className="wov__d">
      <button type="button" className="link wov__dtitle" onClick={() => panel.open(d.ref)}>{d.title}</button>
      <span className="small muted wov__dmeta">{memberName(d.owner_id)}{due ? ` · due ${formatDate(due)}` : ""}{d.status === "requested" ? " · requested" : ""}</span>
      <MixBar mix={mixOf(n.tasks)} total={n.tasks.length} />
      <span className="small wov__dcount">{r.done}/{counting} done · <Link to={`/workspace/deliverables/${d.ref}`}>Journey</Link></span>
      {r.risk !== "on_track" && r.risk !== "no_parts" && <span className={`risk risk--${r.risk}`} title={r.reasons.join(" · ")}>{RISK_LABEL[r.risk]}</span>}
      {(r.risk === "blocked" || r.risk === "at_risk") && r.reasons[0] && <span className="small wov__why">{r.reasons[0]}</span>}
    </li>
  );
}

function LooseRow({ tasks, mixOf, title = "Tasks not in a deliverable" }: { tasks: TaskWithStage[]; mixOf: (t: TaskWithStage[]) => Map<string, number>; title?: string }) {
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <li className="wov__d wov__d--loose">
      <Link className="wov__dtitle" to="/workspace/tasks">{title}</Link>
      <span className="small muted wov__dmeta">{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
      <MixBar mix={mixOf(tasks)} total={tasks.length} />
      <span className="small wov__dcount">{done}/{tasks.length} done</span>
    </li>
  );
}

function Stuck({ ov }: { ov: Overview }) {
  const { memberName } = useLookups();
  const panel = useTaskPanel();
  const KIND = { blocked: "Blocked", overdue: "Overdue", waiting: "Waiting" } as const;
  return (
    <section className="card" aria-labelledby="wov-stuck">
      <h2 id="wov-stuck">Stuck, and what it holds up</h2>
      {ov.chains.length === 0 ? <p className="small muted">Nothing blocked, overdue or waiting to be picked up.</p> : (
        <ul className="wov__chains">
          {ov.chains.slice(0, 8).map((c) => (
            <li key={`${c.kind}-${c.task.id}`} className="wov__chain">
              <span className={`flagchip wov__flag--${c.kind}`}>{KIND[c.kind]}</span>
              <span className="wov__path">
                <button type="button" className="link" onClick={() => panel.open(c.task.ref)}>{c.task.title}</button>
                {c.deliverable && <><span className="wov__arrow" aria-label="holds up">→</span><button type="button" className="link" onClick={() => panel.open(c.deliverable!.ref)}>{c.deliverable.title}</button></>}
                {c.goal && <><span className="wov__arrow" aria-label="serves">→</span><Link to={`/goals#goal-${c.goal.ref}`}>{c.goal.title}</Link></>}
              </span>
              <span className="small muted">{memberName(c.task.task_stages.find((s) => s.state === "active")?.owner_id ?? c.task.owner_id)} · {c.why}</span>
            </li>
          ))}
          {ov.chains.length > 8 && <li className="small muted">+{ov.chains.length - 8} more in the List tab</li>}
        </ul>
      )}
    </section>
  );
}

function WeekBars({ weeks }: { weeks: Week[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.done));
  const W = 520, H = 170, padL = 28, padB = 26, padT = 18;
  const bw = (W - padL) / weeks.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const total = weeks.reduce((n, w) => n + w.done, 0);
  const shown = hover ?? weeks.length - 1;
  return (
    <figure className="wov__chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tasks approved per week: ${weeks.map((w) => `${formatDate(w.start)} ${w.done}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="wov__grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="wov__axis">{t}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = padL + i * bw;
          return (
            <g key={w.start} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Week of ${formatDate(w.start)}: ${w.done} approved`}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {w.done > 0 && <path className={`wov__bar${i === shown ? " is-on" : ""}`}
                d={`M${x + bw * 0.22},${H - padB} V${y(w.done) + 4} q0,-4 4,-4 H${x + bw * 0.78 - 4} q4,0 4,4 V${H - padB} Z`} />}
              {i === shown && <text x={x + bw / 2} y={Math.max(12, y(w.done) - 6)} textAnchor="middle" className="wov__val">{w.done}</text>}
              {i % 2 === (weeks.length - 1) % 2 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="wov__axis">{formatDate(w.start).replace(/\s\d{4}$/, "")}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} className="wov__base" />
      </svg>
      <figcaption className="small muted">{total} approved in 8 weeks · week of {formatDate(weeks[shown]!.start)}: <strong>{weeks[shown]!.done}</strong></figcaption>
    </figure>
  );
}
