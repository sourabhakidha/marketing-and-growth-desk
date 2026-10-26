import { useState } from "react";
import { Link, NavLink, Outlet, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  type AiDraft, callApi, client, type DraftOutput, type KnowledgeDoc, run, useDrafts, useHealth, useKnowledge, useLookups,
  useOpportunities, useTasks, useWorkflowAction,
} from "../lib/api.ts";
import { useScope } from "../lib/scope.tsx";
import { draftTable } from "../lib/exportRows.ts";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import {formatDateTime, todayInIndia} from "../lib/format.ts";
import { DRAFT_STATUS_LABEL } from "../lib/labels.ts";
import { useMember } from "../lib/session.tsx";
import { Chip } from "../components/Tone.tsx";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";


export const DAILY_LIMIT = 30;
const LANGUAGES = ["Hinglish", "Hindi (Devanagari)", "Marathi", "English"];
const FORMATS = ["Reel / short video", "Long video", "Static post", "Carousel", "Meta ad copy", "WhatsApp message", "Banner / leaflet", "Podcast / talking head"];

export function draftToText(d: AiDraft): string {
  const o = d.output;
  if (!o) return "";
  const lines = [
    o.working_title, "", `Objective: ${o.objective}`, `Audience: ${o.audience}`, `Language: ${o.language}`, `Format: ${o.format_and_duration}`,
    `Core message: ${o.core_message}`, "", "Hook options:", ...o.hook_options.map((h) => `- ${h}`), "", "Structure:",
    ...o.structure.map((b) => `- ${b.beat}: ${b.content}`),
  ];
  if (o.script_text) lines.push("", "Script:", o.script_text);
  if (o.on_screen_text.length) lines.push("", "On-screen text:", ...o.on_screen_text.map((t) => `- ${t}`));
  lines.push("", `CTA: ${o.cta}`, `Visual direction: ${o.visual_direction}`);
  if (o.claims_requiring_review.length) lines.push("", "Claims requiring review:", ...o.claims_requiring_review.map((c) => `- ${c}`));
  if (o.assumptions_and_gaps.length) lines.push("", "Assumptions and gaps:", ...o.assumptions_and_gaps.map((c) => `- ${c}`));
  lines.push("", `AI draft (${d.model ?? "model unknown"}) — needs human review before use.`);
  return lines.join("\n");
}

