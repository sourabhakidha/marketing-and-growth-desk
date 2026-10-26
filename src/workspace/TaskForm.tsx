// Creation and edit forms (D-041, D-045): a Task form and a Deliverable form. A task is one
// piece of work by one person — one step (Writing, Design, Review…). A deliverable is either
// standalone (one person does it start to finish) or a workflow: one task per step, each with
// its own owner and due date, created together with the deliverable.
import { useEffect, useState, type FormEvent } from "react";
import { type Goal, type NewTask, type Task, type TaskImpact, useGoals, useLookups, useTasks, useTemplates } from "../lib/api.ts";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { EVIDENCE_HELP, EVIDENCE_LABEL, IMPORTANCE_LABEL } from "../lib/impact.ts";
import { useMember } from "../lib/session.tsx";

export interface TaskFormValues {
  title: string; task_type: string; work_origin: string; owner_id: string; priority: string; due_date: string;
  goal_id: string; counts_toward_goal: boolean; brief: string; deliverable_format: string; channel: string;
  requester: string; estimate_hours: string; completion_criteria: string; reviewer_id: string;
  workflow_template_id: string; deliverable_url: string; publish_date: string;
  impact_outcome: string; impact_rationale: string; impact_audience: string; impact_metrics: string; impact_evidence: string;
  impact_dependencies: string; impact_risks: string;
  /** "task" or "deliverable" (fixed after creation); parent_id = the deliverable a task belongs to */
  kind: "task" | "deliverable"; parent_id: string;
  /** creation only: a task runs one step (D-045); older tasks may still have several */
  run?: "workflow" | "standalone"; steps?: string[]; standalone_step?: string;
  /** creation only, deliverables (D-045): standalone, or a workflow of tasks planned step by step */
  production?: "standalone" | "workflow"; plan?: PlanStep[]; plan_template_id?: string;
}

/** One step of a workflow deliverable's plan: becomes one task with its own owner and due date. */
export interface PlanStep { code: string; on: boolean; owner_id: string; due_date: string }

export const EMPTY_STRUCTURE_VALUES = { kind: "task" as const, parent_id: "" };

/** Blank expected-impact fields for new forms. */
export const EMPTY_IMPACT_VALUES = {
  impact_outcome: "", impact_rationale: "", impact_audience: "", impact_metrics: "", impact_evidence: "",
  impact_dependencies: "", impact_risks: "",
};

/** The step a standalone task of this type usually is. */
export const DEFAULT_STEP_FOR_TYPE: Record<string, string> = {
  content_strategy: "ideation_research", content_development: "writing_scripting", ai_image_generation: "asset_creation",
  ai_video_generation: "asset_creation", graphic_designing: "asset_creation", production_shoot: "asset_creation",
  editing: "editing_assembly", publishing_scheduling: "scheduling_handoff", reporting_analysis: "ideation_research", ad_hoc: "asset_creation",
};

/** The type of work a workflow step's task gets (the reverse of the defaults above). */
export const TYPE_FOR_STEP: Record<string, string> = {
  brief_intake: "content_strategy", ideation_research: "content_strategy", production_planning: "content_strategy",
  writing_scripting: "content_development", asset_creation: "graphic_designing", editing_assembly: "editing",
  scheduling_handoff: "publishing_scheduling",
};

/** The tasks a workflow deliverable starts with: one per ticked step, in order. */
export function planToTasks(d: TaskFormValues, stepLabel: (code: string) => string): NewTask[] {
  if (d.production !== "workflow") return [];
  return (d.plan ?? []).filter((p) => p.on).map((p) => ({
    ...valuesToTask({
      ...d, kind: "task", parent_id: "", title: `${stepLabel(p.code)} — ${d.title.trim()}`,
      task_type: TYPE_FOR_STEP[p.code] ?? d.task_type, owner_id: p.owner_id, due_date: p.due_date, publish_date: "",
      goal_id: "", counts_toward_goal: false, brief: "", deliverable_format: "", estimate_hours: "", completion_criteria: "",
      reviewer_id: "", workflow_template_id: "", deliverable_url: "", run: "standalone", standalone_step: p.code,
      production: undefined, plan: undefined,
    }),
    // a task in a deliverable takes its business impact from the deliverable
    impact_outcome: null, impact_rationale: null, impact_audience: null, impact_metrics: null, impact_evidence: null,
    impact_dependencies: null, impact_risks: null,
  }));
}

