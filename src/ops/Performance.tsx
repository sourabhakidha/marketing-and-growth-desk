// Admin-only performance dashboard and log (D-046). Built from Daily Ops records and task
// approvals, for the people the signed-in admin may see (never themselves). Productivity is
// compared with each person's own baseline: the 28 days before the period.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type Task, useLookups, usePlanItems, useSessions, useTasks, useWorkDays } from "../lib/api.ts";
import { addDays } from "../lib/dateRange.ts";
import { formatDate, todayInIndia } from "../lib/format.ts";
import { buildDayRows, dailyCsv, type DayRow, hours, istClock, sessionMs, sessionsCsv, summarize, type Summary, trend, vsBaseline } from "../lib/ops.ts";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { useTaskPanel } from "../workspace/filters.ts";
import { AdminOnly, useOpsPeople } from "./DailyOps.tsx";

/** Shared data for Performance and Log: the period (plus the 28-day baseline before it) for the people I may see. */
function useOpsData() {
  const dates = useDateRange({ defaultPreset: "this_week" });
  const today = todayInIndia();
  const from = dates.range.from ?? addDays(today, -89);
  const to = dates.range.to && dates.range.to < today ? dates.range.to : today;
  const baseFrom = addDays(from, -28);
  const days = useWorkDays(baseFrom, to);
  const plan = usePlanItems(baseFrom, to);
  const sessions = useSessions(baseFrom, to);
  const tasks = useTasks();
  const { people, ready } = useOpsPeople();
  const [params, setParams] = useSearchParams();
  const who = people.find((p) => p.id === params.get("who"))?.id ?? "";
  const setWho = (id: string) => setParams((x) => { const n = new URLSearchParams(x); if (id) n.set("who", id); else n.delete("who"); return n; }, { replace: true });
  const ids = useMemo(() => (who ? [who] : people.map((p) => p.id)), [who, people]);
  const loaded = days.data && plan.data && sessions.data && tasks.data && ready;
  const all = useMemo(() => loaded
    ? buildDayRows({ memberIds: people.map((p) => p.id), from: baseFrom, to, days: days.data!, plan: plan.data!, sessions: sessions.data!, tasks: tasks.data!, today })
    : [], [loaded, people, baseFrom, to, days.data, plan.data, sessions.data, tasks.data, today]);
  const rows = all.filter((r) => r.day >= from && ids.includes(r.member_id));
  const baseRows = all.filter((r) => r.day < from);
  const error = days.error ?? plan.error ?? sessions.error ?? tasks.error;
  return { dates, from, to, today, people, who, setWho, ids, rows, baseRows, sessions: (sessions.data ?? []).filter((s) => s.day >= from && ids.includes(s.member_id)), tasks: tasks.data ?? [], loaded, error };
}