export function Intelligence() {
  return (
    <>
      <header className="page-header">
        <h1>AI Intelligence</h1>
        <p className="muted">Draft briefs and scripts grounded in Akidha's brand guidelines and past script patterns. Every draft is a proposal: it changes nothing until a person uses it.</p>
      </header>
      <nav className="tabs" aria-label="AI views">
        <NavLink to="/intelligence" end>Drafts</NavLink>
        <NavLink to="/intelligence/knowledge">Knowledge base</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

export function Drafts() {
  const drafts = useDrafts(); // latest drafts, for today's count against the daily limit
  const dates = useDateRange();
  const listed = useDrafts(dates.range);
  const health = useHealth();
  const { member: me } = useMember();
  const { memberName, label } = useLookups();
  const [params] = useSearchParams();
  const { isMe: mine } = useScope();
  const today = todayInIndia();
  const usedToday = (drafts.data ?? []).filter((d) => d.created_by === me.id &&
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(d.created_at)) === today).length;
  const aiReady = health.data?.integrations.ai === "configured";
  const rows = (listed.data ?? []).filter((d) => !mine || d.created_by === me.id);

  return (
    <div className="intel-grid">
      <section className="card">
        <h2>New draft</h2>
        {health.data && !aiReady && (
          <div className="state state--warning">AI is not configured yet. An admin needs to add <code>OPENAI_API_KEY</code> and <code>OPENAI_MODEL</code> in Netlify. You can prepare requests; they will fail until then.</div>
        )}
        <p className="small muted">{usedToday} of {DAILY_LIMIT} drafts used today (resets at midnight IST).</p>
        <NewDraft key={params.toString()} initialTaskRef={params.get("task")} initialOppRef={params.get("opportunity")} disabled={usedToday >= DAILY_LIMIT} />
      </section>
      <section>
        <div className="filters">
          <DateRangePicker {...dates} />
          <ExportCsvButton name="ai-drafts" range={dates.range} disabled={listed.isPending} build={() => draftTable(rows, { label, memberName })} />
        </div>
        {listed.isPending ? <Loading /> : rows.length === 0 ? <StatePanel title="No drafts yet"><p>Request a brief or script on the left.</p></StatePanel> : (
          <ul className="draft-list">
            {rows.map((d) => (
              <li key={d.id}>
                <Link to={`/intelligence/drafts/${d.ref}`} className="draft-row">
                  <span className="draft-row__title">{d.output?.working_title ?? `${d.kind === "script" ? "Script" : "Brief"}${d.format ? ` · ${d.format}` : ""}`}</span>
                  <Chip code={d.status} label={DRAFT_STATUS_LABEL[d.status]!} />
                  <span className="small muted">{memberName(d.created_by)} · {formatDateTime(d.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewDraft({ initialTaskRef, initialOppRef, disabled }: { initialTaskRef: string | null; initialOppRef: string | null; disabled: boolean }) {
  const tasks = useTasks();
  const opps = useOpportunities();
  const qc = useQueryClient();
  const { member: me } = useMember();
  const [kind, setKind] = useState<"script" | "brief">("script");
  const [taskId, setTaskId] = useState("");
  const [oppId, setOppId] = useState("");
  const [language, setLanguage] = useState(LANGUAGES[0]!);
  const [format, setFormat] = useState(FORMATS[0]!);
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<number | null>(null);

  const openTasks = (tasks.data ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled");
  const approvedOpps = (opps.data ?? []).filter((o) => o.status === "approved" || o.status === "converted");
  if (initialTaskRef && !taskId && tasks.data) {
    const t = tasks.data.find((x) => String(x.ref) === initialTaskRef);
    if (t) setTaskId(t.id);
  }
  if (initialOppRef && !oppId && opps.data) {
    const o = opps.data.find((x) => String(x.ref) === initialOppRef);
    if (o) { setOppId(o.id); setKind("brief"); }
  }

  async function submit() {
    setError(null);
    if (!taskId && !oppId && !instructions.trim()) { setError(new Error("Choose a task or opportunity, or describe what you need.")); return; }
    setBusy(true);
    try {
      const row = await run<{ id: string; ref: number }>(client().from("ai_drafts").insert({
        kind, task_id: taskId || null, opportunity_id: oppId || null, language, format, duration: orNull(duration),
        instructions: orNull(instructions), created_by: me.id,
      }).select("id, ref").single());
      const res = await callApi("/api/ai-draft", { draftId: row.id });
      if (!res.ok && res.status !== 202) throw new Error(`Drafting could not start (${res.status})`);
      setSent(row.ref);
      setInstructions("");
      await qc.invalidateQueries({ queryKey: ["ai_drafts"] });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="segmented" role="radiogroup" aria-label="Draft type">
        <button type="button" role="radio" aria-checked={kind === "script"} className={kind === "script" ? "is-on" : ""} onClick={() => setKind("script")}>Script</button>
        <button type="button" role="radio" aria-checked={kind === "brief"} className={kind === "brief" ? "is-on" : ""} onClick={() => setKind("brief")}>Creative brief</button>
      </div>
      <Field label="For task">
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">No task</option>
          {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </Field>
      <Field label="From approved opportunity" hint="Its audience need, angle, claim checks and linked evidence are used">
        <select value={oppId} onChange={(e) => setOppId(e.target.value)}>
          <option value="">None</option>
          {approvedOpps.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
      </Field>
      <div className="grid-form">
        <Field label="Language"><select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Field>
        <Field label="Duration / size" wide><input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 45 s, 9:16 · or 5-slide carousel" /></Field>
      </div>
      <Field label="Instructions" hint="Angle, audience, must-include points, things to avoid. Give verified facts here — the AI will not invent them. Never include customer or patient names, phone numbers or prescriptions: on the free AI plan the provider may review what is sent.">
        <textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      {sent && <p className="form__ok small">Draft requested. It usually takes under a minute — it will appear in the list.</p>}
      <div className="form__actions"><button type="button" className="button button--primary" disabled={busy || disabled} onClick={submit}>{disabled ? "Daily limit reached" : busy ? "Requesting…" : "Draft it"}</button></div>
    </div>
  );
}

export function DraftDetail() {
  const ref = Number(useParams().ref);
  const drafts = useDrafts();
  const tasks = useTasks();
  const opps = useOpportunities();
  const { member: me } = useMember();
  const { memberName } = useLookups();
  const qc = useQueryClient();
  const comment = useWorkflowAction();
  const [deciding, setDeciding] = useState<null | "accepted" | "discarded">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  if (drafts.isPending) return <Loading />;
  const d = drafts.data?.find((x) => x.ref === ref);
  if (!d) return <StatePanel title="Draft not found"><p><Link to="/intelligence">Back to drafts</Link></p></StatePanel>;
  const task = tasks.data?.find((t) => t.id === d.task_id);
  const opp = opps.data?.find((o) => o.id === d.opportunity_id);
  const mine = d.created_by === me.id;
  const o = d.output;

  async function decide() {
    setError(null);
    try {
      await run(client().from("ai_drafts").update({ status: deciding, decision_note: orNull(note) }).eq("id", d!.id));
      setDeciding(null); setNote("");
      await qc.invalidateQueries({ queryKey: ["ai_drafts"] });
    } catch (e) { setError(e); }
  }

  return (
    <article className="draft">
      <p className="crumbs"><Link to="/intelligence">Drafts</Link> / {d.output?.working_title ?? (d.kind === "script" ? "Script draft" : "Brief draft")}</p>
      <header className="task-detail__header">
        <div>
          <h1>{o?.working_title ?? (d.kind === "script" ? "Script draft" : "Brief draft")}</h1>
          <div className="chips">
            <Chip code={d.status} label={DRAFT_STATUS_LABEL[d.status]!} />
            <span className="chip">{d.kind === "script" ? "Script" : "Creative brief"}</span>
            {d.language && <span className="chip">{d.language}</span>}
            {d.format && <span className="chip">{d.format}</span>}
            {task && <Link className="chip" to={`/workspace/tasks/${task.ref}`}>{task.title}</Link>}
            {opp && <Link className="chip" to={`/opportunities/${opp.ref}`}>{opp.title}</Link>}
          </div>
        </div>
      </header>
      <p className="small muted">Requested by {memberName(d.created_by)} · {formatDateTime(d.created_at)}{d.model && <> · model {d.model}</>}{d.completion_tokens != null && <> · {d.prompt_tokens}+{d.completion_tokens} tokens</>}</p>

      {(d.status === "queued" || d.status === "running") && <StatePanel title="Drafting…"><p>This usually takes under a minute. The page updates by itself.</p></StatePanel>}
      {d.status === "failed" && <StatePanel title="Drafting failed" tone="error"><p>{d.error}</p></StatePanel>}

      {o && (
        <>
          <div className="state state--warning">
            <strong>AI draft — needs human review.</strong> Check every medical, price, savings and process claim before use. Placeholders marked [REVIEW REQUIRED] must be filled with verified facts.
            {(o.review_flags?.length ?? 0) > 0 && <ul>{o.review_flags!.map((f) => <li key={f}>{f}</li>)}</ul>}
          </div>
          <div className="action-bar">
            <button type="button" className="button" onClick={async () => { await navigator.clipboard.writeText(draftToText(d)); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy as text"}</button>
            {task && d.status !== "discarded" && (
              <button type="button" className="button" disabled={comment.isPending}
                onClick={() => comment.mutate({ fn: "task_comment", args: { p_task: task.id, p_note: `AI draft attached for review:\n\n${draftToText(d)}`.slice(0, 15000) } })}>
                {comment.isSuccess ? "Added to task" : "Add to the task as a comment"}
              </button>
            )}
            {mine && d.status === "ready" && <>
              <button type="button" className="button button--primary" onClick={() => setDeciding("accepted")}>Mark as used</button>
              <button type="button" className="button button--quiet" onClick={() => setDeciding("discarded")}>Discard</button>
            </>}
            {d.decided_at && <span className="small muted">{DRAFT_STATUS_LABEL[d.status]} {formatDateTime(d.decided_at)}{d.decision_note && ` — ${d.decision_note}`}</span>}
          </div>
          <ErrorText error={comment.error ?? error} />
          <DraftView o={o} />
        </>
      )}

      <Modal title={deciding === "accepted" ? "Mark draft as used" : "Discard draft"} open={Boolean(deciding)} onClose={() => setDeciding(null)}>
        <div className="stack">
          <Field label={deciding === "accepted" ? "What did you change or keep? (optional)" : "Why is it not usable? (optional — helps improve the AI)"}>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <div className="form__actions"><button type="button" className="button" onClick={() => setDeciding(null)}>Back</button><button type="button" className="button button--primary" onClick={decide}>Confirm</button></div>
        </div>
      </Modal>
    </article>
  );
}

function DraftView({ o }: { o: DraftOutput }) {
  return (
    <div className="task-detail__grid">
      <section className="card">
        <dl className="details">
          <dt>Objective</dt><dd>{o.objective}</dd>
          <dt>Audience</dt><dd>{o.audience}</dd>
          <dt>Language</dt><dd>{o.language}</dd>
          <dt>Format</dt><dd>{o.format_and_duration}</dd>
          <dt>Core message</dt><dd><strong>{o.core_message}</strong></dd>
          <dt>CTA</dt><dd>{o.cta}</dd>
        </dl>
        <h3>Hook options</h3>
        <ol>{o.hook_options.map((h, i) => <li key={i}>{h}</li>)}</ol>
        <h3>Structure</h3>
        <ol className="beats">{o.structure.map((b, i) => <li key={i}><strong>{b.beat}</strong> — {b.content}</li>)}</ol>
        {o.script_text && <><h3>Script</h3><pre className="script">{o.script_text}</pre></>}
        {o.on_screen_text.length > 0 && <><h3>On-screen text</h3><ul>{o.on_screen_text.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
        <h3>Visual direction</h3><p className="prewrap">{o.visual_direction}</p>
      </section>
      <section className="card">
        <h2>Review before use</h2>
        <h3>Claims requiring review</h3>
        {o.claims_requiring_review.length ? <ul className="review-list">{o.claims_requiring_review.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="small muted">None listed — still read the copy for claims.</p>}
        <h3>Assumptions and gaps</h3>
        {o.assumptions_and_gaps.length ? <ul>{o.assumptions_and_gaps.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="small muted">None listed.</p>}
        <h3>Patterns used</h3>
        {o.pattern_references.length ? <ul className="small">{o.pattern_references.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="small muted">None cited.</p>}
        <h3>Evidence used</h3>
        {o.evidence_used.length ? <ul className="small">{o.evidence_used.map((u, i) => <li key={i}>{/^https?:\/\//.test(u) ? <a href={u} target="_blank" rel="noopener noreferrer nofollow">{u}</a> : u}</li>)}</ul> : <p className="small muted">No source signals cited.</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- knowledge base
const KIND_LABEL: Record<KnowledgeDoc["kind"], string> = { brand_guidelines: "Brand guidelines", script_pattern: "Script pattern", reference: "Reference" };

export function Knowledge() {
  const docs = useKnowledge();
  const { member: me } = useMember();
  const qc = useQueryClient();
  const isAdmin = me.role === "admin";
  const [open, setOpen] = useState<KnowledgeDoc | null>(null);
  const [editing, setEditing] = useState<Partial<KnowledgeDoc> | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<unknown>(null);

  if (docs.isPending) return <Loading />;
  if (docs.isError) return <StatePanel title="Could not load the knowledge base" tone="error"><p>{docs.error.message}</p></StatePanel>;
  const rows = docs.data.filter((d) => !q || `${d.title} ${d.content}`.toLowerCase().includes(q.toLowerCase()));

  async function save() {
    if (!editing) return;
    setError(null);
    try {
      const row = { kind: editing.kind ?? "reference", title: (editing.title ?? "").trim(), content: (editing.content ?? "").trim(), language: orNull(editing.language ?? ""), source_note: orNull(editing.source_note ?? ""), is_active: editing.is_active ?? true };
      if (!row.title || !row.content) throw new Error("Title and content are required");
      if (editing.id) await run(client().from("knowledge_documents").update(row).eq("id", editing.id));
      else await run(client().from("knowledge_documents").insert(row));
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["knowledge"] });
    } catch (e) { setError(e); }
  }

  return (
    <>
      <p className="muted">What the AI reads before drafting. Brand guidelines are always included; the most relevant script patterns and references are picked per request. Script patterns contain structure and tone only — no prices or claims.</p>
      <div className="filters">
        <input type="search" placeholder="Search knowledge" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search knowledge" />
        {isAdmin && <button type="button" className="button button--primary" onClick={() => setEditing({ kind: "reference", is_active: true })}>+ Add document</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Kind</th><th>Language</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.is_active ? undefined : "muted"}>
                <td className="wrap"><button type="button" className="link" onClick={() => setOpen(d)}>{d.title}</button></td>
                <td>{KIND_LABEL[d.kind]}</td>
                <td>{d.language ?? "—"}</td>
                <td>{d.is_active ? "In use" : "Switched off"}</td>
                <td>{isAdmin && <button type="button" className="link small" onClick={() => setEditing(d)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal title={open?.title ?? ""} open={Boolean(open)} onClose={() => setOpen(null)} wide>
        {open && <><p className="small muted">{KIND_LABEL[open.kind]}{open.source_note && ` · ${open.source_note}`}</p><pre className="script">{open.content}</pre></>}
      </Modal>
      <Modal title={editing?.id ? "Edit document" : "Add document"} open={Boolean(editing)} onClose={() => setEditing(null)} wide>
        {editing && (
          <div className="stack">
            <div className="grid-form">
              <Field label="Kind">
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as KnowledgeDoc["kind"] })}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Language"><input value={editing.language ?? ""} onChange={(e) => setEditing({ ...editing, language: e.target.value })} /></Field>
              <Field label="Title" wide><input value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
              <Field label="Source / provenance" wide><input value={editing.source_note ?? ""} onChange={(e) => setEditing({ ...editing, source_note: e.target.value })} /></Field>
              <Field label="Content" wide hint="Only add approved wording or verified facts here — the AI treats this as reference."><textarea rows={12} value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></Field>
              <label className="check field--wide"><input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> In use by the AI</label>
            </div>
            <ErrorText error={error} />
            <div className="form__actions"><button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="button button--primary" onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </>
  );
}
