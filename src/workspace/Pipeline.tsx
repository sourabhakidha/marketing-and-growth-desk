import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { type TaskWithStage, useLookups, useTasks } from "../lib/api.ts";
import { formatDate, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { PriorityMark, StatusBadge } from "../components/Badges.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useTaskFilters, useTaskPanel } from "./filters.ts";
import { buildPipeline, checkDrop, columnOf, currentStage, DONE_COLUMN, NO_STAGE_COLUMN, nextStage, nextStepOwner, type PipelineColumn } from "./pipeline.ts";

const COLUMN_LABEL: Record<string, string> = { [DONE_COLUMN]: "Done (approved)", [NO_STAGE_COLUMN]: "No workflow" };

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/** Workflow stages as a connected journey; cards sit under the stage they are in. */
export function Pipeline() {
  const tasks = useTasks();
  const { label, memberName, options, ready } = useLookups();
  const { member: me } = useMember();
  const { f } = useTaskFilters();
  const panel = useTaskPanel();
  const today = todayInIndia();
  const isAdmin = me.role === "admin";
  const [hideEmpty, setHideEmpty] = useState(false);
  const [dragging, setDragging] = useState<TaskWithStage | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastOver = useRef<string | null>(null);
  const dropped = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const visible = useMemo(() => (tasks.data ?? []).filter((t) => matchesFilters(t, f, { meId: me.id, today })), [tasks.data, f, me.id, today]);
  const stageCodes = useMemo(() => options("workflow_stage").map((o) => o.code), [options]);
  const columns = useMemo(() => buildPipeline(visible, stageCodes), [visible, stageCodes]);

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;
  if ((tasks.data ?? []).length === 0) {
    return <StatePanel title="No tasks yet"><p>Use <strong>New activity</strong> to create the first task. Its workflow stages appear here as it moves.</p></StatePanel>;
  }

  const stageLabel = (c: string) => COLUMN_LABEL[c] ?? label("workflow_stage", c);
  const selected = panel.ref ? (tasks.data ?? []).find((t) => t.ref === panel.ref) : undefined;
  const currentCol = selected ? columnOf(selected) : null;
  const open = visible.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const waitingTotal = columns.reduce((n, c) => n + c.waiting, 0);
  const blockedTotal = columns.reduce((n, c) => n + c.blocked, 0);
  const reviewTotal = columns.reduce((n, c) => n + c.inReview, 0);
  const overdue = open.filter((t) => isOverdue(t.due_date, t.status, today)).length;
  const mine = open.filter((t) => nextStepOwner(t) === me.id).length;
  const bottleneck = [...columns].filter((c) => c.code !== DONE_COLUMN).sort((a, b) => (b.waiting + 2 * b.blocked) - (a.waiting + 2 * a.blocked) || b.tasks.length - a.tasks.length)[0];
  const shown = hideEmpty ? columns.filter((c) => c.tasks.length > 0 || c.code === currentCol) : columns;
  const lastIndex = Math.max(shown.length - 1, 1);

  /** Refused drops never fire a drop event (dropEffect "none"), so explain on drag end instead. */
  function endDrag(t: TaskWithStage) {
    const over = lastOver.current;
    if (!dropped.current && over && over !== columnOf(t)) {
      const verdict = checkDrop(t, over, { id: me.id, isAdmin }, stageLabel);
      if (!verdict.ok) setNotice(`${taskRef(t.ref)}: ${verdict.reason}`);
    }
    lastOver.current = null;
    dropped.current = false;
    setDragging(null);
    setOverCol(null);
  }

  function onDrop(col: PipelineColumn) {
    const t = dragging;
    dropped.current = true;
    setDragging(null);
    setOverCol(null);
    if (!t) return;
    const verdict = checkDrop(t, col.code, { id: me.id, isAdmin }, stageLabel);
    if (verdict.ok) panel.open(t.ref, "hand_off");
    else setNotice(`${taskRef(t.ref)}: ${verdict.reason}`);
  }

  return (
    <div className="pipeline">
      <div className="pipeline__summary" aria-label="Pipeline summary">
        <span className="stat"><strong>{open.length}</strong> open</span>
        <span className="stat stat--you"><strong>{mine}</strong> next step yours</span>
        <span className="stat stat--wait"><strong>{waitingTotal}</strong> waiting for pick-up</span>
        <span className="stat stat--review"><strong>{reviewTotal}</strong> awaiting approval</span>
        <span className="stat stat--blocked"><strong>{blockedTotal}</strong> blocked</span>
        <span className="stat stat--late"><strong>{overdue}</strong> overdue</span>
        {bottleneck && bottleneck.waiting + bottleneck.blocked > 0 && (
          <span className="stat stat--hint">Most held up: <strong>{stageLabel(bottleneck.code)}</strong></span>
        )}
        <label className="check pipeline__toggle"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty stages</label>
      </div>

      <p className="muted small pipeline__help">
        Drag a card onto <strong>its next stage</strong> to hand it off — you'll confirm the next owner first. Everything else (skip, return for rework, block, submit, approve) is in the task panel. Status and stage are separate: a blocked task stays in its stage.
      </p>

      <div className="pipeline__track" role="list" aria-label="Workflow stages">
        {shown.map((col, i) => {
          const verdict = dragging ? checkDrop(dragging, col.code, { id: me.id, isAdmin }, stageLabel) : null;
          const empty = col.tasks.length === 0;
          const isCurrent = col.code === currentCol;
          const myHere = col.tasks.filter((t) => nextStepOwner(t) === me.id).length;
          const cls = ["pl-col", empty ? "pl-col--empty" : "", isCurrent ? "is-current" : "", col.code === DONE_COLUMN ? "pl-col--done" : "",
            verdict?.ok ? "is-drop-ok" : "", dragging && verdict && !verdict.ok ? "is-drop-no" : "", overCol === col.code ? "is-over" : ""].filter(Boolean).join(" ");
          return (
            <section key={col.code} role="listitem" className={cls} style={{ "--t": String(i / lastIndex) } as React.CSSProperties}
              aria-label={`${stageLabel(col.code)}: ${col.tasks.length} task${col.tasks.length === 1 ? "" : "s"}`}
              onDragOver={(e: DragEvent) => { if (verdict?.ok) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } else if (dragging) { e.dataTransfer.dropEffect = "none"; } if (leaveTimer.current) clearTimeout(leaveTimer.current); lastOver.current = col.code; setOverCol(col.code); }}
              onDragLeave={() => {
                // Browsers fire dragleave right before ending a refused drop; clear a moment later so a real release still counts.
                if (leaveTimer.current) clearTimeout(leaveTimer.current);
                leaveTimer.current = setTimeout(() => { if (lastOver.current === col.code) lastOver.current = null; }, 120);
                setOverCol((c) => (c === col.code ? null : c));
              }}
              onDrop={(e) => { e.preventDefault(); onDrop(col); }}>
              <header className="pl-node">
                <span className="pl-node__dot" aria-hidden="true">{col.code === DONE_COLUMN ? "✓" : String(i + 1).padStart(2, "0")}</span>
                <div className="pl-node__text">
                  <h3>{stageLabel(col.code)}</h3>
                  <p>
                    <span className="pl-node__count">{col.tasks.length}</span> {col.tasks.length === 1 ? "task" : "tasks"}
                    {col.waiting > 0 && <> · {col.waiting} waiting</>}
                    {col.blocked > 0 && <> · <span className="pl-node__blocked">{col.blocked} blocked</span></>}
                    {col.inReview > 0 && <> · {col.inReview} in review</>}
                  </p>
                  {myHere > 0 && <span className="pl-node__you">{myHere} yours</span>}
                </div>
              </header>
              <div className="pl-col__cards">
                {verdict?.ok && <div className="pl-drop-hint">Drop to hand off to {stageLabel(col.code)}</div>}
                {empty && !verdict?.ok && <p className="pl-col__empty">No work here</p>}
                {col.tasks.map((t) => (
                  <PipelineCard key={t.id} t={t} today={today} label={label} memberName={memberName} selected={t.ref === panel.ref}
                    draggable={canDrag(t, me.id, isAdmin)}
                    onOpen={() => panel.open(t.ref)}
                    onDragStart={() => { lastOver.current = null; dropped.current = false; setDragging(t); }} onDragEnd={() => endDrag(t)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="toast-region" role="status" aria-live="polite">
        {notice && <div className="toast toast--warn"><span>{notice}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}
      </div>
    </div>
  );
}

/** Draggable only when a hand-off is actually possible for this user. */
function canDrag(t: TaskWithStage, meId: string, isAdmin: boolean) {
  const cur = currentStage(t);
  if (!cur || !nextStage(t)) return false;
  if (["done", "cancelled", "blocked", "in_review"].includes(t.status)) return false;
  return isAdmin || t.owner_id === meId || cur.owner_id === meId;
}

function PipelineCard({ t, today, label, memberName, selected, draggable, onOpen, onDragStart, onDragEnd }: {
  t: TaskWithStage; today: string; selected: boolean; draggable: boolean;
  label: (v: string, c: string | null | undefined) => string; memberName: (id: string | null | undefined) => string;
  onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const stage = currentStage(t);
  const overdue = isOverdue(t.due_date, t.status, today);
  const nextOwner = nextStepOwner(t);
  const waiting = stage && stage.owner_id && !stage.picked_up_at && t.status !== "blocked";
  const who = nextOwner ? memberName(nextOwner) : t.status === "in_review" ? "Admin approval" : memberName(t.owner_id);
  return (
    <button type="button" className={`pl-card pl-card--${t.status}${selected ? " is-selected" : ""}`} onClick={onOpen}
      draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(t.ref)); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd} aria-label={`${taskRef(t.ref)} ${t.title}. ${label("task_status", t.status)}. Next step: ${who}.`}>
      <span className="pl-card__top">
        <span className="ref">{taskRef(t.ref)}</span>
        <PriorityMark code={t.priority} label={label("priority", t.priority)} />
      </span>
      <span className="pl-card__title">{t.title}</span>
      <span className="pl-card__type">{label("task_type", t.task_type)}</span>
      {t.status === "blocked" && <span className="pl-card__blocker">Blocked: {t.blocker_reason ?? "reason not recorded"}</span>}
      <span className="pl-card__tags">
        <StatusBadge code={t.status} label={label("task_status", t.status)} />
        {waiting && <span className="tag tag--wait">waiting pick-up</span>}
        {stage && stage.revision_count > 0 && <span className="tag tag--warn">rework ×{stage.revision_count}</span>}
      </span>
      <span className="pl-card__foot">
        <span className="who"><span className="avatar" aria-hidden="true">{initials(who)}</span>{who}</span>
        <span className={overdue ? "due due--late" : "due"}>{t.due_date ? `${overdue ? "Overdue · " : ""}${formatDate(t.due_date)}` : "No due date"}</span>
      </span>
    </button>
  );
}
