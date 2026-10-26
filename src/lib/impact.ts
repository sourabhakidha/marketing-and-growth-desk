// Business impact view model (D-030). Pure functions over recorded data and
// stored AI assessments. Rules that hold everywhere:
//   * expected impact is an expectation, never a result;
//   * task completion is never treated as business-outcome achievement — only a
//     goal's recorded outcome status says that;
//   * tasks may stand alone without a goal.
import type { Goal, GoalProgress, ImpactAssessment, Task } from "./api.ts";
import { type DateRange, inRange, overlaps } from "./dateRange.ts";
import { goalRef, taskRef } from "./format.ts";

// ---------------------------------------------------------------- labels
export const EVIDENCE_LABEL: Record<string, string> = {
  hypothesis: "Hypothesis", historical: "Historical evidence", committed: "Committed target",
};
export const EVIDENCE_HELP: Record<string, string> = {
  hypothesis: "A belief we have not tested yet",
  historical: "Based on past results or data",
  committed: "An agreed business target",
};
export const IMPORTANCE_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const OUTCOME_STATUS_LABEL: Record<Goal["outcome_status"], string> = {
  not_assessed: "Not assessed", not_started: "Not started", in_progress: "In progress",
  partially_achieved: "Partly achieved", achieved: "Achieved", not_achieved: "Not achieved",
};
export const RATING_LABEL: Record<string, string> = {
  high: "High", medium: "Medium", low: "Low", unclear: "Unclear",
  strong: "Strong", partial: "Partial", weak: "Weak", moderate: "Moderate", none: "None",
  direct: "Direct", indirect: "Indirect", no_goal: "Standalone",
  proceed: "Proceed", clarify: "Clarify", rescope: "Rescope", deprioritise: "Deprioritise", link_to_goal: "Link to a goal",
  clear: "Clear", partly_clear: "Partly clear", measurable: "Measurable", partly_measurable: "Partly measurable",
  qualitative_only: "Qualitative only", not_measurable: "Not measurable", likely: "Likely", at_risk: "At risk", unlikely: "Unlikely",
  sufficient: "Sufficient", thin: "Thin", overloaded: "Overloaded",
};
export const ratingLabel = (r: string | null | undefined) => (r ? RATING_LABEL[r] ?? r : "—");

// ---------------------------------------------------------------- assessments
export interface Rated { rating: string; reasoning: string }
export interface TaskAssessmentOut {
  summary: string; expected_impact: Rated; strategic_alignment: Rated; evidence_strength: Rated; goal_contribution: Rated;
  missing_information: string[]; risks: string[]; recommended_action: Rated; caveats: string[];
}
export interface GoalAssessmentOut {
  summary: string; strategic_importance: Rated; clarity: Rated; measurability: Rated; feasibility: Rated; expected_impact: Rated;
  supporting_work: Rated; task_contributions: { task_ref: string; contribution: string; reasoning: string }[];
  gaps: string[]; risks: string[]; recommended_actions: string[]; caveats: string[];
}
export interface BriefOut {
  headline: string; highest_impact: { ref: string; reason: string }[]; outcome_progress: string; capacity: string;
  concerns: { ref: string; issue: string }[]; recommended_priorities: { action: string; reason: string }[]; caveats: string[];
}

