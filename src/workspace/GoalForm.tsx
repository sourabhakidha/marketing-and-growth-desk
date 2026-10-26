import { useState, type FormEvent } from "react";
import { type Goal, type GoalInput, useLookups } from "../lib/api.ts";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { IMPORTANCE_LABEL, OUTCOME_STATUS_LABEL } from "../lib/impact.ts";

export interface GoalFormValues {
  title: string; owner_id: string; description: string; success_definition: string; start_date: string; end_date: string;
  progress_method: Goal["progress_method"]; target_quantity: string; target_unit: string; manual_progress: string;
  status: string; completion_note: string;
  outcome_statement: string; outcome_rationale: string; success_measures: string; importance: string;
  outcome_kind: string; outcome_metric: string; outcome_baseline: string; outcome_target: string; outcome_unit: string;
  outcome_status: Goal["outcome_status"]; outcome_actual: string; outcome_evidence: string;
  channel: string;
}

export const emptyGoal = (ownerId: string): GoalFormValues => ({
  title: "", owner_id: ownerId, description: "", success_definition: "", start_date: "", end_date: "",
  progress_method: "task_checklist", target_quantity: "", target_unit: "", manual_progress: "", status: "not_started",
  completion_note: "",
  outcome_statement: "", outcome_rationale: "", success_measures: "", importance: "", outcome_kind: "qualitative",
  outcome_metric: "", outcome_baseline: "", outcome_target: "", outcome_unit: "", outcome_status: "not_assessed",
  outcome_actual: "", outcome_evidence: "", channel: "",
});

export function goalToValues(g: Goal): GoalFormValues {
  return {
    title: g.title, owner_id: g.owner_id, description: g.description ?? "", success_definition: g.success_definition ?? "",
    start_date: g.start_date ?? "", end_date: g.end_date ?? "", progress_method: g.progress_method,
    target_quantity: g.target_quantity != null ? String(g.target_quantity) : "", target_unit: g.target_unit ?? "",
    manual_progress: g.manual_progress != null ? String(g.manual_progress) : "", status: g.status,
    completion_note: g.completion_note ?? "",
    outcome_statement: g.outcome_statement ?? "", outcome_rationale: g.outcome_rationale ?? "", success_measures: g.success_measures ?? "",
    importance: g.importance ?? "", outcome_kind: g.outcome_kind ?? "qualitative", outcome_metric: g.outcome_metric ?? "",
    outcome_baseline: g.outcome_baseline != null ? String(g.outcome_baseline) : "", outcome_target: g.outcome_target != null ? String(g.outcome_target) : "",
    outcome_unit: g.outcome_unit ?? "", outcome_status: g.outcome_status, outcome_actual: g.outcome_actual != null ? String(g.outcome_actual) : "",
    outcome_evidence: g.outcome_evidence ?? "", channel: g.channel ?? "",
  };
}