export const DELIVERABLE_TYPES = ["Video", "Static image", "Carousel", "Script", "Copy", "Banner", "Leaflet", "Report", "Other"];

export function taskToValues(t: Task): TaskFormValues {
  return {
    title: t.title, task_type: t.task_type, work_origin: t.work_origin, owner_id: t.owner_id, priority: t.priority ?? "",
    due_date: t.due_date ?? "", goal_id: t.goal_id ?? "", counts_toward_goal: t.counts_toward_goal, brief: t.brief ?? "",
    deliverable_format: t.deliverable_format ?? "", channel: t.channel ?? "", requester: t.requester ?? "",
    estimate_hours: t.estimated_minutes ? String(+(t.estimated_minutes / 60).toFixed(2)) : "",
    completion_criteria: t.completion_criteria ?? "", reviewer_id: t.reviewer_id ?? "",
    workflow_template_id: t.workflow_template_id ?? "", deliverable_url: t.deliverable_url ?? "", publish_date: t.publish_date ?? "",
    kind: t.kind ?? "task", parent_id: t.parent_id ?? "",
    impact_outcome: t.impact_outcome ?? "", impact_rationale: t.impact_rationale ?? "", impact_audience: t.impact_audience ?? "",
    impact_metrics: t.impact_metrics ?? "", impact_evidence: t.impact_evidence ?? "", impact_dependencies: t.impact_dependencies ?? "",
    impact_risks: t.impact_risks ?? "",
  };
}

export function valuesToTask(v: TaskFormValues): NewTask {
  const hours = parseFloat(v.estimate_hours);
  const inheritsImpact = v.run !== undefined && v.kind === "task" && Boolean(v.parent_id); // creation only
  const steps = v.run === "standalone" ? (v.standalone_step ? [v.standalone_step] : null)
    : v.run === "workflow" && v.steps?.length ? v.steps : null;
  return {
    title: v.title.trim(), task_type: v.task_type, work_origin: v.work_origin, owner_id: v.owner_id,
    priority: orNull(v.priority), due_date: orNull(v.due_date), goal_id: orNull(v.goal_id),
    counts_toward_goal: Boolean(v.goal_id) && v.counts_toward_goal, brief: orNull(v.brief),
    deliverable_format: orNull(v.deliverable_format), channel: orNull(v.channel), requester: orNull(v.requester),
    estimated_minutes: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null,
    completion_criteria: orNull(v.completion_criteria), reviewer_id: orNull(v.reviewer_id),
    workflow_template_id: v.run === "standalone" ? null : orNull(v.workflow_template_id), deliverable_url: orNull(v.deliverable_url),
    publish_date: orNull(v.publish_date),
    ...(inheritsImpact ? {} : {
      impact_outcome: orNull(v.impact_outcome), impact_rationale: orNull(v.impact_rationale), impact_audience: orNull(v.impact_audience),
      impact_metrics: orNull(v.impact_metrics), impact_evidence: (orNull(v.impact_evidence) as TaskImpact["impact_evidence"]),
      impact_dependencies: orNull(v.impact_dependencies), impact_risks: orNull(v.impact_risks),
    }),
    kind: v.kind, parent_id: v.kind === "deliverable" ? null : orNull(v.parent_id),
    ...(steps ? { initial_stages: steps } : {}),
  };
}

