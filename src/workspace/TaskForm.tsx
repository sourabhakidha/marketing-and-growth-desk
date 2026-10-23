import { useMemo, useState, type FormEvent } from "react";
import { type NewTask, type Task, useGoals, useLookups, useTemplates } from "../lib/api.ts";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { goalRef } from "../lib/format.ts";

export interface TaskFormValues {
  title: string; task_type: string; work_origin: string; owner_id: string; priority: string; due_date: string;
  goal_id: string; counts_toward_goal: boolean; brief: string; deliverable_format: string; channel: string;
  requester: string; estimate_hours: string; completion_criteria: string; reviewer_id: string;
  workflow_template_id: string; deliverable_url: string;
}

export function taskToValues(t: Task): TaskFormValues {
  return {
    title: t.title, task_type: t.task_type, work_origin: t.work_origin, owner_id: t.owner_id, priority: t.priority ?? "",
    due_date: t.due_date ?? "", goal_id: t.goal_id ?? "", counts_toward_goal: t.counts_toward_goal, brief: t.brief ?? "",
    deliverable_format: t.deliverable_format ?? "", channel: t.channel ?? "", requester: t.requester ?? "",
    estimate_hours: t.estimated_minutes ? String(+(t.estimated_minutes / 60).toFixed(2)) : "",
    completion_criteria: t.completion_criteria ?? "", reviewer_id: t.reviewer_id ?? "",
    workflow_template_id: t.workflow_template_id ?? "", deliverable_url: t.deliverable_url ?? "",
  };
}

export function valuesToTask(v: TaskFormValues): NewTask {
  const hours = parseFloat(v.estimate_hours);
  return {
    title: v.title.trim(), task_type: v.task_type, work_origin: v.work_origin, owner_id: v.owner_id,
    priority: orNull(v.priority), due_date: orNull(v.due_date), goal_id: orNull(v.goal_id),
    counts_toward_goal: Boolean(v.goal_id) && v.counts_toward_goal, brief: orNull(v.brief),
    deliverable_format: orNull(v.deliverable_format), channel: orNull(v.channel), requester: orNull(v.requester),
    estimated_minutes: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null,
    completion_criteria: orNull(v.completion_criteria), reviewer_id: orNull(v.reviewer_id),
    workflow_template_id: orNull(v.workflow_template_id), deliverable_url: orNull(v.deliverable_url),
  };
}

