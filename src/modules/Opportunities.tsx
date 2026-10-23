import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  client, type Opportunity, run, useCreateTask, useInvalidate, useLookups, useOpportunities, useOpportunity, useSignals,
} from "../lib/api.ts";
import { formatDateTime, taskRef } from "../lib/format.ts";
import { EVIDENCE_LABEL, OBJECTIVE_LABEL, OPP_STATUS_LABEL, SCORE_DIMENSIONS, scoreAverage } from "../lib/labels.ts";
import { useMember } from "../lib/session.tsx";
import { Chip } from "../components/Tone.tsx";
import { PriorityMark, StatusBadge } from "../components/Badges.tsx";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { TaskForm, type TaskFormValues, valuesToTask } from "../workspace/TaskForm.tsx";

export const oppRef = (ref: number) => `O-${ref}`;

// ---------------------------------------------------------------- list
export function OpportunityList() {
  const opps = useOpportunities();
  const { memberName } = useLookups();
  const { member: me } = useMember();
  const [status, setStatus] = useState("open");
  if (opps.isPending) return <Loading />;
  if (opps.isError) return <StatePanel title="Could not load opportunities" tone="error"><p>{opps.error.message}</p></StatePanel>;
  const rows = opps.data.filter((o) => status === "open" ? ["considering", "needs_research", "approved"].includes(o.status) : !status || o.status === status);
  const awaiting = opps.data.filter((o) => o.status === "considering" || o.status === "needs_research").length;

  return (
    <>
      <header className="page-header page-header--row">
        <div>
          <h1>Content Opportunities</h1>
          <p className="muted">Ideas worth evaluating, each with its audience need, evidence and rationale. Sourabh or Tanvi decide; approved ideas become work.</p>
        </div>
        <Link to="/opportunities/new" className="button button--primary">+ New opportunity</Link>
      </header>
      {me.role === "admin" && awaiting > 0 && <div className="state state--warning">{awaiting} opportunit{awaiting === 1 ? "y is" : "ies are"} waiting for your decision.</div>}
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Open (considering, research, approved)</option>
          <option value="">All</option>
          {Object.entries(OPP_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {rows.length === 0 ? (
        <StatePanel title="No opportunities here">
          <p>Create one from a <Link to="/radar">Radar</Link> signal, or start from a business need with New opportunity.</p>
        </StatePanel>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ref</th><th>Opportunity</th><th>Format</th><th>Priority</th><th>Score</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td><span className="ref">{oppRef(o.ref)}</span></td>
                  <td className="wrap"><Link to={`/opportunities/${o.ref}`}>{o.title}</Link>{o.content_angle && <div className="small muted">{o.content_angle}</div>}</td>
                  <td>{o.suggested_format ?? "—"}</td>
                  <td>{o.priority ? <PriorityMark code={o.priority} label={o.priority[0]!.toUpperCase() + o.priority.slice(1)} /> : "—"}</td>
                  <td>{scoreAverage(o.scores) ?? "—"}</td>
                  <td><Chip code={o.status} label={OPP_STATUS_LABEL[o.status]!} /></td>
                  <td className="small">{memberName(o.created_by)}<br />{formatDateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- form
type OppValues = Pick<Opportunity, "title"> & Record<"audience" | "audience_tension" | "strategic_rationale" | "content_angle" | "suggested_format" | "objective" | "proof_checks" | "priority" | "next_action", string> & { scores: Record<string, number> };

const toValues = (o?: Opportunity): OppValues => ({
  title: o?.title ?? "", audience: o?.audience ?? "", audience_tension: o?.audience_tension ?? "", strategic_rationale: o?.strategic_rationale ?? "",
  content_angle: o?.content_angle ?? "", suggested_format: o?.suggested_format ?? "", objective: o?.objective ?? "", proof_checks: o?.proof_checks ?? "",
  priority: o?.priority ?? "", next_action: o?.next_action ?? "", scores: o?.scores ?? {},
});
const toRow = (v: OppValues) => ({
  title: v.title.trim(), audience: orNull(v.audience), audience_tension: orNull(v.audience_tension), strategic_rationale: orNull(v.strategic_rationale),
  content_angle: orNull(v.content_angle), suggested_format: orNull(v.suggested_format), objective: orNull(v.objective), proof_checks: orNull(v.proof_checks),
  priority: orNull(v.priority), next_action: orNull(v.next_action), scores: v.scores,
});

function OppForm({ initial, onSubmit, onCancel, busy, error, submitLabel }: {
  initial: OppValues; onSubmit: (v: OppValues) => void; onCancel: () => void; busy: boolean; error: unknown; submitLabel: string;
}) {
  const [v, setV] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof OppValues>(k: K, val: OppValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const avg = scoreAverage(v.scores);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.title.trim()) { setProblem("Give the opportunity a working title."); return; }
    setProblem(null);
    onSubmit(v);
  }
  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <Field label="Working title" required wide><input value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus /></Field>
      <Field label="Audience and context" wide hint="Who faces the need, in what situation, which language/region"><textarea rows={2} value={v.audience} onChange={(e) => set("audience", e.target.value)} /></Field>
      <Field label="Audience tension / unmet need" wide><textarea rows={2} value={v.audience_tension} onChange={(e) => set("audience_tension", e.target.value)} /></Field>
      <Field label="Why it matters to Akidha" wide><textarea rows={2} value={v.strategic_rationale} onChange={(e) => set("strategic_rationale", e.target.value)} /></Field>
      <Field label="Proposed content angle" wide hint="The original idea and its central educational message"><textarea rows={2} value={v.content_angle} onChange={(e) => set("content_angle", e.target.value)} /></Field>
      <Field label="Suggested format"><input value={v.suggested_format} onChange={(e) => set("suggested_format", e.target.value)} placeholder="Reel, carousel, static, Meta ad, article…" /></Field>
      <Field label="Objective / funnel role">
        <select value={v.objective} onChange={(e) => set("objective", e.target.value)}>
          <option value="">Not set</option>
          {Object.entries(OBJECTIVE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Proof / claim checks" wide hint="What evidence is needed before anything is published; mark uncertainty"><textarea rows={2} value={v.proof_checks} onChange={(e) => set("proof_checks", e.target.value)} /></Field>
      <Field label="Priority">
        <select value={v.priority} onChange={(e) => set("priority", e.target.value)}>
          <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </Field>
      <Field label="Suggested next action"><input value={v.next_action} onChange={(e) => set("next_action", e.target.value)} placeholder="Create a brief, research further…" /></Field>
      <fieldset className="field--wide scores">
        <legend className="field__label">Prioritisation (1–5, optional) · average {avg ?? "—"}</legend>
        <p className="field__hint">An explainable aid for the decision, not a prediction of performance.</p>
        <div className="scores__grid">
          {SCORE_DIMENSIONS.map((d) => (
            <label key={d.key} className="score" title={d.hint}>
              <span>{d.label}</span>
              <select value={v.scores[d.key] ?? ""} onChange={(e) => {
                const next = { ...v.scores };
                if (e.target.value) next[d.key] = Number(e.target.value); else delete next[d.key];
                set("scores", next);
              }}>
                <option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field--wide">
        {problem && <p className="form__error">{problem}</p>}
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}

export function NewOpportunity() {
  const [params] = useSearchParams();
  const signalId = params.get("signal");
  const signals = useSignals();
  const signal = signals.data?.find((s) => s.id === signalId);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const { member: me } = useMember();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (signalId && signals.isPending) return <Loading />;
  const initial = toValues();
  if (signal) { initial.title = signal.title; initial.proof_checks = "Verify the source and any figures before use."; }

  return (
    <>
      <p className="crumbs"><Link to="/opportunities">Opportunities</Link> / New</p>
      <header className="page-header"><h1>New opportunity</h1>
        <p className="muted">Turn a signal or business need into a clearly argued idea for Sourabh or Tanvi to decide on.</p></header>
      {signal && (
        <div className="card evidence-card">
          <p className="small muted">Evidence from Radar</p>
          <a href={signal.url} target="_blank" rel="noopener noreferrer nofollow">{signal.title}</a>
          <p className="small muted">{signal.publisher ?? signal.source_name} · {EVIDENCE_LABEL[signal.evidence_class]} · published {signal.published_at ? formatDateTime(signal.published_at) : "date unknown"}</p>
        </div>
      )}
      <section className="card">
        <OppForm initial={initial} busy={busy} error={error} submitLabel="Create opportunity" onCancel={() => navigate(-1)}
          onSubmit={async (v) => {
            setBusy(true); setError(null);
            try {
              const row = await run<{ id: string; ref: number }>(client().from("opportunities").insert({ ...toRow(v), created_by: me.id }).select("id, ref").single());
              if (signal) await run(client().from("opportunity_signals").insert({ opportunity_id: row.id, signal_id: signal.id }));
              await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["radar_signals"] })]);
              navigate(`/opportunities/${row.ref}`);
            } catch (e) { setError(e); } finally { setBusy(false); }
          }} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- detail
export function OpportunityDetail() {
  const ref = Number(useParams().ref);
  const q = useOpportunity(ref);
  const { memberName } = useLookups();
  const { member: me } = useMember();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createTask = useCreateTask();
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<null | "approved" | "needs_research" | "deferred" | "rejected" | "considering">(null);
  const [note, setNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (q.isPending) return <Loading />;
  if (q.isError) return <StatePanel title="Could not load opportunity" tone="error"><p>{q.error.message}</p></StatePanel>;
  if (!q.data) return <StatePanel title="Opportunity not found"><p><Link to="/opportunities">Back</Link></p></StatePanel>;
  const { opp, signals, tasks } = q.data;
  const isAdmin = me.role === "admin";
  const locked = ["approved", "rejected", "converted"].includes(opp.status);
  const canEdit = isAdmin || (opp.created_by === me.id && !locked);
  const refresh = () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["radar_signals"] })]);

  async function decide() {
    if (!deciding) return;
    setBusy(true); setError(null);
    try { await run(client().rpc("opportunity_decide", { p_id: opp.id, p_decision: deciding, p_note: note || null })); setDeciding(null); setNote(""); await refresh(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }

  const taskInitial: TaskFormValues = {
    title: opp.title, task_type: "content_development", work_origin: "planned", owner_id: me.id, priority: opp.priority ?? "", due_date: "",
    goal_id: "", counts_toward_goal: false,
    brief: [opp.content_angle && `Angle: ${opp.content_angle}`, opp.audience && `Audience: ${opp.audience}`, opp.audience_tension && `Need: ${opp.audience_tension}`,
      opp.proof_checks && `Claim checks: ${opp.proof_checks}`, `From ${oppRef(opp.ref)}.`].filter(Boolean).join("\n"),
    deliverable_format: opp.suggested_format ?? "", channel: "", requester: "", estimate_hours: "", completion_criteria: "", reviewer_id: "",
    workflow_template_id: "", deliverable_url: "", publish_date: "",
  };

  return (
    <article>
      <p className="crumbs"><Link to="/opportunities">Opportunities</Link> / {oppRef(opp.ref)}</p>
      <header className="task-detail__header">
        <div>
          <h1>{opp.title}</h1>
          <div className="chips">
            <Chip code={opp.status} label={OPP_STATUS_LABEL[opp.status]!} />
            {opp.priority && <PriorityMark code={opp.priority} label={opp.priority} />}
            {opp.objective && <span className="chip">{OBJECTIVE_LABEL[opp.objective]}</span>}
            {opp.suggested_format && <span className="chip">{opp.suggested_format}</span>}
          </div>
        </div>
        {canEdit && <button type="button" className="button" onClick={() => setEditing(true)}>Edit</button>}
      </header>

      <div className="action-bar">
        {isAdmin && opp.status !== "converted" && (
          <>
            {opp.status !== "approved" && <button type="button" className="button button--primary" onClick={() => setDeciding("approved")}>Approve</button>}
            {opp.status !== "needs_research" && <button type="button" className="button" onClick={() => setDeciding("needs_research")}>Needs research</button>}
            {opp.status !== "deferred" && <button type="button" className="button" onClick={() => setDeciding("deferred")}>Defer</button>}
            {opp.status !== "rejected" && <button type="button" className="button button--quiet" onClick={() => setDeciding("rejected")}>Reject</button>}
            {["rejected", "deferred"].includes(opp.status) && <button type="button" className="button" onClick={() => setDeciding("considering")}>Reconsider</button>}
          </>
        )}
        {isAdmin && (opp.status === "approved" || opp.status === "converted") && (
          <button type="button" className="button button--primary" onClick={() => { createTask.reset(); setConverting(true); }}>Create task from this</button>
        )}
        {(opp.status === "approved" || opp.status === "converted") && (
          <Link className="button" to={`/intelligence?opportunity=${opp.ref}`}>Draft brief with AI</Link>
        )}
        {!isAdmin && <span className="muted small">{opp.status === "considering" || opp.status === "needs_research" ? "Waiting for Sourabh or Tanvi to decide." : "Decided by an admin."}</span>}
      </div>
      <ErrorText error={error} />

      <div className="task-detail__grid">
        <section className="card">
          <h2>The idea</h2>
          <dl className="details">
            <dt>Audience</dt><dd className="prewrap">{opp.audience ?? "—"}</dd>
            <dt>Tension / need</dt><dd className="prewrap">{opp.audience_tension ?? "—"}</dd>
            <dt>Why it matters</dt><dd className="prewrap">{opp.strategic_rationale ?? "—"}</dd>
            <dt>Angle</dt><dd className="prewrap">{opp.content_angle ?? "—"}</dd>
            <dt>Proof checks</dt><dd className="prewrap">{opp.proof_checks ?? "—"}</dd>
            <dt>Next action</dt><dd>{opp.next_action ?? "—"}</dd>
            <dt>Created</dt><dd>{memberName(opp.created_by)} · {formatDateTime(opp.created_at)}</dd>
            {opp.decided_at && <><dt>Decision</dt><dd>{OPP_STATUS_LABEL[opp.status]} by {memberName(opp.decided_by)} · {formatDateTime(opp.decided_at)}{opp.decision_note && <div className="prewrap small">{opp.decision_note}</div>}</dd></>}
          </dl>
          <h3>Prioritisation</h3>
          {scoreAverage(opp.scores) == null ? <p className="muted small">Not scored.</p> : (
            <ul className="score-list">
              {SCORE_DIMENSIONS.filter((d) => opp.scores[d.key]).map((d) => <li key={d.key}><span>{d.label}</span><strong>{opp.scores[d.key]}</strong></li>)}
              <li className="score-list__total"><span>Average</span><strong>{scoreAverage(opp.scores)}</strong></li>
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Evidence</h2>
          {signals.length === 0 ? <p className="muted small">No Radar signals linked. This idea rests on the rationale above.</p> : (
            <ul className="evidence-list">
              {signals.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a>
                  <span className="small muted">{s.publisher ?? s.source_name} · {EVIDENCE_LABEL[s.evidence_class]} · published {s.published_at ? formatDateTime(s.published_at) : "date unknown"}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link small" onClick={() => setLinking(true)}>+ Link a Radar signal</button>
          <h2 className="section-title">Work created</h2>
          {tasks.length === 0 ? <p className="muted small">No tasks yet.</p> : (
            <ul className="linked-tasks">{tasks.map((t) => <li key={t.id}><Link to={`/workspace/tasks/${t.ref}`}>{taskRef(t.ref)} · {t.title}</Link><StatusBadge code={t.status} label={t.status.replace(/_/g, " ")} /></li>)}</ul>
          )}
        </section>
      </div>

      <Modal title="Edit opportunity" open={editing} onClose={() => setEditing(false)} wide>
        {editing && <OppForm initial={toValues(opp)} busy={busy} error={error} submitLabel="Save" onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            setBusy(true); setError(null);
            try { await run(client().from("opportunities").update(toRow(v)).eq("id", opp.id)); setEditing(false); await refresh(); }
            catch (e) { setError(e); } finally { setBusy(false); }
          }} />}
      </Modal>

      <Modal title={deciding ? `${deciding === "considering" ? "Reconsider" : OPP_STATUS_LABEL[deciding]}: ${opp.title}` : ""} open={Boolean(deciding)} onClose={() => setDeciding(null)}>
        <div className="stack">
          {deciding === "approved" && <p className="small muted">Approving does not add work by itself. Use “Create task from this” to put it into the Workspace.</p>}
          <Field label={deciding === "approved" || deciding === "considering" ? "Note (optional)" : "Reason"} required={deciding !== "approved" && deciding !== "considering"}>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </Field>
          <ErrorText error={error} />
          <div className="form__actions">
            <button type="button" className="button" onClick={() => setDeciding(null)}>Back</button>
            <button type="button" className="button button--primary" disabled={busy || (deciding !== "approved" && deciding !== "considering" && !note.trim())} onClick={decide}>Confirm</button>
          </div>
        </div>
      </Modal>

      <Modal title="Create task from opportunity" open={converting} onClose={() => setConverting(false)} wide>
        {converting && <TaskForm mode="create" initial={taskInitial} restrictedEditable busy={createTask.isPending} error={createTask.error}
          onCancel={() => setConverting(false)}
          onSubmit={(v) => createTask.mutate({ ...valuesToTask(v), opportunity_id: opp.id, created_by: me.id },
            { onSuccess: (row) => { setConverting(false); void refresh(); navigate(`/workspace/tasks/${row.ref}`); } })} />}
      </Modal>

      {linking && <LinkSignal opportunityId={opp.id} linked={signals.map((s) => s.id)} onClose={() => setLinking(false)} onSaved={refresh} />}
    </article>
  );
}

function LinkSignal({ opportunityId, linked, onClose, onSaved }: { opportunityId: string; linked: string[]; onClose: () => void; onSaved: () => void }) {
  const signals = useSignals();
  const [q, setQ] = useState("");
  const [error, setError] = useState<unknown>(null);
  const rows = (signals.data ?? []).filter((s) => !linked.includes(s.id) && s.status !== "dismissed" && (!q || s.title.toLowerCase().includes(q.toLowerCase()))).slice(0, 30);
  return (
    <Modal title="Link a Radar signal" open onClose={onClose} wide>
      <div className="stack">
        <input type="search" placeholder="Search signals" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search signals" />
        {signals.isPending ? <Loading /> : rows.length === 0 ? <p className="muted">No matching signals.</p> : (
          <ul className="evidence-list">
            {rows.map((s) => (
              <li key={s.id} className="evidence-list__pick">
                <span><strong>{s.title}</strong><br /><span className="small muted">{s.publisher ?? s.source_name} · {EVIDENCE_LABEL[s.evidence_class]}</span></span>
                <button type="button" className="button button--small" onClick={async () => {
                  try { await run(client().from("opportunity_signals").insert({ opportunity_id: opportunityId, signal_id: s.id })); onSaved(); onClose(); }
                  catch (e) { setError(e); }
                }}>Link</button>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
