import { useMemo, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  client, type Learning, run, type TaskEvent, type TaskStage, useAllStages, useAllTaskEvents, useGoals, useLearnings, useLookups,
  useOpportunities, useTasks,
} from "../lib/api.ts";
import { formatDate, formatDateTime, formatDuration, goalRef, minutesBetween, taskRef } from "../lib/format.ts";
import { LEARNING_CLASS_LABEL, LEARNING_STATUS_LABEL } from "../lib/labels.ts";
import { useMember } from "../lib/session.tsx";
import { Chip } from "../components/Tone.tsx";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { oppRef } from "./Opportunities.tsx";

export function LearningLoop() {
  return (
    <>
      <header className="page-header">
        <h1>Learning Loop</h1>
        <p className="muted">What happened, what we think explains it, how sure we are, and what to test next. Process insights come from recorded workflow history only.</p>
      </header>
      <nav className="tabs" aria-label="Learning views">
        <NavLink to="/learning" end>Learnings</NavLink>
        <NavLink to="/learning/process">Process insights</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

// ---------------------------------------------------------------- learnings
type Values = Record<"title" | "learning_class" | "observation" | "period_start" | "period_end" | "evidence" | "interpretation" | "confidence"
  | "limitations" | "next_test" | "owner_id" | "review_date" | "task_id" | "goal_id" | "opportunity_id", string>;

const empty = (owner: string): Values => ({
  title: "", learning_class: "marketing_outcome", observation: "", period_start: "", period_end: "", evidence: "", interpretation: "",
  confidence: "unknown", limitations: "", next_test: "", owner_id: owner, review_date: "", task_id: "", goal_id: "", opportunity_id: "",
});
const fromLearning = (l: Learning): Values => Object.fromEntries(Object.keys(empty("")).map((k) => [k, (l as unknown as Record<string, string | null>)[k] ?? ""])) as Values;
const toRow = (v: Values) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, k === "title" || k === "observation" ? val.trim() : orNull(val)]));

