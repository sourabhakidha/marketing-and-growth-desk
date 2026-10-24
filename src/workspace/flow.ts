// Flow view model: how task types, workflows, stages and goals connect, and
// where time goes between them. Pure functions over recorded timestamps only;
// anything not recorded stays out of the sample (shown as "no data", never 0).
import type { Goal, Opportunity, OpportunitySignalLink, Task, TaskEvent, TaskStage, WorkflowTemplate } from "../lib/api.ts";
import { median, minutesBetween } from "../lib/format.ts";

export const stageWait = (s: TaskStage) => minutesBetween(s.ready_at, s.picked_up_at);
export const stageWork = (s: TaskStage) => (s.state === "done" ? minutesBetween(s.picked_up_at, s.completed_at) : null);
export const stageTotal = (s: TaskStage) => (s.state === "done" ? minutesBetween(s.entered_at, s.completed_at) : null);

const push = (list: number[], v: number | null) => { if (v != null) list.push(v); };
const minIso = (values: (string | null | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;

export function stagesByTask(stages: TaskStage[]): Map<string, TaskStage[]> {
  const by = new Map<string, TaskStage[]>();
  for (const s of stages) by.set(s.task_id, [...(by.get(s.task_id) ?? []), s]);
  for (const list of by.values()) list.sort((a, b) => a.position - b.position);
  return by;
}

export function eventsByTask(events: TaskEvent[]): Map<string, TaskEvent[]> {
  const by = new Map<string, TaskEvent[]>();
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id - b.id)) {
    by.set(e.task_id, [...(by.get(e.task_id) ?? []), e]);
  }
  return by;
}