export function validateTask(v: TaskFormValues): string | null {
  if (!v.title.trim()) return "Give the task a title.";
  if (!v.task_type) return "Choose a task type.";
  if (!v.work_origin) return "Choose a work origin.";
  if (!v.owner_id) return "Choose an owner.";
  const hours = v.estimate_hours.trim();
  if (hours && !(parseFloat(hours) > 0)) return "Estimated effort must be a positive number of hours.";
  if (v.deliverable_url.trim() && !/^https?:\/\//i.test(v.deliverable_url.trim())) return "Links must start with http:// or https://";
  return null;
}

export function TaskForm({ initial, mode, restrictedEditable, onSubmit, onCancel, busy, error }: {
  initial: TaskFormValues;
  mode: "create" | "edit";
  /** owner, due date, priority (and template) — editable at creation, admin-only afterwards */
  restrictedEditable: boolean;
  onSubmit: (v: TaskFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const [v, setV] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const { members, options } = useLookups();
  const templates = useTemplates();
  const goals = useGoals();
  const set = <K extends keyof TaskFormValues>(k: K, value: TaskFormValues[K]) => setV((p) => ({ ...p, [k]: value }));

  const defaultTemplate = useMemo(
    () => templates.data?.find((t) => t.default_for_task_type === v.task_type),
    [templates.data, v.task_type],
  );
  const activeMembers = (members.data ?? []).filter((m) => m.is_active);
  const openGoals = (goals.data ?? []).filter((g) => !["achieved", "not_achieved", "cancelled"].includes(g.status) || g.id === v.goal_id);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = validateTask(v);
    setProblem(p);
    if (!p) onSubmit(v);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <Field label="Title" required wide>
        <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Write script: Papa ne nahi maana (Hinglish, 45 s)" autoFocus />
      </Field>
      <Field label="Task type" required>
        <select value={v.task_type} onChange={(e) => set("task_type", e.target.value)}>
          <option value="">Choose…</option>
          {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Work origin" required>
        <select value={v.work_origin} onChange={(e) => set("work_origin", e.target.value)}>
          <option value="">Choose…</option>
          {options("work_origin").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Owner" required hint={!restrictedEditable ? "Only admins can reassign" : undefined}>
        <select value={v.owner_id} disabled={!restrictedEditable} onChange={(e) => set("owner_id", e.target.value)}>
          <option value="">Choose…</option>
          {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </Field>
      <Field label="Due date" hint={!restrictedEditable ? "Only admins can change" : undefined}>
        <input type="date" value={v.due_date} disabled={!restrictedEditable} onChange={(e) => set("due_date", e.target.value)} />
      </Field>
      <Field label="Priority" hint={!restrictedEditable ? "Only admins can change" : undefined}>
        <select value={v.priority} disabled={!restrictedEditable} onChange={(e) => set("priority", e.target.value)}>
          <option value="">Not set</option>
          {options("priority").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Workflow" hint={mode === "edit" ? "Fixed after creation" : defaultTemplate ? `Default for this type: ${defaultTemplate.name}` : undefined}>
        <select value={v.workflow_template_id} disabled={mode === "edit"} onChange={(e) => set("workflow_template_id", e.target.value)}>
          <option value="">{defaultTemplate ? `Default — ${defaultTemplate.name}` : "No workflow"}</option>
          {(templates.data ?? []).filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Goal" hint="Optional — a task can stand alone">
        <select value={v.goal_id} onChange={(e) => set("goal_id", e.target.value)}>
          <option value="">No goal</option>
          {openGoals.map((g) => <option key={g.id} value={g.id}>{goalRef(g.ref)} · {g.title}</option>)}
        </select>
      </Field>
      {v.goal_id && (
        <label className="check field--wide">
          <input type="checkbox" checked={v.counts_toward_goal} onChange={(e) => set("counts_toward_goal", e.target.checked)} />
          This task's approved output counts as one deliverable toward the goal
        </label>
      )}
      <Field label="Reviewer">
        <select value={v.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
          <option value="">Not set</option>
          {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </Field>
      <Field label="Estimated effort (hours)" hint="Active work, not waiting time">
        <input inputMode="decimal" value={v.estimate_hours} onChange={(e) => set("estimate_hours", e.target.value)} placeholder="e.g. 1" />
      </Field>
      <Field label="Deliverable format">
        <input value={v.deliverable_format} onChange={(e) => set("deliverable_format", e.target.value)} placeholder="Video, static, carousel, banner…" />
      </Field>
      <Field label="Channel / placement">
        <input value={v.channel} onChange={(e) => set("channel", e.target.value)} placeholder="Meta ad, Instagram, app, WhatsApp, offline…" />
      </Field>
      {(v.work_origin === "ad_hoc" || v.requester) && (
        <Field label="Requested by">
          <input value={v.requester} onChange={(e) => set("requester", e.target.value)} placeholder="Who asked, and why it is urgent" />
        </Field>
      )}
      <Field label="Brief / context" wide>
        <textarea rows={4} value={v.brief} onChange={(e) => set("brief", e.target.value)} placeholder="Purpose, audience, key message, constraints, references" />
      </Field>
      <Field label="Completion criteria" wide hint="What must be true for an admin to approve it">
        <textarea rows={2} value={v.completion_criteria} onChange={(e) => set("completion_criteria", e.target.value)} />
      </Field>
      {mode === "edit" && (
        <Field label="Deliverable link" wide>
          <input value={v.deliverable_url} onChange={(e) => set("deliverable_url", e.target.value)} placeholder="https://drive.google.com/…" />
        </Field>
      )}
      <div className="field--wide">
        {problem && <p className="form__error" role="alert">{problem}</p>}
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