export function Learnings() {
  const learnings = useLearnings();
  const { memberName } = useLookups();
  const { member: me } = useMember();
  const qc = useQueryClient();
  const isAdmin = me.role === "admin";
  const [status, setStatus] = useState("");
  const [cls, setCls] = useState("");
  const [editing, setEditing] = useState<{ id?: string; values: Values } | null>(null);
  const [deciding, setDeciding] = useState<{ l: Learning; decision: "accepted" | "rejected" | "superseded" } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);

  if (learnings.isPending) return <Loading />;
  if (learnings.isError) return <StatePanel title="Could not load learnings" tone="error"><p>{learnings.error.message}</p></StatePanel>;
  const rows = learnings.data.filter((l) => (!status || l.status === status) && (!cls || l.learning_class === cls));
  const pending = learnings.data.filter((l) => l.status === "pending_review").length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["learnings"] });

  async function decide() {
    if (!deciding) return;
    setError(null);
    try { await run(client().rpc("learning_decide", { p_id: deciding.l.id, p_decision: deciding.decision, p_note: note || null })); setDeciding(null); setNote(""); await refresh(); }
    catch (e) { setError(e); }
  }

  return (
    <>
      {isAdmin && pending > 0 && <div className="state state--warning">{pending} learning{pending > 1 ? "s" : ""} waiting for your review.</div>}
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(LEARNING_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(LEARNING_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" className="button button--primary" onClick={() => setEditing({ values: empty(me.id) })}>+ Record a learning</button>
      </div>
      {rows.length === 0 ? <StatePanel title="No learnings recorded"><p>Record an observation from a campaign, a piece of content or the way work flowed.</p></StatePanel> : (
        <div className="goal-list">
          {rows.map((l) => (
            <section key={l.id} className="card learning">
              <header className="goal__header">
                <div>
                  <span className="ref">L-{l.ref}</span>
                  <h2>{l.title}</h2>
                  <p className="small muted">{LEARNING_CLASS_LABEL[l.learning_class] ?? l.learning_class} · confidence {l.confidence} · {l.period_start || l.period_end ? `${formatDate(l.period_start)} – ${formatDate(l.period_end)}` : "period not set"} · recorded by {memberName(l.created_by)}</p>
                </div>
                <div className="goal__side">
                  <Chip code={l.status} label={LEARNING_STATUS_LABEL[l.status]!} />
                  {(isAdmin || (l.created_by === me.id && l.status === "pending_review")) && <button type="button" className="button button--small" onClick={() => setEditing({ id: l.id, values: fromLearning(l) })}>Edit</button>}
                </div>
              </header>
              <dl className="details">
                <dt>Observation</dt><dd className="prewrap">{l.observation}</dd>
                {l.evidence && <><dt>Evidence / source</dt><dd className="prewrap">{l.evidence}</dd></>}
                {l.interpretation && <><dt>Interpretation</dt><dd className="prewrap">{l.interpretation} <span className="tag">hypothesis</span></dd></>}
                {l.limitations && <><dt>Limitations</dt><dd className="prewrap">{l.limitations}</dd></>}
                {l.next_test && <><dt>Next test</dt><dd className="prewrap">{l.next_test}</dd></>}
                <dt>Owner</dt><dd>{memberName(l.owner_id)}{l.review_date && ` · review ${formatDate(l.review_date)}`}</dd>
                <LinkedRefs l={l} />
                {l.decided_at && <><dt>Review</dt><dd>{LEARNING_STATUS_LABEL[l.status]} by {memberName(l.decided_by)} · {formatDateTime(l.decided_at)}{l.decision_note && ` — ${l.decision_note}`}</dd></>}
              </dl>
              {isAdmin && (
                <div className="row-actions">
                  {l.status !== "accepted" && <button type="button" className="button button--small button--primary" onClick={() => setDeciding({ l, decision: "accepted" })}>Accept</button>}
                  {l.status !== "rejected" && <button type="button" className="button button--small" onClick={() => setDeciding({ l, decision: "rejected" })}>Reject</button>}
                  {l.status === "accepted" && <button type="button" className="button button--small button--quiet" onClick={() => setDeciding({ l, decision: "superseded" })}>Superseded</button>}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {editing && <LearningForm initial={editing.values} id={editing.id} onClose={() => setEditing(null)} onSaved={refresh} />}
      <Modal title={deciding ? `${LEARNING_STATUS_LABEL[deciding.decision]}: ${deciding.l.title}` : ""} open={Boolean(deciding)} onClose={() => setDeciding(null)}>
        <div className="stack">
          {deciding?.decision === "accepted" && <p className="small muted">Accepted learnings are treated as validated team knowledge. Interpretations remain hypotheses unless evidence supports them.</p>}
          <Field label={deciding?.decision === "accepted" ? "Note (optional)" : "Reason"} required={deciding?.decision !== "accepted"}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <ErrorText error={error} />
          <div className="form__actions"><button type="button" className="button" onClick={() => setDeciding(null)}>Back</button>
            <button type="button" className="button button--primary" disabled={deciding?.decision !== "accepted" && !note.trim()} onClick={decide}>Confirm</button></div>
        </div>
      </Modal>
    </>
  );
}

function LinkedRefs({ l }: { l: Learning }) {
  const tasks = useTasks();
  const goals = useGoals();
  const opps = useOpportunities();
  const t = tasks.data?.find((x) => x.id === l.task_id);
  const g = goals.data?.find((x) => x.id === l.goal_id);
  const o = opps.data?.find((x) => x.id === l.opportunity_id);
  if (!t && !g && !o) return null;
  return (
    <><dt>Linked to</dt><dd className="chips">
      {t && <Link className="chip" to={`/workspace/tasks/${t.ref}`}>{taskRef(t.ref)} · {t.title}</Link>}
      {g && <Link className="chip" to="/workspace/goals">{goalRef(g.ref)} · {g.title}</Link>}
      {o && <Link className="chip" to={`/opportunities/${o.ref}`}>{oppRef(o.ref)} · {o.title}</Link>}
    </dd></>
  );
}

function LearningForm({ initial, id, onClose, onSaved }: { initial: Values; id?: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { members } = useLookups();
  const tasks = useTasks();
  const goals = useGoals();
  const opps = useOpportunities();
  const { member: me } = useMember();
  const set = (k: keyof Values, val: string) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!v.title.trim() || !v.observation.trim()) { setError(new Error("A title and the observation are required.")); return; }
    if (v.period_start && v.period_end && v.period_end < v.period_start) { setError(new Error("Period end must be after the start.")); return; }
    setBusy(true);
    try {
      if (id) await run(client().from("learnings").update(toRow(v)).eq("id", id));
      else await run(client().from("learnings").insert({ ...toRow(v), created_by: me.id }));
      onSaved(); onClose();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Modal title={id ? "Edit learning" : "Record a learning"} open onClose={onClose} wide>
      <form className="grid-form" onSubmit={submit} noValidate>
        <Field label="Title" required wide><input value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus /></Field>
        <Field label="Type">
          <select value={v.learning_class} onChange={(e) => set("learning_class", e.target.value)}>
            {Object.entries(LEARNING_CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Confidence">
          <select value={v.confidence} onChange={(e) => set("confidence", e.target.value)}>
            <option value="unknown">Unknown</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
        <Field label="Observation — what actually happened" required wide><textarea rows={3} value={v.observation} onChange={(e) => set("observation", e.target.value)} /></Field>
        <Field label="Period from"><input type="date" value={v.period_start} onChange={(e) => set("period_start", e.target.value)} /></Field>
        <Field label="Period to"><input type="date" value={v.period_end} onChange={(e) => set("period_end", e.target.value)} /></Field>
        <Field label="Evidence / data source" wide hint="Where the numbers or observations come from"><textarea rows={2} value={v.evidence} onChange={(e) => set("evidence", e.target.value)} /></Field>
        <Field label="Interpretation — what we think explains it" wide hint="Kept separate from the observation; treated as a hypothesis"><textarea rows={2} value={v.interpretation} onChange={(e) => set("interpretation", e.target.value)} /></Field>
        <Field label="Limitations" wide hint="Sample size, missing data, other explanations"><textarea rows={2} value={v.limitations} onChange={(e) => set("limitations", e.target.value)} /></Field>
        <Field label="Next test or decision" wide><textarea rows={2} value={v.next_test} onChange={(e) => set("next_test", e.target.value)} /></Field>
        <Field label="Owner">
          <select value={v.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
            <option value="">Not set</option>
            {(members.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </Field>
        <Field label="Review on"><input type="date" value={v.review_date} onChange={(e) => set("review_date", e.target.value)} /></Field>
        <Field label="Linked task">
          <select value={v.task_id} onChange={(e) => set("task_id", e.target.value)}>
            <option value="">None</option>{(tasks.data ?? []).map((t) => <option key={t.id} value={t.id}>{taskRef(t.ref)} · {t.title}</option>)}
          </select>
        </Field>
        <Field label="Linked goal">
          <select value={v.goal_id} onChange={(e) => set("goal_id", e.target.value)}>
            <option value="">None</option>{(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{goalRef(g.ref)} · {g.title}</option>)}
          </select>
        </Field>
        <Field label="Linked opportunity" wide>
          <select value={v.opportunity_id} onChange={(e) => set("opportunity_id", e.target.value)}>
            <option value="">None</option>{(opps.data ?? []).map((o) => <option key={o.id} value={o.id}>{oppRef(o.ref)} · {o.title}</option>)}
          </select>
        </Field>
        <div className="field--wide">
          <ErrorText error={error} />
          <div className="form__actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- process insights
export interface StageStat { stage: string; completed: number; waits: number[]; times: number[]; revisions: number; total: number }

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Per-stage durations from recorded timestamps only; missing timestamps are counted as not tracked. */
export function stageStats(stages: TaskStage[]): StageStat[] {
  const by = new Map<string, StageStat>();
  for (const s of stages) {
    if (s.state === "pending" || s.state === "skipped") continue;
    const st = by.get(s.stage_code) ?? { stage: s.stage_code, completed: 0, waits: [], times: [], revisions: 0, total: 0 };
    st.total += 1;
    st.revisions += s.revision_count;
    const wait = minutesBetween(s.ready_at, s.picked_up_at);
    if (wait != null) st.waits.push(wait);
    if (s.state === "done") {
      st.completed += 1;
      const t = minutesBetween(s.entered_at, s.completed_at);
      if (t != null) st.times.push(t);
    }
    by.set(s.stage_code, st);
  }
  return [...by.values()].sort((a, b) => (median(b.waits) ?? -1) - (median(a.waits) ?? -1));
}

export function ProcessInsights() {
  const stages = useAllStages();
  const events = useAllTaskEvents(2000);
  const { label } = useLookups();
  const stats = useMemo(() => stageStats(stages.data ?? []), [stages.data]);
  const decisions = useMemo(() => {
    const ev = (events.data ?? []) as TaskEvent[];
    return {
      approved: ev.filter((e) => e.event_type === "approved").length,
      changes: ev.filter((e) => e.event_type === "changes_requested").length,
      rework: ev.filter((e) => e.event_type === "returned_for_rework"),
      blocked: ev.filter((e) => e.event_type === "blocked"),
    };
  }, [events.data]);

  if (stages.isPending || events.isPending) return <Loading />;
  if (!stats.length) return <StatePanel title="Not enough workflow history yet"><p>Insights appear once tasks have moved through stages. Nothing before the tracker started is reconstructed.</p></StatePanel>;

  return (
    <>
      <p className="muted small">Medians from recorded timestamps. “Wait” = hand-off to pick-up; “stage time” = stage start to completion (includes waiting). Small samples are shown with their size — treat them as prompts to look, not conclusions.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Stage</th><th>Times used</th><th>Median wait</th><th>Wait sample</th><th>Median stage time</th><th>Completed</th><th>Rework returns</th></tr></thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.stage}>
                <td>{label("workflow_stage", s.stage)}</td>
                <td>{s.total}</td>
                <td><strong>{formatDuration(median(s.waits))}</strong></td>
                <td className="small muted">n={s.waits.length}</td>
                <td>{formatDuration(median(s.times))}</td>
                <td>{s.completed}</td>
                <td>{s.revisions || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="attention-grid section-title">
        <section className="card">
          <h2>Approval outcomes</h2>
          <p>{decisions.approved} approved · {decisions.changes} changes requested</p>
          <p className="small muted">{decisions.approved + decisions.changes > 0 ? `${Math.round((100 * decisions.approved) / (decisions.approved + decisions.changes))}% of decisions were approvals (n=${decisions.approved + decisions.changes}).` : "No decisions recorded yet."}</p>
        </section>
        <section className="card">
          <h2>Recent rework reasons</h2>
          {decisions.rework.length === 0 ? <p className="small muted">None recorded.</p> : (
            <ul className="small">{decisions.rework.slice(0, 8).map((e) => <li key={e.id}>{label("workflow_stage", e.to_value)}: {e.note}</li>)}</ul>
          )}
        </section>
        <section className="card">
          <h2>Recent blockers</h2>
          {decisions.blocked.length === 0 ? <p className="small muted">None recorded.</p> : (
            <ul className="small">{decisions.blocked.slice(0, 8).map((e) => <li key={e.id}>{formatDate(e.occurred_at)}: {e.note}</li>)}</ul>
          )}
        </section>
      </div>
    </>
  );
}