/** Each admin decision paired with the submission before it: how long work waited for approval. */
export function decisionWaits(events: TaskEvent[]): number[] {
  const out: number[] = [];
  let submitted: string | null = null;
  for (const e of events) {
    if (e.event_type === "submitted_for_approval") submitted = e.occurred_at;
    else if ((e.event_type === "approved" || e.event_type === "changes_requested") && submitted) {
      push(out, minutesBetween(submitted, e.occurred_at));
      submitted = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- by task type
export interface StageCell { inWorkflow: boolean; used: number; waits: number[]; works: number[]; totals: number[] }
export interface TypeFlow {
  type: string;
  template: WorkflowTemplate | null;
  tasks: number; open: number; done: number;
  cycles: number[];        // created → approved (Done)
  startWaits: number[];    // created → first stage picked up
  handoffWaits: number[];  // hand-off → picked up, later stages
  approvalWaits: number[]; // submitted → admin decision
  reworked: number;        // tasks returned for rework at least once
  cells: Map<string, StageCell>;
}

export function flowByType(tasks: Task[], stages: Map<string, TaskStage[]>, events: Map<string, TaskEvent[]>, templates: WorkflowTemplate[], typeCodes: string[]): TypeFlow[] {
  const codes = [...typeCodes, ...new Set(tasks.map((t) => t.task_type).filter((c) => !typeCodes.includes(c)))];
  return codes.map((type) => {
    const template = templates.find((w) => w.default_for_task_type === type) ?? null;
    const cells = new Map<string, StageCell>();
    const cell = (code: string) => {
      const c = cells.get(code) ?? { inWorkflow: false, used: 0, waits: [], works: [], totals: [] };
      cells.set(code, c);
      return c;
    };
    for (const s of template?.workflow_template_stages ?? []) cell(s.stage_code).inWorkflow = true;
    const row: TypeFlow = { type, template, tasks: 0, open: 0, done: 0, cycles: [], startWaits: [], handoffWaits: [], approvalWaits: [], reworked: 0, cells };
    for (const t of tasks.filter((x) => x.task_type === type)) {
      row.tasks += 1;
      if (t.status === "done") row.done += 1; else if (t.status !== "cancelled") row.open += 1;
      if (t.status === "done") push(row.cycles, minutesBetween(t.created_at, t.completed_at));
      const list = stages.get(t.id) ?? [];
      if (list.some((s) => s.revision_count > 0)) row.reworked += 1;
      list.forEach((s, i) => {
        const c = cell(s.stage_code);
        c.inWorkflow = true;
        if (s.state === "pending" || s.state === "skipped") return;
        c.used += 1;
        push(c.waits, stageWait(s));
        push(c.works, stageWork(s));
        push(c.totals, stageTotal(s));
        push(i === 0 ? row.startWaits : row.handoffWaits, stageWait(s));
      });
      row.approvalWaits.push(...decisionWaits(events.get(t.id) ?? []));
    }
    return row;
  }).filter((r) => r.tasks > 0 || r.template);
}

/** The stage where this type spends the most time (median stage time), if any is recorded. */
export function slowestStage(row: TypeFlow): { stage: string; minutes: number } | null {
  let best: { stage: string; minutes: number } | null = null;
  for (const [stage, c] of row.cells) {
    const m = median(c.totals);
    if (m != null && (!best || m > best.minutes)) best = { stage, minutes: m };
  }
  return best;
}

// ---------------------------------------------------------------- idea → execution
export interface FlowStep { key: string; label: string; count: number; hint: string }
export interface FlowLag { label: string; values: number[] | null }
export interface IdeaFlow { steps: FlowStep[]; lags: FlowLag[]; leadTimes: number[] }

/** Calendar-day gap between approval and the publish date (India dates); negative gaps are not counted. */
function publishGap(t: Task): number | null {
  if (!t.completed_at || !t.publish_date) return null;
  const approved = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(t.completed_at));
  const days = (Date.parse(`${t.publish_date}T00:00:00Z`) - Date.parse(`${approved}T00:00:00Z`)) / 86400000;
  return Number.isFinite(days) && days >= 0 ? days * 1440 : null;
}

export function ideaToExecution(input: {
  opportunities: Opportunity[]; links: OpportunitySignalLink[]; tasks: Task[];
  stages: Map<string, TaskStage[]>; events: Map<string, TaskEvent[]>;
}): IdeaFlow {
  const { opportunities, links, tasks, stages, events } = input;
  const signalsFor = new Map<string, string[]>();
  for (const l of links) signalsFor.set(l.opportunity_id, [...(signalsFor.get(l.opportunity_id) ?? []), l.radar_signals?.collected_at ?? ""]);
  const tasksFor = new Map<string, Task[]>();
  for (const t of tasks) if (t.opportunity_id) tasksFor.set(t.opportunity_id, [...(tasksFor.get(t.opportunity_id) ?? []), t]);

  const signalToOpp: number[] = [], raisedToDecided: number[] = [], approvedToTask: number[] = [];
  const createdToStart: number[] = [], startToSubmit: number[] = [], submitToDecision: number[] = [], approvedToPublish: number[] = [];
  const leadTimes: number[] = [];
  const oppStart = new Map<string, string>();

  for (const o of opportunities) {
    const firstSignal = minIso(signalsFor.get(o.id) ?? []);
    push(signalToOpp, minutesBetween(firstSignal, o.created_at));
    push(raisedToDecided, minutesBetween(o.created_at, o.decided_at));
    if (o.status === "approved" || o.status === "converted") push(approvedToTask, minutesBetween(o.decided_at, minIso((tasksFor.get(o.id) ?? []).map((t) => t.created_at))));
    oppStart.set(o.id, minIso([firstSignal, o.created_at])!);
  }

  let started = 0, submitted = 0;
  for (const t of tasks) {
    const firstPickUp = minIso((stages.get(t.id) ?? []).map((s) => s.picked_up_at));
    const ev = events.get(t.id) ?? [];
    const firstSubmit = ev.find((e) => e.event_type === "submitted_for_approval")?.occurred_at ?? null;
    if (firstPickUp) started += 1;
    if (firstSubmit) submitted += 1;
    push(createdToStart, minutesBetween(t.created_at, firstPickUp));
    push(startToSubmit, minutesBetween(firstPickUp, firstSubmit));
    submitToDecision.push(...decisionWaits(ev));
    push(approvedToPublish, publishGap(t));
    if (t.status === "done" && t.opportunity_id) push(leadTimes, minutesBetween(oppStart.get(t.opportunity_id), t.completed_at));
  }

  const done = tasks.filter((t) => t.status === "done");
  return {
    steps: [
      { key: "signals", label: "Signals used", count: new Set(links.map((l) => l.signal_id)).size, hint: "Radar signals linked to an opportunity" },
      { key: "opps", label: "Opportunities", count: opportunities.length, hint: "Ideas proposed" },
      { key: "decided", label: "Decided", count: opportunities.filter((o) => o.decided_at).length, hint: "Admin decision recorded" },
      { key: "approved", label: "Approved ideas", count: opportunities.filter((o) => o.status === "approved" || o.status === "converted").length, hint: "Approved or already in production" },
      { key: "tasks", label: "Tasks", count: tasks.length, hint: `${tasks.filter((t) => t.opportunity_id).length} came from opportunities` },
      { key: "started", label: "Work started", count: started, hint: "A stage was picked up" },
      { key: "submitted", label: "Submitted", count: submitted, hint: "Sent for admin approval" },
      { key: "done", label: "Done", count: done.length, hint: "Approved by an admin" },
      { key: "published", label: "Publish date set", count: done.filter((t) => t.publish_date).length, hint: "Done work with a publish date" },
    ],
    // one entry per gap between consecutive steps; null = same moment, nothing to measure
    lags: [
      { label: "signal → idea", values: signalToOpp },
      { label: "idea → decision", values: raisedToDecided },
      { label: "same decision", values: null },
      { label: "approval → task", values: approvedToTask },
      { label: "created → picked up", values: createdToStart },
      { label: "picked up → submitted", values: startToSubmit },
      { label: "submitted → decision", values: submitToDecision },
      { label: "approval → publish date", values: approvedToPublish },
    ],
    leadTimes,
  };
}

// ---------------------------------------------------------------- goals
export interface GoalFlow {
  goal: Goal; tasks: Task[]; byType: Map<string, number>; open: number; done: number;
  cycles: number[]; openByStage: Map<string, number>; oldestOpenMinutes: number | null;
}

export function flowByGoal(goals: Goal[], tasks: Task[], stages: Map<string, TaskStage[]>, now: string): GoalFlow[] {
  return goals.map((goal) => {
    const linked = tasks.filter((t) => t.goal_id === goal.id);
    const byType = new Map<string, number>();
    const openByStage = new Map<string, number>();
    const cycles: number[] = [];
    let oldest: number | null = null;
    for (const t of linked) {
      byType.set(t.task_type, (byType.get(t.task_type) ?? 0) + 1);
      if (t.status === "done") push(cycles, minutesBetween(t.created_at, t.completed_at));
      if (t.status !== "done" && t.status !== "cancelled") {
        const active = (stages.get(t.id) ?? []).find((s) => s.state === "active");
        if (active) openByStage.set(active.stage_code, (openByStage.get(active.stage_code) ?? 0) + 1);
        const age = minutesBetween(t.created_at, now);
        if (age != null && (oldest == null || age > oldest)) oldest = age;
      }
    }
    return {
      goal, tasks: linked, byType, openByStage, cycles, oldestOpenMinutes: oldest,
      open: linked.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
      done: linked.filter((t) => t.status === "done").length,
    };
  });
}