export function validateTask(v: TaskFormValues, opts: { requireImpact?: boolean; hadImpact?: Partial<TaskFormValues> } = {}): string | null {
  const what = v.kind === "deliverable" ? "deliverable" : "task";
  if (!v.title.trim()) return `Give the ${what} a title.`;
  if (!v.task_type) return "Choose the type of work.";
  if (!v.work_origin) return "Choose where the work comes from.";
  if (!v.owner_id) return "Choose an owner.";
  if (v.run === "workflow" && v.steps && v.steps.length === 0) return "Keep at least one step in the workflow.";
  if (v.run === "standalone" && !v.standalone_step) return "Choose the step this task is (e.g. Writing, Design).";
  if (v.production === "workflow") {
    const on = (v.plan ?? []).filter((p) => p.on);
    if (!on.length) return "Tick at least one step in the workflow, or make it a standalone deliverable.";
    if (on.some((p) => !p.owner_id)) return "Choose who does each ticked step.";
  }
  const hours = v.estimate_hours.trim();
  if (hours && !(parseFloat(hours) > 0)) return "Estimated effort must be a positive number of hours.";
  if (v.deliverable_url.trim() && !/^https?:\/\//i.test(v.deliverable_url.trim())) return "Links must start with http:// or https://";
  const required = [
    ["impact_outcome", "the intended business outcome"], ["impact_rationale", "the rationale"], ["impact_audience", "the target audience / channel"],
    ["impact_metrics", "the success metrics"], ["impact_evidence", "the evidence level"],
  ] as const;
  for (const [k, name] of required) {
    if (!v[k].trim() && (opts.requireImpact || opts.hadImpact?.[k]?.trim()))
      return opts.requireImpact ? `Business impact: add ${name}.` : `Business impact can be revised but not removed — keep ${name}.`;
  }
  return null;
}

type FormProps = {
  initial: TaskFormValues;
  mode: "create" | "edit";
  /** owner, due date, priority — editable at creation, admin-only afterwards */
  restrictedEditable: boolean;
  onSubmit: (v: TaskFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
  /** opened from a deliverable's "+ Add task": the deliverable is fixed */
  fixedParent?: boolean;
};

/** Edits a task, or a deliverable (same record kind on the server). */
export function TaskForm(props: FormProps) {
  return props.initial.kind === "deliverable" ? <DeliverableForm {...props} /> : <WorkTaskForm {...props} />;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="form-section field--wide">
      <legend>{title}</legend>
      {hint && <p className="small muted form-section__hint">{hint}</p>}
      <div className="grid-form">{children}</div>
    </fieldset>
  );
}

function useCommon(initial: TaskFormValues, mode: "create" | "edit") {
  const [v, setV] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const { member: me } = useMember();
  const set = <K extends keyof TaskFormValues>(k: K, value: TaskFormValues[K]) => setV((p) => ({ ...p, [k]: value }));
  // D-030 / D-038: an admin creating or (re)assigning top-level work must give its business impact; a task in a
  // deliverable inherits it. Decided from the deliverable chosen NOW (the impact fields hide as soon as one is picked).
  const requireImpact = me.role === "admin" && !v.parent_id
    && (mode === "create" || v.owner_id !== initial.owner_id || Boolean(initial.parent_id));
  return { v, setV, set, problem, setProblem, me, requireImpact };
}

function PeopleAndDates({ v, set, restrictedEditable, showPublish }: {
  v: TaskFormValues; set: <K extends keyof TaskFormValues>(k: K, value: TaskFormValues[K]) => void; restrictedEditable: boolean; showPublish: boolean;
}) {
  const { members, options } = useLookups();
  const active = (members.data ?? []).filter((m) => m.is_active);
  const lock = !restrictedEditable ? "Only admins can change" : undefined;
  return (
    <>
      <Field label="Owner" required hint={lock}>
        <select value={v.owner_id} disabled={!restrictedEditable} onChange={(e) => set("owner_id", e.target.value)}>
          <option value="">Choose…</option>
          {active.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </Field>
      <Field label="Due date" hint={lock}>
        <input type="date" value={v.due_date} disabled={!restrictedEditable} onChange={(e) => set("due_date", e.target.value)} />
      </Field>
      {showPublish && (
        <Field label="Publish date" hint={lock ?? "Optional — shows on the Calendar"}>
          <input type="date" value={v.publish_date} disabled={!restrictedEditable} onChange={(e) => set("publish_date", e.target.value)} />
        </Field>
      )}
      <Field label="Priority" hint={lock}>
        <select value={v.priority} disabled={!restrictedEditable} onChange={(e) => set("priority", e.target.value)}>
          <option value="">Not set</option>
          {options("priority").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
    </>
  );
}

function ImpactFields({ v, set, required, goal }: {
  v: TaskFormValues; set: <K extends keyof TaskFormValues>(k: K, value: TaskFormValues[K]) => void; required: boolean; goal?: Goal;
}) {
  return (
    <Section title={`Business impact${required ? " · required" : ""}`}
      hint="Why this matters to the business — an expectation to judge later, not a result.">
      {goal && <p className="small impact-fieldset__goal field--wide">Supports the goal <strong>{goal.title}</strong>{goal.importance && <> · {IMPORTANCE_LABEL[goal.importance]} importance</>}</p>}
      <Field label="Intended business outcome" required={required} wide>
        <textarea rows={2} value={v.impact_outcome} onChange={(e) => set("impact_outcome", e.target.value)} placeholder="e.g. More Marathi-speaking caregivers install the app" />
      </Field>
      <Field label="Rationale" required={required} wide>
        <textarea rows={2} value={v.impact_rationale} onChange={(e) => set("impact_rationale", e.target.value)} />
      </Field>
      <Field label="Audience / channel" required={required}>
        <input value={v.impact_audience} onChange={(e) => set("impact_audience", e.target.value)} placeholder="e.g. Maharashtra, Meta" />
      </Field>
      <Field label="Evidence level" required={required} hint={v.impact_evidence ? EVIDENCE_HELP[v.impact_evidence] : undefined}>
        <select value={v.impact_evidence} onChange={(e) => set("impact_evidence", e.target.value)}>
          <option value="">Choose…</option>
          {Object.entries(EVIDENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Success metrics" required={required} wide>
        <textarea rows={2} value={v.impact_metrics} onChange={(e) => set("impact_metrics", e.target.value)} placeholder="e.g. Installs per 1,000 reach" />
      </Field>
      <Field label="Dependencies" hint="Optional"><input value={v.impact_dependencies} onChange={(e) => set("impact_dependencies", e.target.value)} /></Field>
      <Field label="Risks" hint="Optional"><input value={v.impact_risks} onChange={(e) => set("impact_risks", e.target.value)} /></Field>
    </Section>
  );
}

function Actions({ busy, mode, what, me, onCancel, problem, error }: {
  busy: boolean; mode: "create" | "edit"; what: string; me: { role: string }; onCancel: () => void; problem: string | null; error: unknown;
}) {
  return (
    <div className="field--wide">
      {problem && <p className="form__error" role="alert">{problem}</p>}
      <ErrorText error={error} />
      <div className="form__actions">
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? "Saving…" : mode === "edit" ? "Save changes" : me.role === "admin" ? `Create ${what}` : "Send request"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- task
function WorkTaskForm({ initial, mode, restrictedEditable, onSubmit, onCancel, busy, error, fixedParent = false }: FormProps) {
  const isCreate = mode === "create";
  const { v, setV, set, problem, setProblem, me, requireImpact } = useCommon(
    isCreate ? { ...initial, run: "standalone", standalone_step: initial.standalone_step || DEFAULT_STEP_FOR_TYPE[initial.task_type] || "" } : initial, mode);
  const { options } = useLookups();
  const tasks = useTasks();
  const goals = useGoals();
  const deliverables = (tasks.data ?? []).filter((t) => t.kind === "deliverable" && (!["done", "cancelled", "requested"].includes(t.status) || t.id === v.parent_id));
  const parent = deliverables.find((d) => d.id === v.parent_id);
  const goalOf = (gid: string | null | undefined) => (goals.data ?? []).find((g) => g.id === gid);
  const stepOptions = options("workflow_stage").filter((o) => o.code !== "completed");

  // deliverables grouped under their goal in the picker
  const byGoal = new Map<string, typeof deliverables>();
  for (const d of deliverables) { const k = goalOf(d.goal_id)?.title ?? "No goal"; byGoal.set(k, [...(byGoal.get(k) ?? []), d]); }

  function changeType(code: string) {
    setV((p) => ({ ...p, task_type: code, standalone_step: DEFAULT_STEP_FOR_TYPE[code] ?? p.standalone_step }));
  }
  function changeParent(id: string) {
    const d = deliverables.find((x) => x.id === id);
    setV((p) => ({ ...p, parent_id: id, channel: p.channel || d?.channel || "", goal_id: id ? "" : p.goal_id }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const p = validateTask(v, { requireImpact, hadImpact: initial });
    setProblem(p);
    if (!p) onSubmit(v);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <Section title="The task">
        <Field label="Task title" required wide>
          <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Write script 1 — caregiver refill reminder" autoFocus />
        </Field>
        <Field label="Deliverable" hint={fixedParent ? undefined : mode === "edit" && !restrictedEditable ? "Only admins can move it" : "What this task produces part of"}>
          <select value={v.parent_id} disabled={fixedParent || (mode === "edit" && !restrictedEditable)} onChange={(e) => changeParent(e.target.value)}>
            <option value="">Not in a deliverable</option>
            {[...byGoal.entries()].map(([g, ds]) => (
              <optgroup key={g} label={g}>{ds.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</optgroup>
            ))}
          </select>
        </Field>
        <Field label="Type of work" required>
          <select value={v.task_type} onChange={(e) => changeType(e.target.value)}>
            <option value="">Choose…</option>
            {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </Field>
        {isCreate ? (
          <Field label="Step" required hint="Which part of the deliverable’s journey this is">
            <select value={v.standalone_step ?? ""} onChange={(e) => set("standalone_step", e.target.value)}>
              <option value="">Choose…</option>
              {stepOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </Field>
        ) : null}
      </Section>

      <Section title="Who and when">
        <PeopleAndDates v={v} set={set} restrictedEditable={restrictedEditable} showPublish={!v.parent_id} />
        <Field label="Reviewer"><ReviewerSelect v={v} set={set} /></Field>
        <Field label="Estimated effort (hours)" hint="Active work, not waiting">
          <input inputMode="decimal" value={v.estimate_hours} onChange={(e) => set("estimate_hours", e.target.value)} placeholder="e.g. 2" />
        </Field>
      </Section>

      <Section title="Details">
        <Field label="Brief" wide>
          <textarea rows={3} value={v.brief} onChange={(e) => set("brief", e.target.value)} placeholder="Purpose, key message, constraints, references" />
        </Field>
        <Field label="Done when" wide hint="What must be true for it to be signed off">
          <textarea rows={2} value={v.completion_criteria} onChange={(e) => set("completion_criteria", e.target.value)} />
        </Field>
        <Field label="Channel" hint={parent ? "Defaults to the deliverable’s channel" : undefined}>
          <select value={v.channel} onChange={(e) => set("channel", e.target.value)}>
            <option value="">Not set</option>
            {options("channel").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Comes from" required>
          <select value={v.work_origin} onChange={(e) => set("work_origin", e.target.value)}>
            <option value="">Choose…</option>
            {options("work_origin").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </Field>
        {!v.parent_id && (
          <Field label="Goal" hint="Only for tasks outside a deliverable">
            <select value={v.goal_id} onChange={(e) => set("goal_id", e.target.value)}>
              <option value="">No goal</option>
              {(goals.data ?? []).filter((g) => !["achieved", "not_achieved", "cancelled"].includes(g.status) || g.id === v.goal_id)
                .map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </Field>
        )}
        {(v.work_origin === "ad_hoc" || v.requester) && (
          <Field label="Requested by"><input value={v.requester} onChange={(e) => set("requester", e.target.value)} /></Field>
        )}
        {mode === "edit" && (
          <Field label="Link to the output" wide><input value={v.deliverable_url} onChange={(e) => set("deliverable_url", e.target.value)} placeholder="https://drive.google.com/…" /></Field>
        )}
      </Section>

      {parent ? (
        <p className="small muted field--wide">Business impact comes from the deliverable <strong>{parent.title}</strong>.</p>
      ) : <ImpactFields v={v} set={set} required={requireImpact} goal={goalOf(v.goal_id)} />}

      <Actions busy={busy} mode={mode} what="task" me={me} onCancel={onCancel} problem={problem} error={error} />
    </form>
  );
}

function ReviewerSelect({ v, set }: { v: TaskFormValues; set: <K extends keyof TaskFormValues>(k: K, value: TaskFormValues[K]) => void }) {
  const { members } = useLookups();
  return (
    <select value={v.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
      <option value="">Not set</option>
      {(members.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------- deliverable
export function DeliverableForm({ initial, mode, restrictedEditable, onSubmit, onCancel, busy, error }: FormProps) {
  const { v, setV, set, problem, setProblem, me, requireImpact } = useCommon(
    { ...initial, kind: "deliverable", parent_id: "", ...(mode === "create" && { production: initial.production ?? "workflow" }) }, mode);
  const { options } = useLookups();
  const goals = useGoals();
  const goal = (goals.data ?? []).find((g) => g.id === v.goal_id);

  // start the impact case from the goal's business outcome (editable)
  function pickGoal(id: string) {
    const g = (goals.data ?? []).find((x) => x.id === id);
    setV((p) => ({
      ...p, goal_id: id,
      impact_outcome: p.impact_outcome || g?.outcome_statement || "",
      impact_rationale: p.impact_rationale || g?.outcome_rationale || "",
      impact_metrics: p.impact_metrics || g?.success_measures || "",
      impact_evidence: p.impact_evidence || (g?.outcome_kind === "measurable" ? "committed" : ""),
    }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "create" && v.production === "workflow" && !v.plan?.length) { setProblem("The workflow steps are still loading — try again in a moment."); return; }
    const final = { ...v, impact_audience: v.impact_audience || (v.channel ? options("channel").find((o) => o.code === v.channel)?.label ?? "" : "") };
    const p = validateTask(final, { requireImpact, hadImpact: initial });
    setProblem(p);
    if (!p) onSubmit(final);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <Section title="The deliverable" hint="A concrete output for a goal — e.g. “5 Marathi video scripts”. Its tasks (ideation, writing, design, editing…) are added to it.">
        <Field label="Deliverable title" required wide>
          <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 5 Marathi images (static ads)" autoFocus />
        </Field>
        <Field label="Goal" hint="The business outcome this delivers toward">
          <select value={v.goal_id} onChange={(e) => pickGoal(e.target.value)}>
            <option value="">No goal</option>
            {(goals.data ?? []).filter((g) => !["achieved", "not_achieved", "cancelled"].includes(g.status) || g.id === v.goal_id)
              .map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <input list="deliverable-types" value={v.deliverable_format} onChange={(e) => set("deliverable_format", e.target.value)} placeholder="Video, Static image…" />
          <datalist id="deliverable-types">{DELIVERABLE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Description" wide>
          <textarea rows={2} value={v.brief} onChange={(e) => set("brief", e.target.value)} placeholder="e.g. Create five engaging Marathi scripts for Meta ads" />
        </Field>
        <Field label="Channel">
          <select value={v.channel} onChange={(e) => set("channel", e.target.value)}>
            <option value="">Not set</option>
            {options("channel").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </Field>
      </Section>
      <Section title="Who and when">
        <PeopleAndDates v={v} set={set} restrictedEditable={restrictedEditable} showPublish />
        {mode === "edit" && (
          <Field label="Link to the output" wide hint="Where the finished deliverable can be checked">
            <input value={v.deliverable_url} onChange={(e) => set("deliverable_url", e.target.value)} placeholder="https://drive.google.com/…" />
          </Field>
        )}
      </Section>
      {mode === "create" && <Production v={v} setV={setV} />}
      <ImpactFields v={v} set={set} required={requireImpact} goal={goal} />
      <Actions busy={busy} mode={mode} what="deliverable" me={me} onCancel={onCancel} problem={problem} error={error} />
    </form>
  );
}

/** How a new deliverable is produced: by one person, or as a workflow of tasks (D-045). */
function Production({ v, setV }: { v: TaskFormValues; setV: React.Dispatch<React.SetStateAction<TaskFormValues>> }) {
  const templates = useTemplates();
  const { label, members } = useLookups();
  const active = (members.data ?? []).filter((m) => m.is_active);
  const list = (templates.data ?? []).filter((t) => t.is_active);
  const template = list.find((t) => t.id === v.plan_template_id) ?? list.find((t) => t.default_for_task_type === v.task_type) ?? list[0];
  const steps = (template?.workflow_template_stages ?? []).slice().sort((a, b) => a.position - b.position).filter((s) => s.stage_code !== "completed");
  // the plan follows the chosen workflow; owners default to the deliverable's owner
  const plan: PlanStep[] = steps.map((s) => v.plan?.find((p) => p.code === s.stage_code)
    ?? { code: s.stage_code, on: !s.is_optional, owner_id: v.owner_id, due_date: "" });
  const setPlan = (code: string, patch: Partial<PlanStep>) =>
    setV((p) => ({ ...p, plan_template_id: template?.id, plan: plan.map((x) => (x.code === code ? { ...x, ...patch } : x)) }));
  // keep the plan in the values the form submits
  const stale = v.production === "workflow" && template !== undefined && (v.plan_template_id !== template.id || (v.plan?.length ?? 0) !== plan.length);
  useEffect(() => {
    if (stale && template) setV((p) => ({ ...p, plan_template_id: template.id, plan }));
  }, [stale, template, plan, setV]);
  return (
    <fieldset className="form-section field--wide">
      <legend>How it will be produced</legend>
      <div className="run-choice" role="radiogroup" aria-label="How the deliverable is produced">
        <label className={`run-option${v.production === "standalone" ? " is-on" : ""}`}>
          <input type="radio" name="production" checked={v.production === "standalone"} onChange={() => setV((p) => ({ ...p, production: "standalone" }))} />
          <span><strong>Standalone</strong><span className="small muted">One person makes it start to finish, then sends it for approval.</span></span>
        </label>
        <label className={`run-option${v.production === "workflow" ? " is-on" : ""}`}>
          <input type="radio" name="production" checked={v.production === "workflow"} onChange={() => setV((p) => ({ ...p, production: "workflow" }))} />
          <span><strong>Workflow</strong><span className="small muted">A sequence of tasks — e.g. ideation, writing, design, review — done by different people.</span></span>
        </label>
      </div>
      {v.production === "workflow" && (
        <div className="plan">
          <Field label="Workflow">
            <select value={template?.id ?? ""} onChange={(e) => setV((p) => ({ ...p, plan_template_id: e.target.value, plan: undefined }))}>
              {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {templates.isPending ? <p className="small muted">Loading workflows…</p> : (
            <table className="plan__table">
              <thead><tr><th aria-label="Include" /><th>Step</th><th>Who does it</th><th>Due</th></tr></thead>
              <tbody>
                {plan.map((p, i) => (
                  <tr key={p.code} className={p.on ? undefined : "is-off"}>
                    <td><input type="checkbox" checked={p.on} aria-label={`Include ${label("workflow_stage", p.code)}`} onChange={(e) => setPlan(p.code, { on: e.target.checked })} /></td>
                    <td><span className="step-pick__n">{i + 1}</span> {label("workflow_stage", p.code)}</td>
                    <td>
                      <select value={p.owner_id} disabled={!p.on} onChange={(e) => setPlan(p.code, { owner_id: e.target.value })} aria-label={`Who does ${label("workflow_stage", p.code)}`}>
                        <option value="">Choose…</option>
                        {active.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                      </select>
                    </td>
                    <td><input type="date" value={p.due_date} disabled={!p.on} onChange={(e) => setPlan(p.code, { due_date: e.target.value })} aria-label={`Due date for ${label("workflow_stage", p.code)}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted">Each ticked step becomes a task in this deliverable, in this order. Untick steps whose work already exists. Tasks can be added or changed later.</p>
        </div>
      )}
    </fieldset>
  );
}