/** Newest assessment for a task or goal, plus the newest finished one (shown while a new one runs). */
export function latestFor(all: ImpactAssessment[], subject: "task" | "goal", id: string) {
  const mine = all.filter((a) => a.subject === subject && (subject === "task" ? a.task_id : a.goal_id) === id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { newest: mine[0] ?? null, ready: mine.find((a) => a.status === "ready") ?? null };
}

export function taskAssessment(all: ImpactAssessment[], taskId: string): TaskAssessmentOut | null {
  return (latestFor(all, "task", taskId).ready?.output ?? null) as TaskAssessmentOut | null;
}

// ---------------------------------------------------------------- task impact case
export const IMPACT_REQUIRED: (keyof Task)[] = ["impact_outcome", "impact_rationale", "impact_audience", "impact_metrics", "impact_evidence"];

export function missingImpact(t: Task): string[] {
  const names: Record<string, string> = {
    impact_outcome: "business outcome", impact_rationale: "rationale", impact_audience: "audience / channel",
    impact_metrics: "success metrics", impact_evidence: "evidence level",
  };
  return IMPACT_REQUIRED.filter((k) => !t[k]).map((k) => names[k]!);
}

const IMPACT_SCORE: Record<string, number> = { high: 3, medium: 2, low: 1, unclear: 0 };
const IMPORTANCE_SCORE: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const PRIORITY_SCORE: Record<string, number> = { high: 2, medium: 1, low: 0 };
const EVIDENCE_SCORE: Record<string, number> = { committed: 1, historical: 1, hypothesis: 0 };

// a request (D-033) is not open work until an admin accepts it
const OPEN = (t: Task) => t.status !== "done" && t.status !== "cancelled" && t.status !== "requested";
// D-038: a deliverable is an umbrella — its parts are the work (capacity, effort); a part inherits the impact case
const IS_WORK = (t: Task) => t.kind !== "deliverable";
const NEEDS_OWN_IMPACT = (t: Task) => !t.parent_id;
const GOAL_CLOSED = new Set(["achieved", "not_achieved", "cancelled"]);

export interface Ranked { ref: string; title: string; score: number; reasons: string[] }

/**
 * Rank tasks by *expected* impact: AI rating (if assessed), the importance of the goal it
 * serves, priority, and evidence level. Every point comes with a reason; nothing is invented.
 */
export function rankTasks(tasks: Task[], goals: Goal[], assessments: ImpactAssessment[]): Ranked[] {
  return tasks.map((t) => {
    const a = taskAssessment(assessments, t.id);
    const g = goals.find((x) => x.id === t.goal_id);
    const reasons: string[] = [];
    let score = 0;
    if (a) {
      score += 2 * (IMPACT_SCORE[a.expected_impact.rating] ?? 0);
      reasons.push(`AI expects ${ratingLabel(a.expected_impact.rating).toLowerCase()} impact: ${a.expected_impact.reasoning}`);
    } else reasons.push("Not assessed by AI yet");
    if (g?.importance) { score += IMPORTANCE_SCORE[g.importance] ?? 0; reasons.push(`Serves “${g.title}” (${IMPORTANCE_LABEL[g.importance]?.toLowerCase()} importance)`); }
    else if (!g) reasons.push("Standalone task");
    if (t.priority) { score += PRIORITY_SCORE[t.priority] ?? 0; reasons.push(`${t.priority} priority`); }
    if (t.impact_evidence) { score += EVIDENCE_SCORE[t.impact_evidence] ?? 0; reasons.push(EVIDENCE_LABEL[t.impact_evidence]!); }
    else reasons.push("No impact case recorded");
    return { ref: taskRef(t.ref), title: t.title, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- goal roll-up
export const OVERLOAD_OPEN_TASKS = 8;
export const OVERLOAD_OPEN_HOURS = 40;

export type GoalFlag =
  | "no_outcome_defined" | "no_supporting_work" | "important_without_work" | "thin_support" | "overloaded"
  | "unclear_contributors" | "tasks_missing_impact" | "blocked_work" | "past_end_date" | "tasks_done_outcome_open";

export const GOAL_FLAG_TEXT: Record<GoalFlag, string> = {
  no_outcome_defined: "No business outcome recorded for this goal",
  no_supporting_work: "No open work supports this goal",
  important_without_work: "Important business outcome with no supporting work",
  thin_support: "Only one open task supports an important outcome",
  overloaded: "Overloaded: a lot of open work is attached to this goal",
  unclear_contributors: "Some linked tasks don't clearly contribute",
  tasks_missing_impact: "Some linked tasks have no impact case",
  blocked_work: "Linked work is blocked",
  past_end_date: "Past its end date without a recorded outcome",
  tasks_done_outcome_open: "All linked tasks are done, but the business outcome is not recorded as achieved",
};

export interface GoalRollup {
  goal: Goal;
  linked: Task[]; open: Task[]; done: Task[];
  openEffortMinutes: number; unestimatedOpen: number;
  impact: Record<"high" | "medium" | "low" | "unclear" | "unassessed", number>;
  unclearContributors: Task[]; missingImpact: Task[]; blocked: Task[];
  risks: { ref: string; text: string }[]; dependencies: { ref: string; text: string }[];
  taskCompletionPct: number | null;
  outcomePct: number | null;
  flags: GoalFlag[];
  active: boolean;
}

/** Outcome achievement from recorded values only; null when there is nothing measurable recorded. */
export function outcomePct(g: Goal): number | null {
  if (g.outcome_kind !== "measurable" || g.outcome_target == null || g.outcome_actual == null) return null;
  const base = g.outcome_baseline ?? 0;
  const span = g.outcome_target - base;
  if (span === 0) return null;
  return Math.max(0, Math.min(100, Math.round((100 * (g.outcome_actual - base)) / span)));
}

export function goalRollup(goal: Goal, tasks: Task[], progress: GoalProgress | undefined, assessments: ImpactAssessment[], today: string): GoalRollup {
  const linked = tasks.filter((t) => t.goal_id === goal.id && t.status !== "cancelled");
  const open = linked.filter(OPEN);
  const done = linked.filter((t) => t.status === "done");
  const impact = { high: 0, medium: 0, low: 0, unclear: 0, unassessed: 0 };
  const unclearContributors: Task[] = [];
  for (const t of linked) {
    const a = taskAssessment(assessments, t.id);
    const r = a?.expected_impact.rating as keyof typeof impact | undefined;
    impact[r && r in impact ? r : "unassessed"] += 1;
    if (OPEN(t) && a && ["unclear", "none"].includes(a.goal_contribution.rating)) unclearContributors.push(t);
  }
  const missing = open.filter((t) => NEEDS_OWN_IMPACT(t) && missingImpact(t).length > 0);
  const blocked = open.filter((t) => t.status === "blocked");
  const openEffortMinutes = open.filter(IS_WORK).reduce((n, t) => n + (t.estimated_minutes ?? 0), 0);
  const active = !GOAL_CLOSED.has(goal.status);
  const important = goal.importance === "critical" || goal.importance === "high";

  const flags: GoalFlag[] = [];
  if (!goal.outcome_statement) flags.push("no_outcome_defined");
  if (active && open.length === 0 && goal.outcome_status !== "achieved") flags.push(important ? "important_without_work" : "no_supporting_work");
  if (active && important && open.length === 1) flags.push("thin_support");
  if (active && (open.length >= OVERLOAD_OPEN_TASKS || openEffortMinutes >= OVERLOAD_OPEN_HOURS * 60)) flags.push("overloaded");
  if (unclearContributors.length) flags.push("unclear_contributors");
  if (missing.length) flags.push("tasks_missing_impact");
  if (blocked.length) flags.push("blocked_work");
  if (active && goal.end_date && goal.end_date < today && !["achieved", "not_achieved"].includes(goal.outcome_status)) flags.push("past_end_date");
  if (linked.length > 0 && open.length === 0 && goal.outcome_status !== "achieved") flags.push("tasks_done_outcome_open");

  return {
    goal, linked, open, done, openEffortMinutes, unestimatedOpen: open.filter((t) => !t.estimated_minutes).length,
    impact, unclearContributors, missingImpact: missing, blocked,
    risks: linked.filter((t) => t.impact_risks).map((t) => ({ ref: t.title, text: t.impact_risks! }))
      .concat(blocked.map((t) => ({ ref: t.title, text: `Blocked: ${t.blocker_reason ?? "reason not recorded"}` }))),
    dependencies: linked.filter((t) => t.impact_dependencies).map((t) => ({ ref: t.title, text: t.impact_dependencies! })),
    taskCompletionPct: progress?.progress_pct ?? null,
    outcomePct: outcomePct(goal),
    flags,
    active,
  };
}

// ---------------------------------------------------------------- period brief
export interface CapacityRow { key: string; label: string; openTasks: number; openHours: number; activeTasks: number; approvedInPeriod: number }

export interface PeriodBrief {
  range: DateRange;
  activeTasks: Task[];       // open at some point in the period
  approvedTasks: Task[];     // approved (Done) in the period
  createdTasks: Task[];
  rankedTasks: Ranked[];
  rankedGoals: Ranked[];
  rollups: GoalRollup[];
  byGoal: CapacityRow[];
  byPerson: CapacityRow[];
  lowImpact: { ref: string; title: string; why: string }[];
  neglectedGoals: { ref: string; title: string; why: string }[];
  blockers: { ref: string; title: string; why: string }[];
  actions: { action: string; why: string }[];
}

const closedAt = (t: Task) => (t.status === "done" ? t.completed_at : t.status === "cancelled" ? t.updated_at : null);
const hours = (min: number) => Math.round((min / 60) * 10) / 10;

export function periodBrief(input: {
  range: DateRange; today: string; tasks: Task[]; goals: Goal[]; progress: GoalProgress[]; assessments: ImpactAssessment[];
  activityTaskIds: Set<string>; memberName: (id: string) => string;
}): PeriodBrief {
  const { range, today, tasks, goals, progress, assessments, activityTaskIds, memberName } = input;
  const live = tasks.filter((t) => t.status !== "cancelled");
  const activeTasks = live.filter((t) => overlaps(t.created_at, closedAt(t), range));
  const approvedTasks = live.filter((t) => t.status === "done" && inRange(t.completed_at, range));
  const createdTasks = live.filter((t) => inRange(t.created_at, range));
  const periodGoals = goals.filter((g) => overlaps(g.start_date, g.end_date, range) && g.status !== "cancelled");
  const rollups = periodGoals.map((g) => goalRollup(g, tasks, progress.find((p) => p.goal_id === g.id), assessments, today));

  const rankedGoals: Ranked[] = rollups.map((r) => {
    const reasons: string[] = [];
    let score = IMPORTANCE_SCORE[r.goal.importance ?? ""] ?? 0;
    if (r.goal.importance) reasons.push(`${IMPORTANCE_LABEL[r.goal.importance]} importance`);
    else reasons.push("Importance not set");
    const ga = (latestFor(assessments, "goal", r.goal.id).ready?.output ?? null) as GoalAssessmentOut | null;
    if (ga) { score += 2 * (IMPACT_SCORE[ga.expected_impact.rating] ?? 0); reasons.push(`AI expects ${ratingLabel(ga.expected_impact.rating).toLowerCase()} impact: ${ga.expected_impact.reasoning}`); }
    if (r.impact.high) { score += 1; reasons.push(`${r.impact.high} linked task${r.impact.high > 1 ? "s" : ""} rated high impact`); }
    if (r.goal.outcome_kind === "measurable") reasons.push(`Measured by ${r.goal.outcome_metric}`);
    return { ref: goalRef(r.goal.ref), title: r.goal.title, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const capacity = (key: string, label: string, pick: (t: Task) => boolean): CapacityRow => {
    const open = live.filter((t) => OPEN(t) && IS_WORK(t) && pick(t));
    return {
      key, label, openTasks: open.length, openHours: hours(open.reduce((n, t) => n + (t.estimated_minutes ?? 0), 0)),
      activeTasks: activeTasks.filter((t) => IS_WORK(t) && pick(t)).length, approvedInPeriod: approvedTasks.filter((t) => IS_WORK(t) && pick(t)).length,
    };
  };
  const goalIds = new Set(live.map((t) => t.goal_id).filter(Boolean) as string[]);
  const byGoal = [...goals.filter((g) => goalIds.has(g.id) || periodGoals.includes(g)).map((g) => capacity(g.id, g.title, (t) => t.goal_id === g.id)),
    capacity("none", "Standalone (no goal)", (t) => !t.goal_id)].filter((r) => r.openTasks || r.activeTasks || r.approvedInPeriod || r.key !== "none");
  const owners = [...new Set(live.map((t) => t.owner_id))];
  const byPerson = owners.map((o) => capacity(o, memberName(o), (t) => t.owner_id === o)).sort((a, b) => b.openHours - a.openHours || b.openTasks - a.openTasks);

  const lowImpact = activeTasks.filter(OPEN).flatMap((t) => {
    const a = taskAssessment(assessments, t.id);
    const missing = NEEDS_OWN_IMPACT(t) ? missingImpact(t) : [];
    const why = a?.expected_impact.rating === "low" ? `AI expects low impact: ${a.expected_impact.reasoning}`
      : a && ["deprioritise", "rescope"].includes(a.recommended_action.rating) ? `AI recommends: ${ratingLabel(a.recommended_action.rating).toLowerCase()} — ${a.recommended_action.reasoning}`
      : missing.length >= 3 ? `Impact case missing: ${missing.join(", ")}`
      : t.impact_evidence === "hypothesis" && !t.impact_metrics ? "Untested hypothesis with no success metric"
      : null;
    return why ? [{ ref: taskRef(t.ref), title: t.title, why }] : [];
  });

  const neglectedGoals = rollups.filter((r) => r.active).flatMap((r) => {
    const touched = r.linked.some((t) => activityTaskIds.has(t.id));
    const why = r.flags.includes("important_without_work") ? GOAL_FLAG_TEXT.important_without_work
      : r.flags.includes("no_supporting_work") ? GOAL_FLAG_TEXT.no_supporting_work
      : !touched && r.open.length ? "No recorded activity on its tasks in this period"
      : null;
    return why ? [{ ref: goalRef(r.goal.ref), title: r.goal.title, why }] : [];
  });

  const blockers = live.filter((t) => t.status === "blocked").map((t) => ({ ref: taskRef(t.ref), title: t.title, why: t.blocker_reason ?? "Reason not recorded" }));

  // concrete next steps for admins, most important first
  const actions: { action: string; why: string }[] = [];
  for (const r of rollups) {
    const g = `“${r.goal.title}”`;
    if (r.flags.includes("important_without_work")) actions.push({ action: `Plan and assign work for ${g}`, why: GOAL_FLAG_TEXT.important_without_work });
    if (r.flags.includes("tasks_done_outcome_open")) actions.push({ action: `Record the actual business outcome for ${g}`, why: GOAL_FLAG_TEXT.tasks_done_outcome_open });
    if (r.flags.includes("past_end_date")) actions.push({ action: `Close or re-plan ${g}`, why: GOAL_FLAG_TEXT.past_end_date });
    if (r.flags.includes("overloaded")) actions.push({ action: `Re-prioritise the ${r.open.length} open tasks under ${g}`, why: GOAL_FLAG_TEXT.overloaded });
    if (r.flags.includes("no_outcome_defined")) actions.push({ action: `Define the business outcome, rationale and success measures for ${g}`, why: GOAL_FLAG_TEXT.no_outcome_defined });
  }
  for (const b of blockers.slice(0, 5)) actions.push({ action: `Unblock “${b.title}”`, why: b.why });
  for (const l of lowImpact.slice(0, 5)) actions.push({ action: `Review whether “${l.title}” is worth the effort`, why: l.why });
  const unjustified = activeTasks.filter((t) => OPEN(t) && NEEDS_OWN_IMPACT(t) && missingImpact(t).length > 0);
  if (unjustified.length) actions.push({ action: `Complete the impact case for ${unjustified.length} open task${unjustified.length > 1 ? "s" : ""} (${unjustified.slice(0, 4).map((t) => `“${t.title}”`).join(", ")}${unjustified.length > 4 ? "…" : ""})`, why: "Their expected business impact can't be judged without it" });
  const unassessed = activeTasks.filter((t) => OPEN(t) && !taskAssessment(assessments, t.id));
  if (unassessed.length) actions.push({ action: `Run AI impact assessments on ${unassessed.length} open task${unassessed.length > 1 ? "s" : ""}`, why: "Ranking uses AI ratings where they exist" });

  return {
    range, activeTasks, approvedTasks, createdTasks,
    rankedTasks: rankTasks(activeTasks.filter(OPEN), goals, assessments),
    rankedGoals, rollups, byGoal, byPerson, lowImpact, neglectedGoals, blockers, actions,
  };
}

/** Compact, reference-only data for the AI brief (no personal data beyond team names). */
export function briefInput(b: PeriodBrief, goals: Goal[], memberName: (id: string) => string) {
  return {
    counts: { active_tasks: b.activeTasks.length, approved_in_period: b.approvedTasks.length, created_in_period: b.createdTasks.length },
    goals: b.rollups.map((r) => ({
      ref: goalRef(r.goal.ref), title: r.goal.title, importance: r.goal.importance, outcome: r.goal.outcome_statement,
      success_measures: r.goal.success_measures, outcome_kind: r.goal.outcome_kind, outcome_metric: r.goal.outcome_metric,
      outcome_target: r.goal.outcome_target, outcome_actual: r.goal.outcome_actual, outcome_status: r.goal.outcome_status,
      task_completion_pct: r.taskCompletionPct, open_tasks: r.open.length, done_tasks: r.done.length,
      open_effort_hours: hours(r.openEffortMinutes), flags: r.flags.map((f) => GOAL_FLAG_TEXT[f]),
    })),
    top_tasks: b.rankedTasks.slice(0, 12).map((t) => ({ ref: t.ref, title: t.title, reasons: t.reasons })),
    approved_tasks: b.approvedTasks.slice(0, 30).map((t) => ({ ref: taskRef(t.ref), title: t.title, goal: goals.find((g) => g.id === t.goal_id) ? goalRef(goals.find((g) => g.id === t.goal_id)!.ref) : null })),
    capacity_by_goal: b.byGoal, capacity_by_person: b.byPerson.map((p) => ({ ...p, key: undefined, person: p.label, label: undefined })),
    low_impact_or_unjustified: b.lowImpact.slice(0, 15), neglected_goals: b.neglectedGoals, blockers: b.blockers.slice(0, 15),
    rule_based_actions: b.actions.slice(0, 12),
    team: [...new Set(b.activeTasks.map((t) => memberName(t.owner_id)))],
  };
}
