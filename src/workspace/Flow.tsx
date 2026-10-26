import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  useAllStages, useAllTaskEvents, useGoals, useLookups, useOpportunities, useOpportunitySignalLinks, useTasks, useTemplates,
} from "../lib/api.ts";
import {formatDuration, median, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useTaskFilters } from "./filters.ts";
import { eventsByTask, flowByGoal, flowByType, ideaToExecution, slowestStage, stagesByTask, type StageCell } from "./flow.ts";

type Metric = "totals" | "waits" | "works";
const METRIC_LABEL: Record<Metric, string> = { totals: "Stage time", waits: "Wait before pick-up", works: "Working time" };

/** Median with its sample size, so a single data point never reads like a trend. */
function Med({ values, unit = "" }: { values: number[] | null; unit?: string }) {
  if (values == null) return <span className="muted">—</span>;
  if (!values.length) return <span className="muted">no data</span>;
  return <><strong>{formatDuration(median(values))}</strong>{unit}<span className="small muted"> n={values.length}</span></>;
}

/** How task types, workflows, stages and goals connect, and where time goes from idea to done. */
export function Flow() {
  const tasks = useTasks();
  const stages = useAllStages();
  const events = useAllTaskEvents(5000);
  const templates = useTemplates();
  const goals = useGoals();
  const opps = useOpportunities();
  const links = useOpportunitySignalLinks();
  const { label, options, ready } = useLookups();
  const { member: me } = useMember();
  const { scope } = useScope();
  const { f } = useTaskFilters();
  const [metric, setMetric] = useState<Metric>("totals");
  const today = todayInIndia();

  const model = useMemo(() => {
    if (!tasks.data || !stages.data || !events.data || !templates.data || !goals.data || !opps.data || !links.data) return null;
    const visible = tasks.data.filter((t) => t.kind !== "deliverable" && matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data }));
    const ids = new Set(visible.map((t) => t.id));
    const byTask = stagesByTask(stages.data.filter((s) => ids.has(s.task_id)));
    const evByTask = eventsByTask(events.data.filter((e) => ids.has(e.task_id)));
    const typeCodes = options("task_type").map((o) => o.code);
    const types = flowByType(visible, byTask, evByTask, templates.data, typeCodes);
    const stageCodes = options("workflow_stage").map((o) => o.code).filter((c) => c !== "completed");
    const usedStages = [...stageCodes, ...new Set(types.flatMap((r) => [...r.cells.keys()]).filter((c) => !stageCodes.includes(c)))]
      .filter((c) => types.some((r) => r.cells.get(c)?.inWorkflow));
    const goalRows = flowByGoal(f.goal && f.goal !== "none" ? goals.data.filter((g) => g.id === f.goal) : goals.data, visible, byTask, new Date().toISOString());
    const idea = ideaToExecution({ opportunities: scope === "me" ? opps.data.filter((o) => o.created_by === me.id || o.decided_by === me.id) : opps.data, links: links.data, tasks: visible, stages: byTask, events: evByTask });
    return { visible, types, usedStages, goalRows, idea };
  }, [tasks.data, stages.data, events.data, templates.data, goals.data, opps.data, links.data, f, me.id, today, scope, options]);

  const failed = [tasks, stages, events, templates, goals, opps, links].find((q) => q.isError);
  if (failed) return <StatePanel title="Could not load flow data" tone="error"><p>{failed.error?.message}</p></StatePanel>;
  if (!model || !ready) return <Loading />;

  const { types, usedStages, goalRows, idea } = model;
  const all = <T,>(pick: (r: (typeof types)[number]) => T[]) => types.flatMap(pick);
  const matrixMax = Math.max(1, ...types.flatMap((r) => usedStages.map((c) => median(r.cells.get(c)?.[metric] ?? []) ?? 0)));

  return (
    <div className="flow">
      <p className="muted small">
        How each task type maps to a workflow, its stages and goals, and how long work waits between steps. Medians from recorded
        timestamps; <em>n</em> is the sample size. The Workspace filters apply to tasks; ideas (signals and opportunities) are always shown in full.
      </p>

      <div className="flow-kpis" aria-label="Flow headlines">
        <div className="flow-kpi"><span className="flow-kpi__label">Idea → done</span><Med values={idea.leadTimes} /><span className="small muted">first signal or idea to approved work</span></div>
        <div className="flow-kpi"><span className="flow-kpi__label">Task cycle</span><Med values={all((r) => r.cycles)} /><span className="small muted">task created → approved</span></div>
        <div className="flow-kpi"><span className="flow-kpi__label">Start wait</span><Med values={all((r) => r.startWaits)} /><span className="small muted">created → first stage picked up</span></div>
        <div className="flow-kpi"><span className="flow-kpi__label">Hand-off wait</span><Med values={all((r) => r.handoffWaits)} /><span className="small muted">handed off → next owner picks up</span></div>
        <div className="flow-kpi"><span className="flow-kpi__label">Approval wait</span><Med values={all((r) => r.approvalWaits)} /><span className="small muted">submitted → admin decision</span></div>
      </div>

      <h2 className="section-title">Idea to execution</h2>
      <ol className="flow-chain" aria-label="Idea to execution steps">
        {idea.steps.map((s, i) => {
          const lag = idea.lags[i];
          const prev = idea.steps[i - 1];
          return (
            <li key={s.key} className="flow-chain__item">
              <div className={`flow-step${i >= 4 ? " flow-step--work" : ""}`} title={s.hint}>
                <span className="flow-step__count">{s.count}</span>
                <span className="flow-step__label">{s.label}</span>
                {prev && prev.count > 0 && i !== 4 && <span className="small muted">{Math.round((100 * s.count) / prev.count)}% of previous</span>}
              </div>
              {lag && i < idea.steps.length - 1 && (
                <div className="flow-lag" aria-label={`Lag ${lag.label}`}>
                  <span className="flow-lag__value"><Med values={lag.values} /></span>
                  <span className="flow-lag__label">{lag.label}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="small muted">Steps 1–4 are opportunities (Content Opportunities); steps 5–9 are Workspace tasks. Approval → publish date uses the planned publish date, in days.</p>

      <h2 className="section-title">By task type</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Task type</th><th>Default workflow</th><th>Open</th><th>Done</th><th>Median cycle</th><th>Start wait</th><th>Hand-off wait</th><th>Approval wait</th><th>Reworked</th><th>Slowest stage</th></tr></thead>
          <tbody>
            {types.map((r) => {
              const slow = slowestStage(r);
              return (
                <tr key={r.type}>
                  <td><Link to={`/workspace/list?type=${r.type}&status=all`}>{label("task_type", r.type)}</Link></td>
                  <td className="small">{r.template?.name ?? <span className="muted">none</span>}</td>
                  <td>{r.open}</td>
                  <td>{r.done}</td>
                  <td><Med values={r.cycles} /></td>
                  <td><Med values={r.startWaits} /></td>
                  <td><Med values={r.handoffWaits} /></td>
                  <td><Med values={r.approvalWaits} /></td>
                  <td>{r.tasks ? `${Math.round((100 * r.reworked) / r.tasks)}%` : "—"}<span className="small muted"> n={r.tasks}</span></td>
                  <td className="small">{slow ? <>{label("workflow_stage", slow.stage)} · <strong>{formatDuration(slow.minutes)}</strong></> : <span className="muted">no data</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flow-head section-title">
        <h2>Where time goes: task type × stage</h2>
        <div className="viewswitch" role="group" aria-label="Measure">
          {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
            <button key={m} type="button" className={metric === m ? "is-on" : undefined} aria-pressed={metric === m} onClick={() => setMetric(m)}>{METRIC_LABEL[m]}</button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="flow-matrix">
          <thead><tr><th>Task type</th>{usedStages.map((c) => <th key={c} className="flow-matrix__stage">{label("workflow_stage", c)}</th>)}</tr></thead>
          <tbody>
            {types.map((r) => (
              <tr key={r.type}>
                <th scope="row">{label("task_type", r.type)}</th>
                {usedStages.map((c) => <MatrixCell key={c} cell={r.cells.get(c)} metric={metric} max={matrixMax} title={`${label("task_type", r.type)} · ${label("workflow_stage", c)}`} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Darker = longer median {METRIC_LABEL[metric].toLowerCase()}. “·” = stage not in this type’s workflow. Stage time = stage entered → completed
        (wait + working time). After a return for rework, a stage’s timestamps restart, so these figures cover the latest pass; rework counts are in the table above.
      </p>

      <h2 className="section-title">How work is mapped</h2>
      <div className="flow-map">
        {types.map((r) => {
          const goalsHere = goalRows.map((g) => ({ g, n: g.byType.get(r.type) ?? 0 })).filter((x) => x.n > 0);
          return (
            <section key={r.type} className="card flow-map__card">
              <p className="eyebrow">Task type</p>
              <h3>{label("task_type", r.type)}</h3>
              <p className="small muted">Workflow: <strong>{r.template?.name ?? "none set"}</strong></p>
              <ol className="flow-stages">
                {(r.template?.workflow_template_stages ?? []).slice().sort((a, b) => a.position - b.position).map((s) => (
                  <li key={s.id} className={s.is_optional ? "is-optional" : undefined} title={s.is_optional ? "Optional — can be skipped per task" : undefined}>
                    {label("workflow_stage", s.stage_code)}
                  </li>
                ))}
              </ol>
              <p className="small muted flow-map__goals">
                Goals:{" "}
                {goalsHere.length === 0 ? "none linked" : goalsHere.map(({ g, n }, i) => (
                  <span key={g.goal.id}>{i > 0 && ", "}<Link to={`/workspace/goals?goal=${g.goal.id}&status=all`}>{g.goal.title}</Link> ({n})</span>
                ))}
              </p>
            </section>
          );
        })}
      </div>

      <h2 className="section-title">Goals</h2>
      {goalRows.length === 0 ? <p className="muted small">No goals yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Goal</th><th>Task types</th><th>Open</th><th>Done</th><th>Median cycle</th><th>Open work is at</th><th>Oldest open</th></tr></thead>
            <tbody>
              {goalRows.map((g) => (
                <tr key={g.goal.id}>
                  <td className="wrap"><Link to={`/workspace/goals?goal=${g.goal.id}&status=all`}>{g.goal.title}</Link></td>
                  <td className="wrap small">{g.byType.size === 0 ? <span className="muted">no tasks</span> : [...g.byType].map(([t, n]) => `${label("task_type", t)} ×${n}`).join(", ")}</td>
                  <td>{g.open}</td>
                  <td>{g.done}</td>
                  <td><Med values={g.cycles} /></td>
                  <td className="wrap small">{g.openByStage.size === 0 ? <span className="muted">—</span> : [...g.openByStage].map(([s, n]) => `${label("workflow_stage", s)} ×${n}`).join(", ")}</td>
                  <td>{g.oldestOpenMinutes == null ? <span className="muted">—</span> : formatDuration(g.oldestOpenMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MatrixCell({ cell, metric, max, title }: { cell: StageCell | undefined; metric: Metric; max: number; title: string }) {
  if (!cell?.inWorkflow) return <td className="flow-matrix__off" aria-label="Not in workflow">·</td>;
  const m = median(cell[metric]);
  if (m == null) return <td className="flow-matrix__nodata" title={`${title}: no recorded data yet`}>no data</td>;
  const detail = `${title}\nStage time ${formatDuration(median(cell.totals))} · wait ${formatDuration(median(cell.waits))} · working ${formatDuration(median(cell.works))}\nUsed ${cell.used}× (n=${cell[metric].length})`;
  return (
    <td className="flow-matrix__cell" style={{ "--v": String(m / max) } as React.CSSProperties} title={detail}>
      <strong>{formatDuration(m)}</strong><span className="small muted"> n={cell[metric].length}</span>
    </td>
  );
}
