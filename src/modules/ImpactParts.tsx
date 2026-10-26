// Business impact panels shared by the task panel, Goals and the Impact Brief (D-030).
import { Link } from "react-router";
import { type Goal, type ImpactAssessment, type Task, useImpactAssessments, useLookups, useRequestAssessment } from "../lib/api.ts";
import {formatDateTime} from "../lib/format.ts";
import {
  EVIDENCE_LABEL, GOAL_FLAG_TEXT, type GoalAssessmentOut, type GoalRollup, IMPORTANCE_LABEL, latestFor, missingImpact,
  OUTCOME_STATUS_LABEL, type Rated, ratingLabel, type TaskAssessmentOut,
} from "../lib/impact.ts";
import { ErrorText } from "../components/Form.tsx";
import "../impact.css";

const TONE: Record<string, string> = {
  high: "good", strong: "good", direct: "good", clear: "good", measurable: "good", likely: "good", sufficient: "good", proceed: "good",
  medium: "mid", partial: "mid", moderate: "mid", indirect: "mid", partly_clear: "mid", partly_measurable: "mid", qualitative_only: "mid", thin: "mid", clarify: "mid", link_to_goal: "mid",
  low: "low", weak: "low", none: "low", at_risk: "low", unlikely: "low", overloaded: "low", not_measurable: "low", rescope: "low", deprioritise: "low",
};

/** A rating is always shown with its words; colour only supports it. */
export function RatingChip({ value, label }: { value: string; label?: string }) {
  return <span className={`rating rating--${TONE[value] ?? "neutral"}`}>{label ? <span className="rating__k">{label}</span> : null}{ratingLabel(value)}</span>;
}

