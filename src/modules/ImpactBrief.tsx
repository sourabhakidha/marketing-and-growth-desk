// Impact Brief (D-030): daily / weekly / monthly view of where effort is going
// against business outcomes. Everything here is computed from recorded data;
// the optional AI brief narrates the same numbers and is labelled as such.
import { useMemo } from "react";
import { Link } from "react-router";
import {
  type ImpactAssessment, useGoalProgress, useGoals, useImpactAssessments, useLookups, useRequestAssessment, useTaskEvents, useTasks,
} from "../lib/api.ts";
import type { RangePreset } from "../lib/dateRange.ts";
import { rangeLabel } from "../lib/dateRange.ts";
import {formatDateTime, todayInIndia} from "../lib/format.ts";
import { type BriefOut, briefInput, GOAL_FLAG_TEXT, IMPORTANCE_LABEL, OUTCOME_STATUS_LABEL, periodBrief } from "../lib/impact.ts";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import { ErrorText } from "../components/Form.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import "../impact.css";
import { useMember } from "../lib/session.tsx";
import { isMyTask, useScope } from "../lib/scope.tsx";

const TABS: { label: string; preset: RangePreset }[] = [
  { label: "Daily", preset: "today" }, { label: "Weekly", preset: "this_week" }, { label: "Monthly", preset: "this_month" },
];
const KIND: Partial<Record<RangePreset, string>> = {
  today: "daily", yesterday: "daily", this_week: "weekly", last_week: "weekly", last_7: "weekly",
  this_month: "monthly", last_month: "monthly", last_30: "monthly",
};
const tabOf = (p: RangePreset) => (KIND[p] === "daily" ? "Daily" : KIND[p] === "weekly" ? "Weekly" : KIND[p] === "monthly" ? "Monthly" : null);

