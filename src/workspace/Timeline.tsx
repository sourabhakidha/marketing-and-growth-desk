// Timeline (D-040): work over time. Bars run from when a task was created to its due
// date, filled with recorded stage progress; publish dates and today are marked.
// "Month" shows the classic calendar (due / publish dates, goal dates).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { type TaskWithStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { addDays, indiaDate, weekStart } from "../lib/dateRange.ts";
import {formatDate, isOverdue, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { Calendar } from "../modules/Calendar.tsx";
import { matchesFilters, useGroupBy, useTaskFilters, useTaskPanel } from "./filters.ts";
import { groupTasks, stageProgress } from "./phases.ts";

const DAY = 86400000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function Timeline() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "bars" ? "bars" : "month";
  const setView = (v: "bars" | "month") => setParams((p) => { const n = new URLSearchParams(p); if (v === "month") n.delete("view"); else n.set("view", v); return n; }, { replace: true });
  return (
    <>
      <div className="viewswitch viewswitch--small" role="group" aria-label="Timeline view">
        <button type="button" className={view === "month" ? "is-on" : undefined} aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        <button type="button" className={view === "bars" ? "is-on" : undefined} aria-pressed={view === "bars"} onClick={() => setView("bars")}>Timeline</button>
      </div>
      {view === "month" ? <Calendar embedded /> : <Bars />}
    </>
  );
}

function Bars() {
  const tasks = useTasks();
  const goals = useGoals();
  const { label, memberName, ready } = useLookups();
  const { member: me } = useMember();
  const { scope } = useScope();
  const { f } = useTaskFilters();
  const [group] = useGroupBy();
  const panel = useTaskPanel();
  const today = todayInIndia();
  const all = (tasks.data ?? []) as TaskWithStage[];
  const items = useMemo(() => all.filter((t) => t.kind !== "deliverable" && t.status !== "cancelled" && matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data }))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.ref - b.ref), [all, f, me.id, today, scope]);

  if (tasks.isPending || !ready) return <Loading />;
  if (items.length === 0) return <StatePanel title="Nothing to show on the timeline" />;

  const startOf = (t: TaskWithStage) => indiaDate(t.created_at);
  const endOf = (t: TaskWithStage) => t.due_date ?? (t.completed_at ? indiaDate(t.completed_at) : today);
  const lo = weekStart([...items.map(startOf), addDays(today, -14)].sort()[0]!);
  const hiRaw = [...items.map(endOf), ...items.map((t) => t.publish_date ?? today), addDays(today, 21)].sort().at(-1)!;
  const hi = addDays(weekStart(hiRaw), 7);
  const span = toMs(hi) - toMs(lo);
  const pos = (iso: string) => Math.max(0, Math.min(100, ((toMs(iso) - toMs(lo)) / span) * 100));
  const weeks: string[] = [];
  for (let w = lo; w < hi; w = addDays(w, 7)) weeks.push(w);

  const deliverables = all.filter((t) => t.kind === "deliverable" && items.some((p) => p.parent_id === t.id));
  const groups = groupTasks(items, group, { all, goals: goals.data ?? [], label, memberName, deliverables });

  return (
    <div className="tline" style={{ "--weeks": weeks.length } as React.CSSProperties}>
      <div className="tline__head">
        <span />
        <div className="tline__weeks">
          {weeks.map((w) => <span key={w} style={{ left: `${pos(w)}%` }}>{formatDate(w).replace(/ \d{4}$/, "")}</span>)}
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="tline__group" aria-label={g.title || "All work"}>
          {group !== "none" && (
            <div className="tline__grouphead">
              {g.deliverable ? <button type="button" className="link" onClick={() => panel.open(g.deliverable!.ref)}>{g.title}</button> : g.title}
              {g.deliverable?.publish_date && <span className="small muted"> · publishes {formatDate(g.deliverable.publish_date)}</span>}
            </div>
          )}
          {g.tasks.map((t) => {
            const s = startOf(t);
            const e = endOf(t);
            const left = pos(s);
            const width = Math.max(1.2, pos(e) - left + (DAY / span) * 100);
            const pct = stageProgress(t) ?? 0;
            const late = isOverdue(t.due_date, t.status, today);
            return (
              <div key={t.id} className="tline__row">
                <button type="button" className="tline__label link" onClick={() => panel.open(t.ref)} title={t.title}>
                  <span className="tline__title">{t.title}</span>
                  <span className="small muted">{memberName(t.owner_id)}</span>
                </button>
                <div className="tline__track">
                  {weeks.map((w) => <span key={w} className="tline__grid" style={{ left: `${pos(w)}%` }} />)}
                  <span className={`tline__bar${late ? " is-late" : ""}${t.status === "done" ? " is-done" : ""}${!t.due_date ? " is-open-ended" : ""}${t.status === "blocked" ? " is-blocked" : ""}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${t.title}: ${formatDate(s)} → ${t.due_date ? `due ${formatDate(t.due_date)}` : "no due date"} · ${pct}% of stages done${t.status === "blocked" ? " · blocked" : ""}`}>
                    <span className="tline__fill" style={{ width: `${pct}%` }} />
                  </span>
                  {t.publish_date && <span className="tline__publish" style={{ left: `${pos(t.publish_date)}%` }} title={`Publishes ${formatDate(t.publish_date)}`} />}
                  <span className="tline__today" style={{ left: `${pos(today)}%` }} aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <p className="small muted tl-legend">
        <span className="tl-key tl-key--work" /> stages done · <span className="tl-key tline-key--bar" /> remaining · <span className="tl-key tline-key--late" /> overdue ·
        {" "}<span className="tl-key tline-key--publish" /> publish date · <span className="tl-key tl-key--now" /> today. Bars start when the task was created and end at its due date.
      </p>
    </div>
  );
}
