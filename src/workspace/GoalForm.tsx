import { useState, type FormEvent } from "react";
import { type Goal, type GoalInput, useLookups } from "../lib/api.ts";
import { ErrorText, Field, orNull } from "../components/Form.tsx";

export interface GoalFormValues {
  title: string; owner_id: string; description: string; success_definition: string; start_date: string; end_date: string;
  progress_method: Goal["progress_method"]; target_quantity: string; target_unit: string; manual_progress: string;
  status: string; completion_note: string;
}

export const emptyGoal = (ownerId: string): GoalFormValues => ({
  title: "", owner_id: ownerId, description: "", success_definition: "", start_date: "", end_date: "",
  progress_method: "task_checklist", target_quantity: "", target_unit: "", manual_progress: "", status: "not_started",
  completion_note: "",
});

export function goalToValues(g: Goal): GoalFormValues {
  return {
    title: g.title, owner_id: g.owner_id, description: g.description ?? "", success_definition: g.success_definition ?? "",
    start_date: g.start_date ?? "", end_date: g.end_date ?? "", progress_method: g.progress_method,
    target_quantity: g.target_quantity != null ? String(g.target_quantity) : "", target_unit: g.target_unit ?? "",
    manual_progress: g.manual_progress != null ? String(g.manual_progress) : "", status: g.status,
    completion_note: g.completion_note ?? "",
  };
}

export function validateGoal(v: GoalFormValues): string | null {
  if (!v.title.trim()) return "Give the goal a title.";
  if (!v.owner_id) return "Choose an owner.";
  if (v.start_date && v.end_date && v.end_date < v.start_date) return "End date must be on or after the start date.";
  if (v.progress_method === "accepted_deliverables" && !(parseFloat(v.target_quantity) > 0))
    return "Accepted-deliverable goals need a target quantity (e.g. 5 scripts).";
  if (v.target_quantity && !(parseFloat(v.target_quantity) > 0)) return "Target quantity must be positive.";
  if (v.manual_progress && !(parseFloat(v.manual_progress) >= 0 && parseFloat(v.manual_progress) <= 100))
    return "Manual progress must be between 0 and 100.";
  return null;
}

export function valuesToGoal(v: GoalFormValues): GoalInput {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    title: v.title.trim(), owner_id: v.owner_id, description: orNull(v.description), success_definition: orNull(v.success_definition),
    start_date: orNull(v.start_date), end_date: orNull(v.end_date), progress_method: v.progress_method,
    target_quantity: num(v.target_quantity), target_unit: orNull(v.target_unit),
    manual_progress: v.progress_method === "manual" ? num(v.manual_progress) : null,
    status: v.status, completion_note: orNull(v.completion_note),
  };
}

const METHOD_HELP: Record<Goal["progress_method"], string> = {
  task_checklist: "Progress = approved linked tasks ÷ all linked tasks.",
  accepted_deliverables: "Progress = approved tasks marked as deliverables ÷ target. Subtasks don't count unless marked.",
  manual: "An admin records progress after judging the outcome.",
};

export function GoalForm({ initial, mode, onSubmit, onCancel, busy, error }: {
  initial: GoalFormValues; mode: "create" | "edit"; onSubmit: (v: GoalFormValues) => void; onCancel: () => void;
  busy: boolean; error: unknown;
}) {
  const [v, setV] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const { members, options } = useLookups();
  const set = <K extends keyof GoalFormValues>(k: K, value: GoalFormValues[K]) => setV((p) => ({ ...p, [k]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = validateGoal(v);
    setProblem(p);
    if (!p) onSubmit(v);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <Field label="Goal" required wide>
        <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Complete five approved scripts this week" autoFocus />
      </Field>
      <Field label="Owner" required>
        <select value={v.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
          {(members.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select value={v.status} onChange={(e) => set("status", e.target.value)}>
          {options("goal_status").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Start date"><input type="date" value={v.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
      <Field label="End date"><input type="date" value={v.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
      <Field label="How progress is measured" required wide hint={METHOD_HELP[v.progress_method]}>
        <select value={v.progress_method} onChange={(e) => set("progress_method", e.target.value as Goal["progress_method"])}>
          <option value="task_checklist">Linked-task checklist</option>
          <option value="accepted_deliverables">Accepted deliverable count</option>
          <option value="manual">Manually verified</option>
        </select>
      </Field>
      {v.progress_method === "accepted_deliverables" && (
        <>
          <Field label="Target quantity" required><input inputMode="decimal" value={v.target_quantity} onChange={(e) => set("target_quantity", e.target.value)} placeholder="5" /></Field>
          <Field label="Unit"><input value={v.target_unit} onChange={(e) => set("target_unit", e.target.value)} placeholder="scripts" /></Field>
        </>
      )}
      {v.progress_method === "manual" && mode === "edit" && (
        <Field label="Progress (%)"><input inputMode="decimal" value={v.manual_progress} onChange={(e) => set("manual_progress", e.target.value)} /></Field>
      )}
      <Field label="Definition of success" wide hint="What counts as achieving it — not just activity">
        <textarea rows={2} value={v.success_definition} onChange={(e) => set("success_definition", e.target.value)} />
      </Field>
      <Field label="Description" wide>
        <textarea rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      {mode === "edit" && (
        <Field label="Outcome / completion note" wide hint="Evidence or links confirming the outcome">
          <textarea rows={2} value={v.completion_note} onChange={(e) => set("completion_note", e.target.value)} />
        </Field>
      )}
      <div className="field--wide">
        {problem && <p className="form__error" role="alert">{problem}</p>}
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Create goal" : "Save goal"}
          </button>
        </div>
      </div>
    </form>
  );
}