function RatedRow({ label, r }: { label: string; r: Rated }) {
  return (
    <div className="rated">
      <RatingChip value={r.rating} label={label} />
      <p className="small">{r.reasoning}</p>
    </div>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div className="impact-bullets"><h4>{title}</h4><ul className="small">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

/** Request a new AI assessment; shows the newest request's state. */
export function AssessButton({ subject, id, newest }: { subject: "task" | "goal"; id: string; newest: ImpactAssessment | null }) {
  const req = useRequestAssessment();
  const running = newest && (newest.status === "queued" || newest.status === "running");
  return (
    <div className="assess">
      <button type="button" className="button button--small" disabled={req.isPending || Boolean(running)}
        onClick={() => req.mutate(subject === "task" ? { subject, task_id: id } : { subject, goal_id: id })}>
        {running ? "Assessing…" : newest ? "Re-assess with AI" : "Assess with AI"}
      </button>
      {newest?.status === "failed" && <span className="small assess__error">Last assessment failed: {newest.error ?? "unknown error"}</span>}
      <ErrorText error={req.error} />
    </div>
  );
}

function AiFooter({ a }: { a: ImpactAssessment }) {
  return <p className="small muted ai-foot">AI assessment {formatDateTime(a.completed_at ?? a.created_at)}{a.model ? ` · ${a.model}` : ""}. An expectation from the recorded facts, not a result — check it before acting.</p>;
}

// ---------------------------------------------------------------- task
export function TaskImpactPanel({ task }: { task: Task }) {
  const all = useImpactAssessments();
  const { newest, ready } = latestFor(all.data ?? [], "task", task.id);
  const a = ready?.output as TaskAssessmentOut | undefined;
  const missing = task.parent_id ? [] : missingImpact(task);
  return (
    <section className="card impact-card">
      <header className="impact-card__head">
        <h2>Expected business impact</h2>
        <AssessButton subject="task" id={task.id} newest={newest} />
      </header>
      {task.parent_id && missingImpact(task).length === 5 ? (
        <p className="small muted">This is a part of a deliverable: its expected business impact is the deliverable's (see the deliverable above). The AI assessment still judges this part's contribution.</p>
      ) : missing.length === 5 ? (
        <p className="small muted">No impact case recorded yet. {task.goal_id ? "" : "This task is standalone, which is fine. "}Edit the task to add why it matters to the business.</p>
      ) : (
        <dl className="impact-dl">
          <dt>Outcome</dt><dd>{task.impact_outcome ?? <em className="muted">not given</em>}</dd>
          <dt>Rationale</dt><dd>{task.impact_rationale ?? <em className="muted">not given</em>}</dd>
          <dt>Audience / channel</dt><dd>{task.impact_audience ?? <em className="muted">not given</em>}</dd>
          <dt>Success metrics</dt><dd>{task.impact_metrics ?? <em className="muted">not given</em>}</dd>
          <dt>Evidence</dt><dd>{task.impact_evidence ? EVIDENCE_LABEL[task.impact_evidence] : <em className="muted">not given</em>}</dd>
          {task.impact_dependencies && <><dt>Dependencies</dt><dd>{task.impact_dependencies}</dd></>}
          {task.impact_risks && <><dt>Risks</dt><dd>{task.impact_risks}</dd></>}
        </dl>
      )}
      {missing.length > 0 && missing.length < 5 && <p className="small impact-warn">Missing: {missing.join(", ")}.</p>}
      {a && ready && (
        <div className="ai-block">
          {a.summary && <p>{a.summary}</p>}
          <RatedRow label="Expected impact" r={a.expected_impact} />
          <RatedRow label="Strategic alignment" r={a.strategic_alignment} />
          <RatedRow label="Evidence strength" r={a.evidence_strength} />
          <RatedRow label="Goal contribution" r={a.goal_contribution} />
          <RatedRow label="Recommended" r={a.recommended_action} />
          <Bullets title="Missing information" items={a.missing_information} />
          <Bullets title="Risks" items={a.risks} />
          <Bullets title="Caveats" items={a.caveats} />
          <AiFooter a={ready} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- goal
function Bar({ label, pct, text, tone }: { label: string; pct: number | null; text: string; tone: "work" | "outcome" }) {
  return (
    <div className={`dual-bar dual-bar--${tone}`}>
      <div className="dual-bar__top"><span>{label}</span><strong>{text}</strong></div>
      <div className="dual-bar__track" role="img" aria-label={`${label}: ${text}`}>
        {pct != null && <div className="dual-bar__fill" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

export function GoalImpactPanel({ goal, rollup, compact = false }: { goal: Goal; rollup: GoalRollup; compact?: boolean }) {
  const all = useImpactAssessments();
  const { memberName } = useLookups();
  const { newest, ready } = latestFor(all.data ?? [], "goal", goal.id);
  const a = ready?.output as GoalAssessmentOut | undefined;
  const r = rollup;
  const outcomeText = goal.outcome_kind === "measurable" && goal.outcome_target != null
    ? `${goal.outcome_actual ?? "—"} of ${goal.outcome_target}${goal.outcome_unit ? ` ${goal.outcome_unit}` : ""} · ${OUTCOME_STATUS_LABEL[goal.outcome_status]}`
    : OUTCOME_STATUS_LABEL[goal.outcome_status];
  return (
    <div className="goal-impact">
      {goal.outcome_statement ? (
        <div className="goal-impact__outcome">
          <p><strong>Business outcome:</strong> {goal.outcome_statement}</p>
          {!compact && goal.outcome_rationale && <p className="small"><strong>Why:</strong> {goal.outcome_rationale}</p>}
          {!compact && goal.success_measures && <p className="small"><strong>Success measures:</strong> {goal.success_measures}
            {goal.outcome_kind === "measurable" && goal.outcome_metric && <> · {goal.outcome_metric}{goal.outcome_baseline != null && <> from {goal.outcome_baseline}</>} to {goal.outcome_target}{goal.outcome_unit ? ` ${goal.outcome_unit}` : ""}</>}
          </p>}
          {goal.importance && <span className="chip">{IMPORTANCE_LABEL[goal.importance]} importance</span>}
        </div>
      ) : <p className="small impact-warn">No business outcome recorded. Edit the goal to describe the outcome, rationale and success measures.</p>}

      <div className="dual">
        <Bar tone="work" label="Task completion" pct={r.taskCompletionPct} text={r.taskCompletionPct != null ? `${r.taskCompletionPct}%` : "no linked tasks"} />
        <Bar tone="outcome" label="Business outcome" pct={r.outcomePct} text={outcomeText} />
      </div>
      <p className="small muted">Task completion tracks the work. The business outcome is recorded separately{goal.outcome_assessed_at ? ` (last recorded ${formatDateTime(goal.outcome_assessed_at)} by ${memberName(goal.outcome_assessed_by)})` : ""} — finishing tasks does not mean the outcome was achieved.</p>

      <div className="rollup">
        <span><strong>{r.open.length}</strong> open · <strong>{r.done.length}</strong> done</span>
        <span><strong>{Math.round((r.openEffortMinutes / 60) * 10) / 10} h</strong> open effort{r.unestimatedOpen ? ` (+${r.unestimatedOpen} unestimated)` : ""}</span>
        <span>Expected impact of linked tasks: {(["high", "medium", "low", "unclear"] as const).filter((k) => r.impact[k]).map((k) => `${r.impact[k]} ${k}`).join(", ") || "none assessed"}{r.impact.unassessed ? ` · ${r.impact.unassessed} not assessed` : ""}</span>
      </div>

      {r.flags.length > 0 && (
        <ul className="flags">
          {r.flags.map((f) => <li key={f} className={`flag flag--${f}`}>{GOAL_FLAG_TEXT[f]}</li>)}
        </ul>
      )}
      {!compact && (r.unclearContributors.length > 0 || r.missingImpact.length > 0) && (
        <p className="small">
          {r.unclearContributors.length > 0 && <>Unclear contribution: {r.unclearContributors.map((t) => <TaskLink key={t.id} t={t} />)}. </>}
          {r.missingImpact.length > 0 && <>No impact case: {r.missingImpact.map((t) => <TaskLink key={t.id} t={t} />)}.</>}
        </p>
      )}
      {!compact && (r.risks.length > 0 || r.dependencies.length > 0) && (
        <div className="impact-bullets">
          <h4>Risks and dependencies from linked tasks</h4>
          <ul className="small">
            {r.risks.map((x, i) => <li key={`r${i}`}><strong>{x.ref}</strong>: {x.text}</li>)}
            {r.dependencies.map((x, i) => <li key={`d${i}`}><strong>{x.ref}</strong> depends on: {x.text}</li>)}
          </ul>
        </div>
      )}

      {!compact && (
        <div className="ai-block">
          <div className="impact-card__head">
            <h4>AI goal assessment</h4>
            <AssessButton subject="goal" id={goal.id} newest={newest} />
          </div>
          {a && ready ? (
            <>
              {a.summary && <p>{a.summary}</p>}
              <RatedRow label="Strategic importance" r={a.strategic_importance} />
              <RatedRow label="Clarity" r={a.clarity} />
              <RatedRow label="Measurability" r={a.measurability} />
              <RatedRow label="Feasibility" r={a.feasibility} />
              <RatedRow label="Expected impact" r={a.expected_impact} />
              <RatedRow label="Supporting work" r={a.supporting_work} />
              {a.task_contributions.length > 0 && (
                <div className="impact-bullets">
                  <h4>Task contributions</h4>
                  <ul className="small">{a.task_contributions.map((c) => <li key={c.task_ref}><RatingChip value={c.contribution} label={c.task_ref} /> {c.reasoning}</li>)}</ul>
                </div>
              )}
              <Bullets title="Gaps" items={a.gaps} />
              <Bullets title="Risks" items={a.risks} />
              <Bullets title="Recommended actions" items={a.recommended_actions} />
              <Bullets title="Caveats" items={a.caveats} />
              <AiFooter a={ready} />
            </>
          ) : <p className="small muted">Not assessed yet. The assessment looks at the outcome, its measures and every linked task's impact case, effort, status and risks.</p>}
        </div>
      )}
    </div>
  );
}

function TaskLink({ t }: { t: Task }) {
  return <Link className="inline-ref" to={`/workspace?task=${t.ref}`}>{t.title}</Link>;
}

export const GoalLink = ({ g }: { g: Goal }) => <Link to={`/goals#goal-${g.ref}`}>{g.title}</Link>;