function Controls({ d, csv }: { d: ReturnType<typeof useOpsData>; csv?: boolean }) {
  const { memberName } = useLookups();
  const taskTitle = (id: string) => d.tasks.find((t) => t.id === id)?.title ?? "A task";
  return (
    <div className="ops-controls">
      <DateRangePicker range={d.dates.range} value={d.dates.value} onChange={d.dates.onChange} />
      <select value={d.who} onChange={(e) => d.setWho(e.target.value)} aria-label="Person">
        <option value="">Everyone I can see ({d.people.length})</option>
        {d.people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
      </select>
      {csv && <>
        <ExportCsvButton name={`daily-log${d.who ? `-${memberName(d.who).toLowerCase()}` : ""}`} range={d.dates.range} label="Daily summary CSV"
          build={() => dailyCsv(d.rows, memberName, taskTitle)} disabled={!d.loaded} />
        <ExportCsvButton name={`task-sessions${d.who ? `-${memberName(d.who).toLowerCase()}` : ""}`} range={d.dates.range} label="Task sessions CSV"
          build={() => sessionsCsv(d.sessions, memberName, taskTitle)} disabled={!d.loaded} />
      </>}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${v}%`);
function Delta({ v, good = "up" }: { v: number | null; good?: "up" | "down" }) {
  if (v === null) return <span className="muted small">no baseline</span>;
  const better = good === "up" ? v > 0 : v < 0;
  return <span className={`delta ${v === 0 ? "" : better ? "delta--good" : "delta--bad"}`}>{pct(v)} vs usual</span>;
}

export function Performance() {
  return <AdminOnly><PerformanceInner /></AdminOnly>;
}

function PerformanceInner() {
  const d = useOpsData();
  const { memberName } = useLookups();
  if (d.error) return <StatePanel title="Could not load performance" tone="error"><p>{d.error.message}</p></StatePanel>;
  if (!d.loaded) return <Loading />;
  if (!d.people.length) return <StatePanel title="Nobody to show"><p>There are no team members whose performance you can see.</p></StatePanel>;
  const sums = d.ids.map((id) => ({ s: summarize(id, d.rows, d.tasks, d.today), b: summarize(id, d.baseRows, d.tasks, d.today) }));
  return (
    <div className="ops">
      <p className="small muted ops-private">Private to admins. Each person is compared with their own usual level (the 28 days before the period). You see contributors{d.people.some((p) => p.role === "admin") ? " and the admins granted to you" : ""}, never yourself.</p>
      <Controls d={d} csv />
      <section className="card" aria-labelledby="perf-team">
        <h2 id="perf-team">{d.who ? memberName(d.who) : "Team"} · {formatDate(d.from)} – {formatDate(d.to)}</h2>
        <div className="table-wrap">
          <table className="wtable ops-table">
            <thead><tr><th>Person</th><th>Days</th><th>Hours worked</th><th>On tasks</th><th>Approved</th><th>Per 8 h</th><th>Late approvals</th><th>Late starts</th><th>Plan kept</th><th>Open · overdue now</th></tr></thead>
            <tbody>
              {sums.map(({ s, b }) => (
                <tr key={s.member_id} className={d.who === s.member_id ? "is-selected" : undefined}>
                  <td><button type="button" className="link" onClick={() => d.setWho(d.who === s.member_id ? "" : s.member_id)}>{memberName(s.member_id)}</button></td>
                  <td>{s.daysWorked}</td>
                  <td>{s.workedH} h{s.avgH !== null && <div className="small muted">{s.avgH} h/day</div>}</td>
                  <td>{s.taskH} h{s.focusPct !== null && <div className="small muted">{s.focusPct}% of time</div>}</td>
                  <td>{s.approved}</td>
                  <td>{s.perDay ?? "—"}<div><Delta v={vsBaseline(s.perDay, b.perDay)} /></div></td>
                  <td className={s.approvedLate ? "due--late" : undefined}>{s.approvedLate}{s.avgDaysLate !== null && <div className="small muted">avg {s.avgDaysLate} d late</div>}</td>
                  <td>{s.lateStarts}{s.avgLateMin !== null && <div className="small muted">avg {s.avgLateMin} min</div>}</td>
                  <td>{s.adherencePct === null ? "—" : `${s.adherencePct}%`}</td>
                  <td>{s.openNow} · <span className={s.overdueNow ? "due--late" : undefined}>{s.overdueNow}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Hours worked run from check-in to check-out. On tasks is time punched in on tasks. Per 8 h is tasks approved per 8 hours worked. A late start is a check-in more than 10 minutes after the planned start. Plan kept is the share of planned task blocks that were worked on that day.</p>
      </section>
      {d.who ? <PersonDetail d={d} s={sums[0]!.s} b={sums[0]!.b} /> : <p className="small muted">Select a person for their trends and delays.</p>}
    </div>
  );
}

function PersonDetail({ d, s, b }: { d: ReturnType<typeof useOpsData>; s: Summary; b: Summary }) {
  const { memberName } = useLookups();
  const panel = useTaskPanel();
  const series = trend(s.member_id, d.rows, d.from, d.to);
  const lateTasks = d.rows.filter((r) => r.member_id === s.member_id).flatMap((r) => r.approvedLate);
  const overdue = d.tasks.filter((t) => t.owner_id === s.member_id && t.kind !== "deliverable" && !t.removed_at && !["done", "cancelled", "requested"].includes(t.status) && t.due_date && t.due_date < d.today);
  const gaps = d.rows.filter((r) => r.member_id === s.member_id && (r.noCheckout || (r.lateStartMin ?? 0) > 10));
  return (
    <>
      <ul className="wov__kpis">
        <Tile k="Hours worked" v={`${s.workedH} h`} sub={<Delta v={vsBaseline(s.avgH, b.avgH)} />} />
        <Tile k="On tasks" v={`${s.taskH} h`} sub={s.focusPct === null ? "—" : `${s.focusPct}% of worked time`} />
        <Tile k="Tasks approved" v={s.approved} sub={<Delta v={vsBaseline(s.perDay, b.perDay)} />} />
        <Tile k="Workload now" v={s.openNow} sub={`${s.overdueNow} overdue`} />
        <Tile k="Late approvals" v={s.approvedLate} sub={s.avgDaysLate === null ? "none" : `avg ${s.avgDaysLate} days late`} />
        <Tile k="Plan kept" v={s.adherencePct === null ? "—" : `${s.adherencePct}%`} sub={`${s.plannedH} h planned`} />
      </ul>
      <div className="wov__cols wov__cols--even">
        <section className="card"><h2>Hours worked per day</h2><p className="small muted">Check-in to check-out.</p><Bars data={series.map((x) => ({ k: x.day, v: x.workedH }))} unit="h" /></section>
        <section className="card"><h2>Tasks approved per day</h2><p className="small muted">Tasks {memberName(s.member_id)} owns, by approval date.</p><Bars data={series.map((x) => ({ k: x.day, v: x.approved }))} unit="" /></section>
      </div>
      <section className="card">
        <h2>Delays</h2>
        {lateTasks.length + overdue.length + gaps.length === 0 ? <p className="small muted">No late approvals, overdue work, late starts or missing check-outs in this period.</p> : (
          <ul className="ops-delays">
            {lateTasks.map((t) => <li key={`l${t.id}`}><span className="flagchip wov__flag--overdue">Approved late</span> <button type="button" className="link" onClick={() => panel.open(t.ref)}>{t.title}</button> <span className="small muted">due {formatDate(t.due_date)}, approved {formatDate(t.completed_at)}</span></li>)}
            {overdue.map((t) => <li key={`o${t.id}`}><span className="flagchip wov__flag--blocked">Overdue</span> <button type="button" className="link" onClick={() => panel.open(t.ref)}>{t.title}</button> <span className="small muted">was due {formatDate(t.due_date)}</span></li>)}
            {gaps.map((r) => <li key={`g${r.day}`}><span className="flagchip wov__flag--waiting">{r.noCheckout ? "No check-out" : "Late start"}</span> {formatDate(r.day)} <span className="small muted">{r.noCheckout ? `checked in ${istClock(r.checkIn)}, never checked out` : `checked in ${istClock(r.checkIn)}, ${r.lateStartMin} min after the planned start`}</span></li>)}
          </ul>
        )}
      </section>
    </>
  );
}

function Tile({ k, v, sub }: { k: string; v: string | number; sub: React.ReactNode }) {
  return <li className="wov__kpi"><div><span className="wov__k">{k}</span><strong className="wov__v">{v}</strong><span className="wov__sub">{sub}</span></div></li>;
}

/** Single-series daily bars with a hover readout. */
function Bars({ data, unit }: { data: { k: string; v: number }[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="small muted">No days in this period.</p>;
  const max = Math.max(1, ...data.map((d) => d.v));
  const W = 520, H = 150, padL = 26, padB = 22, padT = 16;
  const bw = (W - padL) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const shown = hover ?? data.length - 1;
  const every = Math.ceil(data.length / 8);
  return (
    <figure className="wov__chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data.map((d) => `${formatDate(d.k)} ${d.v}${unit}`).join(", ")} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="wov__grid" /><text x={padL - 5} y={y(t) + 4} textAnchor="end" className="wov__axis">{Math.round(t * 10) / 10}</text></g>)}
        {data.map((d, i) => {
          const x = padL + i * bw;
          return (
            <g key={d.k} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {d.v > 0 && <rect x={x + bw * 0.18} y={y(d.v)} width={Math.max(2, bw * 0.64)} height={H - padB - y(d.v)} rx={Math.min(4, bw * 0.2)} className={`wov__bar${i === shown ? " is-on" : ""}`} />}
              {i % every === (data.length - 1) % every && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="wov__axis">{formatDate(d.k).replace(/\s\d{4}$/, "")}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} className="wov__base" />
      </svg>
      <figcaption className="small muted">{formatDate(data[shown]!.k)}: <strong>{data[shown]!.v}{unit && ` ${unit}`}</strong></figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- log
export function OpsLog() {
  return <AdminOnly><LogInner /></AdminOnly>;
}

function LogInner() {
  const d = useOpsData();
  const { memberName } = useLookups();
  const panel = useTaskPanel();
  const [open, setOpen] = useState<string | null>(null);
  if (d.error) return <StatePanel title="Could not load the log" tone="error"><p>{d.error.message}</p></StatePanel>;
  if (!d.loaded) return <Loading />;
  const taskOf = (id: string): Task | undefined => d.tasks.find((t) => t.id === id);
  const rows = [...d.rows].sort((a, b) => b.day.localeCompare(a.day) || memberName(a.member_id).localeCompare(memberName(b.member_id)));
  const now = Date.now();
  return (
    <div className="ops">
      <p className="small muted ops-private">Private to admins: every recorded workday of the people you may see. Download a daily summary or every task session for any period.</p>
      <Controls d={d} csv />
      <section className="card">
        {rows.length === 0 ? <p className="small muted">Nothing recorded in this period.</p> : (
          <div className="table-wrap">
            <table className="wtable ops-table">
              <thead><tr><th>Date</th><th>Person</th><th>Planned</th><th>In</th><th>Out</th><th>Worked</th><th>On tasks</th><th>Sessions</th><th>Approved</th></tr></thead>
              {rows.map((r: DayRow) => {
                const key = `${r.member_id}-${r.day}`;
                return (
                  <tbody key={key}>
                    <tr>
                      <td>{formatDate(r.day)}</td>
                      <td>{memberName(r.member_id)}</td>
                      <td>{r.plannedMin === null ? "—" : `${hours(r.plannedMin * 60_000)} h`}{r.blocks.length > 0 && <div className="small muted">{r.blocks.length} block{r.blocks.length > 1 ? "s" : ""}</div>}</td>
                      <td>{istClock(r.checkIn)}{(r.lateStartMin ?? 0) > 10 && <div className="small due--late">{r.lateStartMin} min late</div>}</td>
                      <td>{r.checkOut ? istClock(r.checkOut) : r.noCheckout ? <span className="due--late">missing</span> : "—"}</td>
                      <td>{r.workedMs === null ? "—" : `${hours(r.workedMs)} h`}</td>
                      <td>{hours(r.taskMs)} h</td>
                      <td>{r.sessions.length ? <button type="button" className="link" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{r.sessions.length} · {open === key ? "hide" : "show"}</button> : "0"}</td>
                      <td>{r.approved.length}{r.approvedLate.length > 0 && <div className="small due--late">{r.approvedLate.length} late</div>}</td>
                    </tr>
                    {open === key && (
                      <tr className="ops-log__detail"><td colSpan={9}>
                        <ul>
                          {r.sessions.map((s) => {
                            const t = taskOf(s.task_id);
                            return <li key={s.id}><span className="ops-log__time">{istClock(s.started_at)}–{s.ended_at ? istClock(s.ended_at) : "now"}</span> {t ? <button type="button" className="link" onClick={() => panel.open(t.ref)}>{t.title}</button> : "A task"} <span className="small muted">· {Math.round(sessionMs(s, now) / 60_000)} min{s.ended_by === "auto" ? " · closed automatically" : ""}{s.note ? ` · ${s.note}` : ""}</span></li>;
                          })}
                        </ul>
                      </td></tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