export function validateGoal(v: GoalFormValues): string | null {
  if (!v.title.trim()) return "Give the goal a title.";
  if (!v.owner_id) return "Choose an owner.";
  if (!v.outcome_statement.trim()) return "Describe the expected business outcome — what changes for the business, not how many tasks get done.";
  if (!v.outcome_rationale.trim()) return "Add the business rationale: why this outcome matters now.";
  if (!v.success_measures.trim()) return "Add the success measures: how achievement will be judged.";
  if (v.outcome_kind === "measurable") {
    if (!v.outcome_metric.trim()) return "A measurable outcome needs the metric (e.g. app installs per week).";
    if (v.outcome_target.trim() === "" || !Number.isFinite(Number(v.outcome_target))) return "A measurable outcome needs a numeric target. If no number is agreed, choose “Qualitative”.";
  }
  for (const [k, name] of [["outcome_baseline", "Baseline"], ["outcome_actual", "Actual result"]] as const) {
    if (v[k].trim() && !Number.isFinite(Number(v[k]))) return `${name} must be a number.`;
  }
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
    outcome_statement: orNull(v.outcome_statement), outcome_rationale: orNull(v.outcome_rationale), success_measures: orNull(v.success_measures),
    importance: orNull(v.importance) as Goal["importance"], outcome_kind: (orNull(v.outcome_kind) as Goal["outcome_kind"]),
    outcome_metric: v.outcome_kind === "measurable" ? orNull(v.outcome_metric) : null,
    outcome_baseline: v.outcome_kind === "measurable" ? num(v.outcome_baseline) : null,
    outcome_target: v.outcome_kind === "measurable" ? num(v.outcome_target) : null,
    outcome_unit: v.outcome_kind === "measurable" ? orNull(v.outcome_unit) : null,
    outcome_status: v.outcome_status, outcome_actual: v.outcome_kind === "measurable" ? num(v.outcome_actual) : null,
    outcome_evidence: orNull(v.outcome_evidence), channel: orNull(v.channel),
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
        <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Grow caregiver app installs this quarter" autoFocus />
      </Field>
      <fieldset className="impact-fieldset field--wide">
        <legend>Business outcome <span className="req">required</span></legend>
        <p className="small muted">Describe the result for the business within the timeframe — not the number of tasks to finish. Linked tasks are how you get there; finishing them does not by itself mean the outcome was achieved.</p>
        <div className="grid-form">
          <Field label="Expected business outcome" required wide>
            <textarea rows={2} value={v.outcome_statement} onChange={(e) => set("outcome_statement", e.target.value)} placeholder="e.g. More caregivers start using refill reminders, lifting repeat orders" />
          </Field>
          <Field label="Business rationale" required wide hint="Why this outcome matters to the business now">
            <textarea rows={2} value={v.outcome_rationale} onChange={(e) => set("outcome_rationale", e.target.value)} />
          </Field>
          <Field label="Success measures" required wide hint="How achievement will be judged — numbers only where they are agreed">
            <textarea rows={2} value={v.success_measures} onChange={(e) => set("success_measures", e.target.value)} placeholder="e.g. Weekly installs from caregiver campaigns; repeat-order rate" />
          </Field>
          <Field label="Importance">
            <select value={v.importance} onChange={(e) => set("importance", e.target.value)}>
              <option value="">Not set</option>
              {Object.entries(IMPORTANCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Target type" hint={v.outcome_kind === "measurable" ? "A metric with an agreed number" : "No agreed number yet — judged against the success measures"}>
            <select value={v.outcome_kind} onChange={(e) => set("outcome_kind", e.target.value)}>
              <option value="qualitative">Qualitative</option>
              <option value="measurable">Measurable</option>
            </select>
          </Field>
          {v.outcome_kind === "measurable" && (
            <>
              <Field label="Metric" required><input value={v.outcome_metric} onChange={(e) => set("outcome_metric", e.target.value)} placeholder="App installs per week" /></Field>
              <Field label="Unit"><input value={v.outcome_unit} onChange={(e) => set("outcome_unit", e.target.value)} placeholder="installs" /></Field>
              <Field label="Baseline" hint="Where it is today, if known"><input inputMode="decimal" value={v.outcome_baseline} onChange={(e) => set("outcome_baseline", e.target.value)} /></Field>
              <Field label="Target" required><input inputMode="decimal" value={v.outcome_target} onChange={(e) => set("outcome_target", e.target.value)} /></Field>
            </>
          )}
        </div>
      </fieldset>
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
      <Field label="Channel">
        <select value={v.channel} onChange={(e) => set("channel", e.target.value)}>
          <option value="">Not set</option>
          {options("channel").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Start date"><input type="date" value={v.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
      <Field label="End date"><input type="date" value={v.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
      <Field label="How task progress is measured" required wide hint={`${METHOD_HELP[v.progress_method]} This tracks the work, not the business outcome.`}>
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
        <fieldset className="impact-fieldset field--wide">
          <legend>Actual business outcome</legend>
          <p className="small muted">Record what actually happened, with evidence. This is the only place a goal's outcome is marked achieved — never inferred from task completion.</p>
          <div className="grid-form">
            <Field label="Outcome status">
              <select value={v.outcome_status} onChange={(e) => set("outcome_status", e.target.value as Goal["outcome_status"])}>
                {Object.entries(OUTCOME_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            {v.outcome_kind === "measurable" && (
              <Field label={`Actual ${v.outcome_metric || "value"}`} hint="Latest measured value"><input inputMode="decimal" value={v.outcome_actual} onChange={(e) => set("outcome_actual", e.target.value)} /></Field>
            )}
            <Field label="Evidence" wide hint="Report, dashboard link or source for the recorded outcome">
              <textarea rows={2} value={v.outcome_evidence} onChange={(e) => set("outcome_evidence", e.target.value)} />
            </Field>
          </div>
        </fieldset>
      )}
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
