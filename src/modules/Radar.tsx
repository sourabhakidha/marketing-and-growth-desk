import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  callApi, client, type RadarSignal, type RadarSource, run, useHealth, useLatestScan, useLookups, useRadarSources, useSignals,
} from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { signalTable } from "../lib/exportRows.ts";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import { EVIDENCE_LABEL, SIGNAL_STATUS_LABEL, SOURCE_KIND_LABEL, SOURCE_STATUS_LABEL, TOPIC_LABEL } from "../lib/labels.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { Chip } from "../components/Tone.tsx";
import { ErrorText, Field, orNull } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";

const SIGNAL_DATE_BASES = [
  { value: "collected_at", label: "Collected in period" },
  { value: "published_at", label: "Published in period" },
];

export function Radar() {
  const dates = useDateRange({ bases: SIGNAL_DATE_BASES, defaultPreset: "last_30" });
  const signals = useSignals(400, dates.range, dates.basis as "collected_at" | "published_at");
  const sources = useRadarSources();
  const scan = useLatestScan();
  const health = useHealth();
  const { memberName } = useLookups();
  const { member: me } = useMember();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = me.role === "admin";
  const { isMe } = useScope();

  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("");
  const [evidence, setEvidence] = useState("");
  const [topic, setTopic] = useState("");
  const [q, setQ] = useState("");
  const [scanError, setScanError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [noting, setNoting] = useState<RadarSignal | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["radar_signals"] }),
    qc.invalidateQueries({ queryKey: ["radar_sources"] }),
    qc.invalidateQueries({ queryKey: ["radar_scan_latest"] }),
  ]);
  const running = scan.data?.status === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void refresh();
    wasRunning.current = running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startScan() {
    setStarting(true);
    setScanError(null);
    try {
      const scanId = await run<string>(client().rpc("radar_start_scan"));
      const res = await callApi("/api/radar-scan", { scanId });
      if (!res.ok && res.status !== 202) throw new Error(`The scan could not start (${res.status})`);
      await qc.invalidateQueries({ queryKey: ["radar_scan_latest"] });
    } catch (e) {
      setScanError(e);
    } finally {
      setStarting(false);
    }
  }

  async function setSignalStatus(s: RadarSignal, next: RadarSignal["status"]) {
    setActionError(null);
    try {
      await run(client().from("radar_signals").update({ status: next }).eq("id", s.id));
      await qc.invalidateQueries({ queryKey: ["radar_signals"] });
    } catch (e) { setActionError(e); }
  }

  const rows = (signals.data ?? []).filter((s) => {
    if (isMe && s.collected_by !== me.id) return false;
    if (status === "open" ? !["new", "reviewed", "saved"].includes(s.status) : status && s.status !== status) return false;
    if (kind && s.source_type !== kind) return false;
    if (evidence && s.evidence_class !== evidence) return false;
    if (topic && !s.topic_tags.includes(topic)) return false;
    if (q) {
      const t = q.toLowerCase();
      if (!`${s.title} ${s.excerpt ?? ""} ${s.publisher ?? ""}`.toLowerCase().includes(t)) return false;
    }
    return true;
  });

  const srcs = sources.data ?? [];
  const failed = srcs.filter((s) => s.is_active && s.last_status === "failed");
  const notConfigured = srcs.filter((s) => s.is_active && s.last_status === "not_configured");

  return (
    <>
      <header className="page-header page-header--row">
        <div>
          <h1>Content Radar</h1>
          <p className="muted">Source-linked signals from news, official sources and public conversations. Signals are context, not proof — public posts are anecdotes.</p>
        </div>
        <div className="row-actions">
          <button type="button" className="button" onClick={() => setAdding(true)}>+ Add a link</button>
          <button type="button" className="button button--primary" disabled={starting || running} onClick={startScan}>
            {running ? "Scanning…" : starting ? "Starting…" : "Scan now"}
          </button>
        </div>
      </header>

      <section className="scan-status" aria-live="polite">
        {scan.data ? (
          <p className="small">
            Last scan {running ? "started" : "finished"} {formatDateTime(scan.data.finished_at ?? scan.data.started_at)} by {memberName(scan.data.started_by)} ·{" "}
            <Chip code={scan.data.status === "running" ? "running" : scan.data.status === "partial" ? "needs_research" : scan.data.status} label={scan.data.status === "partial" ? "Partial — some sources failed" : scan.data.status === "running" ? "Running" : scan.data.status === "ok" ? "Completed" : "Failed"} />
            {scan.data.inserted != null && <> · {scan.data.inserted} new, {scan.data.duplicates ?? 0} already seen</>}
          </p>
        ) : <p className="small muted">No scan has been run yet. Click Scan now to collect from the {srcs.filter((s) => s.is_active).length} active sources.</p>}
        {(failed.length > 0 || notConfigured.length > 0) && (
          <p className="small">
            {failed.length > 0 && <span className="due--late">{failed.length} source{failed.length > 1 ? "s" : ""} failed on the last scan. </span>}
            {notConfigured.length > 0 && <span>{notConfigured.length} not configured{health.data?.integrations.reddit === "not_configured" ? " (Reddit credentials missing in Netlify)" : ""}. </span>}
            <button type="button" className="link small" onClick={() => setManaging(true)}>See sources</button>
          </p>
        )}
        {!failed.length && !notConfigured.length && <button type="button" className="link small" onClick={() => setManaging(true)}>{isAdmin ? "Manage sources" : "View sources"}</button>}
        <ErrorText error={scanError} />
      </section>

      <div className="filters" role="search">
        <input type="search" placeholder="Search signals" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search signals" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="open">Open (new, reviewed, saved)</option>
          <option value="">All statuses</option>
          {Object.entries(SIGNAL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Source type">
          <option value="">All source types</option>
          {Object.entries(SOURCE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label="Evidence class">
          <option value="">Any evidence class</option>
          {Object.entries(EVIDENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
          <option value="">Any topic</option>
          {Object.entries(TOPIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <DateRangePicker {...dates} />
        <span className="filters__end">
          <ExportCsvButton name="radar-signals" range={dates.range} disabled={signals.isPending} build={() => signalTable(rows)} />
        </span>
      </div>
      <ErrorText error={actionError} />

      {signals.isPending ? <Loading /> : signals.isError ? (
        <StatePanel title="Could not load signals" tone="error"><p>{signals.error.message}</p></StatePanel>
      ) : rows.length === 0 ? (
        <StatePanel title={(signals.data ?? []).length ? "No signals match these filters" : "No signals collected yet"}>
          <p>{(signals.data ?? []).length ? "Try widening the filters." : "Run a scan or add a link you found."}</p>
        </StatePanel>
      ) : (
        <ul className="signal-list">
          {rows.map((s) => (
            <li key={s.id} className={`signal signal--${s.status}`}>
              <div className="signal__main">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="signal__title">{s.title}</a>
                <p className="signal__meta">
                  {s.publisher ?? s.source_name} · published {s.published_at ? formatDateTime(s.published_at) : <em>date unknown</em>} · collected {formatDateTime(s.collected_at)}
                  {s.source_type === "manual" && <> · added by {memberName(s.collected_by)}</>}
                </p>
                {s.excerpt && <p className="signal__excerpt">{s.excerpt}</p>}
                <div className="chips">
                  <span className="chip">{EVIDENCE_LABEL[s.evidence_class] ?? s.evidence_class}</span>
                  <span className="chip">{SOURCE_KIND_LABEL[s.source_type]}</span>
                  {s.region !== "unknown" && <span className="chip">{s.region}</span>}
                  {s.topic_tags.map((t) => <span key={t} className="chip chip--topic">{TOPIC_LABEL[t] ?? t}</span>)}
                </div>
                {s.notes && <p className="signal__note">Note: {s.notes}</p>}
              </div>
              <div className="signal__side">
                <Chip code={s.status} label={SIGNAL_STATUS_LABEL[s.status] ?? s.status} />
                <div className="signal__actions">
                  {s.status !== "converted" && <button type="button" className="button button--small button--primary" onClick={() => navigate(`/opportunities/new?signal=${s.id}`)}>Create opportunity</button>}
                  {s.status !== "saved" && s.status !== "converted" && <button type="button" className="button button--small" onClick={() => setSignalStatus(s, "saved")}>Save</button>}
                  {s.status === "new" && <button type="button" className="button button--small" onClick={() => setSignalStatus(s, "reviewed")}>Reviewed</button>}
                  {s.status !== "dismissed" && s.status !== "converted" && <button type="button" className="button button--small button--quiet" onClick={() => setSignalStatus(s, "dismissed")}>Dismiss</button>}
                  {s.status === "dismissed" && <button type="button" className="button button--small" onClick={() => setSignalStatus(s, "new")}>Restore</button>}
                  <button type="button" className="link small" onClick={() => setNoting(s)}>{s.notes ? "Edit note" : "Add note"}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && <AddSignal onClose={() => setAdding(false)} onSaved={refresh} />}
      {managing && <Sources sources={srcs} isAdmin={isAdmin} onClose={() => setManaging(false)} onSaved={refresh} />}
      {noting && <NoteDialog signal={noting} onClose={() => setNoting(null)} onSaved={refresh} />}
    </>
  );
}

function AddSignal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [published, setPublished] = useState("");
  const [evidence, setEvidence] = useState("unknown");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let normalized: string;
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      u.hash = "";
      normalized = u.toString();
    } catch {
      setError(new Error("Enter a full link starting with https://"));
      return;
    }
    if (!title.trim()) { setError(new Error("Give the signal a title")); return; }
    setBusy(true);
    try {
      await run(client().from("radar_signals").insert({
        source_type: "manual", source_name: "Added by team", url: normalized, fingerprint: `manual:${normalized.toLowerCase()}`,
        title: title.trim(), publisher: orNull(publisher), published_at: published ? `${published}T00:00:00+05:30` : null,
        evidence_class: evidence, notes: orNull(notes), status: "saved",
      }));
      onSaved();
      onClose();
    } catch (e) {
      setError(/duplicate key/.test(String((e as Error).message)) ? new Error("This link is already on the Radar.") : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a link to the Radar" open onClose={onClose}>
      <div className="stack">
        <Field label="Link" required><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus /></Field>
        <Field label="Title" required><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Publisher / where it appeared"><input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></Field>
        <Field label="Published on" hint="Leave blank if you don't know — it will show as unknown"><input type="date" value={published} onChange={(e) => setPublished(e.target.value)} /></Field>
        <Field label="Evidence class">
          <select value={evidence} onChange={(e) => setEvidence(e.target.value)}>
            {Object.entries(EVIDENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Why it matters (optional)"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button button--primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Add to Radar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function NoteDialog({ signal, onClose, onSaved }: { signal: RadarSignal; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(signal.notes ?? "");
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal title="Note on signal" open onClose={onClose}>
      <div className="stack">
        <p className="small muted">{signal.title}</p>
        <Field label="Note"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus /></Field>
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button type="button" className="button button--primary" onClick={async () => {
            try { await run(client().from("radar_signals").update({ notes: orNull(notes) }).eq("id", signal.id)); onSaved(); onClose(); }
            catch (e) { setError(e); }
          }}>Save note</button>
        </div>
      </div>
    </Modal>
  );
}

function Sources({ sources, isAdmin, onClose, onSaved }: { sources: RadarSource[]; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [kind, setKind] = useState<RadarSource["kind"]>("news_search");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState("news_reporting");

  async function toggle(s: RadarSource) {
    try { await run(client().from("radar_sources").update({ is_active: !s.is_active }).eq("id", s.id)); onSaved(); }
    catch (e) { setError(e); }
  }
  async function add() {
    setError(null);
    if (!name.trim() || !value.trim()) { setError(new Error("Name and query / feed / subreddit are required")); return; }
    const config = kind === "news_search" ? { query: value.trim(), region: "IN" }
      : kind === "rss" ? { feed_url: value.trim() } : { subreddit: value.trim().replace(/^r\//, ""), query: query.trim() || undefined };
    if (kind === "rss" && !/^https?:\/\//.test(value.trim())) { setError(new Error("Feed URL must start with https://")); return; }
    try {
      await run(client().from("radar_sources").insert({ kind, name: name.trim(), config, evidence_class: kind === "reddit" ? "anecdote" : evidence }));
      setName(""); setValue(""); setQuery("");
      onSaved();
    } catch (e) { setError(e); }
  }

  return (
    <Modal title="Radar sources" open onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">News searches use the Google News India edition. Reddit needs app credentials in Netlify. A failed or unconfigured source is shown as such — never as an empty result.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Type</th><th>Query / feed</th><th>Last scan</th><th>Status</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className={s.is_active ? undefined : "muted"}>
                  <td className="wrap">{s.name}</td>
                  <td>{SOURCE_KIND_LABEL[s.kind]}</td>
                  <td className="wrap small">{s.config.query ?? s.config.feed_url ?? (s.config.subreddit ? `r/${s.config.subreddit}${s.config.query ? ` · ${s.config.query}` : ""}` : "")}</td>
                  <td className="small">{s.last_scan_at ? formatDateTime(s.last_scan_at) : "—"}{s.last_item_count != null && <><br />{s.last_item_count} items</>}</td>
                  <td className="wrap"><Chip code={s.last_status} label={SOURCE_STATUS_LABEL[s.last_status] ?? s.last_status} />{s.last_error && <div className="small muted">{s.last_error}</div>}</td>
                  {isAdmin && <td><button type="button" className="link small" onClick={() => toggle(s)}>{s.is_active ? "Switch off" : "Switch on"}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <fieldset className="card stack">
            <legend className="field__label">Add a source</legend>
            <div className="grid-form">
              <Field label="Type">
                <select value={kind} onChange={(e) => setKind(e.target.value as RadarSource["kind"])}>
                  <option value="news_search">News search (Google News India)</option>
                  <option value="rss">RSS / Atom feed</option>
                  <option value="reddit">Reddit subreddit</option>
                </select>
              </Field>
              <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. News: thyroid medicines" /></Field>
              <Field label={kind === "news_search" ? "Search query" : kind === "rss" ? "Feed URL" : "Subreddit"} wide>
                <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "news_search" ? "thyroid medicine India" : kind === "rss" ? "https://…/rss" : "india"} />
              </Field>
              {kind === "reddit" && <Field label="Search within subreddit (optional)" wide><input value={query} onChange={(e) => setQuery(e.target.value)} /></Field>}
              {kind !== "reddit" && (
                <Field label="Default evidence class" hint="Results from .gov.in / .nic.in domains are always marked Official">
                  <select value={evidence} onChange={(e) => setEvidence(e.target.value)}>
                    {Object.entries(EVIDENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="form__actions"><button type="button" className="button button--primary" onClick={add}>Add source</button></div>
          </fieldset>
        )}
        <ErrorText error={error} />
        <p className="small muted">Opportunities created from signals appear in <Link to="/opportunities">Content Opportunities</Link>.</p>
      </div>
    </Modal>
  );
}