export function ImpactBrief({ embedded = false }: { embedded?: boolean } = {}) {
  const dates = useDateRange({ defaultPreset: "this_week" });
  const r = dates.range;
  const tasks = useTasks();
  const goals = useGoals();
  const progress = useGoalProgress();
  const assessments = useImpactAssessments();
  const events = useTaskEvents(r, 500);
  const { memberName, ready } = useLookups();
  const request = useRequestAssessment();
  const { member: me } = useMember();
  const { isMe } = useScope();
  const today = todayInIndia();

  const brief = useMemo(() => {
    if (!tasks.data || !goals.data || !progress.data || !assessments.data || !events.data || r.preset === "all" || !r.from || !r.to) return null;
    // "Me": only my tasks, and goals I own or work on (goal roll-ups still count the whole team's linked work)
    const myTasks = tasks.data.filter((t) => isMyTask(t, me.id));
    const myGoalIds = new Set(myTasks.map((t) => t.goal_id).filter(Boolean) as string[]);
    const scopedGoals = isMe ? goals.data.filter((g) => g.owner_id === me.id || myGoalIds.has(g.id)) : goals.data;
    return periodBrief({
      range: r, today, tasks: isMe ? myTasks : tasks.data, goals: scopedGoals, progress: progress.data, assessments: assessments.data,
      activityTaskIds: new Set(events.data.map((e) => e.task_id)), memberName,
    });
  }, [tasks.data, goals.data, progress.data, assessments.data, events.data, r, today, memberName, isMe, me.id]);

  const header = embedded ? (isMe ? <p className="small"><span className="scope-note">Showing your work · switch to Team in the top bar for everyone</span></p> : null) : (
    <header className="page-header">
      <h1>Impact Brief</h1>
      <p className="muted">{isMe && <span className="scope-note">Showing your work · switch to Team in the top bar for everyone</span>} Where effort is going against business outcomes: what matters most, what is moving, what is neglected, and what admins should do next. Expected impact is an expectation, not a result; completed tasks are never counted as achieved outcomes.</p>
    </header>
  );
  const controls = (
    <div className="filters">
      <div className="viewswitch" role="group" aria-label="Brief period">
        {TABS.map((t) => (
          <button key={t.label} type="button" className={tabOf(dates.value.preset) === t.label ? "is-on" : undefined}
            aria-pressed={tabOf(dates.value.preset) === t.label} onClick={() => dates.onChange({ preset: t.preset })}>{t.label}</button>
        ))}
      </div>
      <DateRangePicker {...dates} />
      {brief && (
        <span className="filters__end">
          <ExportCsvButton name="impact-brief" range={r} build={() => ({
            columns: ["rank", "ref", "title", "score", "reasons"],
            rows: brief.rankedTasks.map((t, i) => [i + 1, t.ref, t.title, t.score, t.reasons.join(" | ")]),
          })} />
        </span>
      )}
    </div>
  );

  if (!ready || tasks.isPending || goals.isPending || assessments.isPending) return <>{header}{controls}<Loading /></>;
  if (r.preset === "all" || !r.from || !r.to) return <>{header}{controls}<StatePanel title="Choose a period"><p>An impact brief covers a specific day, week, month or custom range.</p></StatePanel></>;
  if (!brief) return <>{header}{controls}<Loading /></>;

  const periodKind = KIND[r.preset] ?? "custom";
  const aiBriefs = (assessments.data ?? []).filter((a) => a.subject === "brief" && a.period_from === r.from && a.period_to === r.to);
  const newestAi = aiBriefs[0] ?? null;
  const readyAi = aiBriefs.find((a) => a.status === "ready") ?? null;
  const running = newestAi && (newestAi.status === "queued" || newestAi.status === "running");
  const attentionGoals = brief.rollups.filter((x) => x.active && x.flags.length > 0);
  const openHours = brief.byPerson.reduce((n, p) => n + p.openHours, 0);
  const maxGoalHours = Math.max(1, ...brief.byGoal.map((g) => g.openHours));

  return (
    <>
      {header}
      {controls}
      <p className="small muted">Period: <strong>{rangeLabel(r)}</strong> · India dates, weeks start Monday.</p>

      <div className="brief-kpis">
        <div className="brief-kpi"><span className="brief-kpi__label">Active tasks</span><strong>{brief.activeTasks.length}</strong><span className="small muted">open at some point</span></div>
        <div className="brief-kpi"><span className="brief-kpi__label">Approved</span><strong>{brief.approvedTasks.length}</strong><span className="small muted">tasks done in period</span></div>
        <div className="brief-kpi"><span className="brief-kpi__label">New tasks</span><strong>{brief.createdTasks.length}</strong><span className="small muted">created in period</span></div>
        <div className="brief-kpi"><span className="brief-kpi__label">Open effort</span><strong>{Math.round(openHours * 10) / 10} h</strong><span className="small muted">estimated, all open work</span></div>
        <div className="brief-kpi"><span className="brief-kpi__label">Goals needing attention</span><strong>{attentionGoals.length}</strong><span className="small muted">of {brief.rollups.length} in period</span></div>
      </div>

      <section className="card brief-ai">
        <div className="impact-card__head">
          <h2>AI brief</h2>
          <button type="button" className="button button--small" disabled={request.isPending || Boolean(running)}
            onClick={() => request.mutate({ subject: "brief", period_kind: periodKind, period_from: r.from!, period_to: r.to!, input: briefInput(brief, goals.data ?? [], memberName) })}>
            {running ? "Writing…" : readyAi ? "Regenerate" : "Generate AI brief"}
          </button>
        </div>
        <ErrorText error={request.error} />
        {newestAi?.status === "failed" && <p className="small assess__error">Last attempt failed: {newestAi.error}</p>}
        {readyAi ? <AiBrief a={readyAi} name={(text) => text.replace(/\b([TG])-(\d+)\b/g, (m, k: string, n: string) =>
          (k === "T" ? tasks.data?.find((t) => t.ref === Number(n))?.title : goals.data?.find((g) => g.ref === Number(n))?.title) ?? m)} /> : (
          <p className="small muted">The AI brief summarises the figures on this page for {rangeLabel(r)}. It only sees what is shown here, refers to work by its T/G number and is told never to invent targets or treat expectations as results.</p>
        )}
      </section>

      <div className="brief-grid section-title">
        <section className="card">
          <h2>Highest expected impact — tasks</h2>
          {brief.rankedTasks.length === 0 ? <p className="small muted">No open tasks in this period.</p> : (
            <ol className="brief-list">
              {brief.rankedTasks.slice(0, 8).map((t) => (
                <li key={t.ref}><Link to={`/workspace?task=${t.ref.slice(2)}`}>{t.title}</Link><span className="why">{t.reasons.join(" · ")}</span></li>
              ))}
            </ol>
          )}
        </section>
        <section className="card">
          <h2>Highest expected impact — goals</h2>
          {brief.rankedGoals.length === 0 ? <p className="small muted">No goals cover this period.</p> : (
            <ol className="brief-list">
              {brief.rankedGoals.slice(0, 6).map((g) => (
                <li key={g.ref}><Link to={`/goals#goal-${g.ref.slice(2)}`}>{g.title}</Link><span className="why">{g.reasons.join(" · ")}</span></li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <h2 className="section-title">Business outcomes vs task completion</h2>
      {brief.rollups.length === 0 ? <p className="small muted">No goals cover this period.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Goal</th><th>Importance</th><th>Task completion</th><th>Business outcome</th><th>Open work</th><th>Attention</th></tr></thead>
            <tbody>
              {brief.rollups.map((x) => (
                <tr key={x.goal.id}>
                  <td className="wrap"><Link to={`/goals#goal-${x.goal.ref}`}>{x.goal.title}</Link>
                    {x.goal.outcome_statement && <div className="small muted">{x.goal.outcome_statement}</div>}</td>
                  <td>{x.goal.importance ? IMPORTANCE_LABEL[x.goal.importance] : "—"}</td>
                  <td>{x.taskCompletionPct != null ? `${x.taskCompletionPct}%` : "no tasks"}<div className="small muted">{x.done.length} done / {x.linked.length}</div></td>
                  <td>{OUTCOME_STATUS_LABEL[x.goal.outcome_status]}{x.outcomePct != null && <div className="small muted">{x.outcomePct}% of target ({x.goal.outcome_actual} / {x.goal.outcome_target})</div>}</td>
                  <td>{x.open.length} tasks · {Math.round((x.openEffortMinutes / 60) * 10) / 10} h</td>
                  <td className="wrap small">{x.flags.length ? x.flags.map((f) => GOAL_FLAG_TEXT[f]).join("; ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="brief-capacity section-title">
        <section className="card">
          <h2>Capacity by objective</h2>
          <div className="table-wrap table-wrap--inset">
            <table>
              <thead><tr><th>Objective</th><th className="num">Open tasks</th><th className="num">Open hours</th><th className="num">Done in period</th></tr></thead>
              <tbody>
                {brief.byGoal.map((g) => (
                  <tr key={g.key}>
                    <td>{g.label}<div className="cap-bar" aria-hidden="true"><span style={{ width: `${(100 * g.openHours) / maxGoalHours}%` }} /></div></td>
                    <td className="num">{g.openTasks}</td><td className="num">{g.openHours}</td><td className="num">{g.approvedInPeriod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Hours are owners' estimates for open work; tasks without an estimate count as 0 h.</p>
        </section>
        <section className="card">
          <h2>Capacity by person</h2>
          <div className="table-wrap table-wrap--inset">
            <table>
              <thead><tr><th>Person</th><th className="num">Open tasks</th><th className="num">Open hours</th><th className="num">Active in period</th><th className="num">Done in period</th></tr></thead>
              <tbody>
                {brief.byPerson.map((p) => (
                  <tr key={p.key}><td>{p.label}</td><td className="num">{p.openTasks}</td><td className="num">{p.openHours}</td><td className="num">{p.activeTasks}</td><td className="num">{p.approvedInPeriod}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">"Active" = open at some point in the period.</p>
        </section>
      </div>

      <div className="brief-grid section-title">
        <ListCard title="Low-impact or poorly justified work" empty="Nothing flagged." items={brief.lowImpact} kind="task" />
        <ListCard title="Neglected goals and gaps" empty="No neglected goals." items={brief.neglectedGoals} kind="goal" />
        <ListCard title="Blockers" empty="Nothing blocked." items={brief.blockers} kind="task" />
        <section className="card">
          <h2>Risks from linked work</h2>
          {brief.rollups.every((x) => x.risks.length === 0 && x.dependencies.length === 0) ? <p className="small muted">No risks or dependencies recorded.</p> : (
            <ul className="brief-list">
              {brief.rollups.flatMap((x) => [...x.risks.map((k) => ({ ...k, kind: "risk" })), ...x.dependencies.map((k) => ({ ...k, kind: "depends on" }))]
                .map((k, i) => <li key={`${x.goal.id}-${i}`}>{x.goal.title} <span className="why">{k.kind === "risk" ? "" : "Depends on: "}{k.text}</span></li>))}
            </ul>
          )}
        </section>
      </div>

      <section className="card section-title">
        <h2>Recommended actions for admins</h2>
        {brief.actions.length === 0 ? <p className="small muted">No rule-based actions for this period.</p> : (
          <ol className="brief-list brief-actions">
            {brief.actions.map((a, i) => <li key={i}><strong>{a.action}</strong><span className="why">{a.why}</span></li>)}
          </ol>
        )}
        <p className="small muted">Rule-based from recorded data (flags, blockers, missing impact cases, AI ratings where they exist). Use the AI brief above for a narrative view.</p>
      </section>
    </>
  );
}

function ListCard({ title, empty, items, kind }: { title: string; empty: string; items: { ref: string; title: string; why: string }[]; kind: "task" | "goal" }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {items.length === 0 ? <p className="small muted">{empty}</p> : (
        <ul className="brief-list">
          {items.slice(0, 10).map((x) => (
            <li key={x.ref}>
              <Link to={kind === "task" ? `/workspace?task=${x.ref.slice(2)}` : `/goals#goal-${x.ref.slice(2)}`}>{x.title}</Link>
              <span className="why">{x.why}</span>
            </li>
          ))}
          {items.length > 10 && <li className="small muted">+{items.length - 10} more</li>}
        </ul>
      )}
    </section>
  );
}

function AiBrief({ a, name }: { a: ImpactAssessment; name: (text: string) => string }) {
  const b = a.output as unknown as BriefOut;
  return (
    <div className="ai-block">
      {b.headline && <p><strong>{name(b.headline)}</strong></p>}
      {b.highest_impact.length > 0 && <div className="impact-bullets"><h4>Highest impact</h4><ul className="small">{b.highest_impact.map((h, i) => <li key={i}><strong>{name(h.ref)}</strong> — {name(h.reason)}</li>)}</ul></div>}
      {b.outcome_progress && <div className="impact-bullets"><h4>Outcomes vs task completion</h4><p className="small">{name(b.outcome_progress)}</p></div>}
      {b.capacity && <div className="impact-bullets"><h4>Capacity</h4><p className="small">{name(b.capacity)}</p></div>}
      {b.concerns.length > 0 && <div className="impact-bullets"><h4>Concerns</h4><ul className="small">{b.concerns.map((c, i) => <li key={i}>{c.ref && <strong>{name(c.ref)} — </strong>}{name(c.issue)}</li>)}</ul></div>}
      {b.recommended_priorities.length > 0 && <div className="impact-bullets"><h4>Recommended priorities</h4><ol className="small">{b.recommended_priorities.map((p, i) => <li key={i}><strong>{name(p.action)}</strong> — {name(p.reason)}</li>)}</ol></div>}
      {b.caveats.length > 0 && <div className="impact-bullets"><h4>Caveats</h4><ul className="small">{b.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      <p className="small muted ai-foot">AI brief {formatDateTime(a.completed_at ?? a.created_at)}{a.model ? ` · ${a.model}` : ""}. Written from the figures on this page; expectations, not results.</p>
    </div>
  );
}
