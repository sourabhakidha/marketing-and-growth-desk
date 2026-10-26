import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { type TaskEvent, type TaskStage, useBinAction, useDrafts, useGoals, useLookups, useOpportunities, useTask, useUpdateTask, useWorkflowAction, type WorkflowAction, useTasks } from "../lib/api.ts";
import { DRAFT_STATUS_LABEL } from "../lib/labels.ts";
import { Chip } from "../components/Tone.tsx";
import {formatDate, formatDateTime, formatDuration, isOverdue, minutesBetween} from "../lib/format.ts";
import { availableActions, heldByAdmin, REVIEW_STAGES } from "../lib/permissions.ts";
import { TaskImpactPanel } from "../modules/ImpactParts.tsx";
import { DeliverableJourney, PartOfStrip } from "./Deliverables.tsx";
import { missingImpact } from "../lib/impact.ts";
import { partsOf } from "../lib/deliverables.ts";
import { MoveToBinDialog, PurgeDialog } from "../components/DeleteDialog.tsx";
import { useMember } from "../lib/session.tsx";
import { PriorityMark, StatusBadge } from "../components/Badges.tsx";
import { ErrorText, Field } from "../components/Form.tsx";
import { Modal } from "../components/Modal.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { TaskForm, taskToValues, valuesToTask } from "./TaskForm.tsx";

type PanelTab = "overview" | "workflow" | "impact" | "history";
const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "workflow", label: "Workflow" },
  { key: "impact", label: "Impact & AI" }, { key: "history", label: "History" },
];

type Dialog =
  | null | "edit" | "hand_off" | "return" | "block" | "unblock" | "submit" | "approve" | "request_changes" | "cancel" | "reopen"
  | "accept" | "decline" | "delete" | "purge";

export function TaskDetail() {
  const ref = Number(useParams().ref);
  return <TaskPanel taskNumber={ref} variant="page" />;
}

/**
 * One task: brief, deliverables, people, workflow, history and every action.
 * Used as a full page and inside the Workspace side panel; both call the same
 * database actions, which enforce the workflow and permissions.
 */
export function TaskPanel({ taskNumber: ref, variant, initialAction, onActionConsumed, onClose }: {
  taskNumber: number;
  variant: "page" | "drawer";
  initialAction?: string | null;
  onActionConsumed?: () => void;
  onClose?: () => void;
}) {
  const q = useTask(ref);
  const goals = useGoals();
  const opps = useOpportunities();
  const drafts = useDrafts();
  const { member: me } = useMember();
  const { label, memberName, members, isAdminMember, ready } = useLookups();
  const action = useWorkflowAction();
  const allTasks = useTasks();
  const bin = useBinAction();
  const navigate = useNavigate();
  const update = useUpdateTask();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [note, setNote] = useState("");
  const [nextOwner, setNextOwner] = useState("");
  const [withParts, setWithParts] = useState(true);
  const [returnTo, setReturnTo] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!initialAction || !q.data) return;
    const st = q.data.stages;
    const cur = st.find((s) => s.state === "active") ?? null;
    const nxt = cur ? st.find((s) => s.state === "pending" && s.position > cur.position) : undefined;
    if (initialAction === "hand_off" && nxt) {
      action.reset();
      setNote("");
      setNextOwner(q.data.task.owner_id);
      setDialog("hand_off");
    }
    onActionConsumed?.();
  }, [initialAction, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!Number.isFinite(ref)) return <StatePanel title="Task not found" />;
  if (q.isPending || !ready) return <Loading />;
  if (q.isError) return <StatePanel title="Could not load task" tone="error"><p>{q.error.message}</p></StatePanel>;
  if (!q.data) return <StatePanel title="Task not found"><p><Link to="/workspace">Back to the Workspace</Link></p></StatePanel>;

  const { task, stages, events } = q.data;
  const isAdmin = me.role === "admin";
  const current = stages.find((s) => s.state === "active") ?? null;
  const next = current ? stages.find((s) => s.state === "pending" && s.position > current.position) : undefined;
  const earlierDone = stages.filter((s) => s.state === "done" && (!current || s.position < current.position));
  const ctx = {
    removed: Boolean(task.removed_at), neverAccepted: stages.length > 0 && stages.every((s) => !s.entered_at),
    meId: me.id, isAdmin, status: task.status, ownerId: task.owner_id, createdBy: task.created_by,
    activeStage: current ? { ownerId: current.owner_id, pickedUp: Boolean(current.picked_up_at), ownerIsAdmin: isAdminMember(current.owner_id) } : null,
    hasNextStage: Boolean(next), hasEarlierDoneStage: earlierDone.length > 0,
  };
  const acts = availableActions(ctx);
  const waitingOnAdmin = heldByAdmin(ctx);
  // an admin holding a review stage approves it by handing on, or asks for a revision by returning it
  const adminReview = isAdmin && Boolean(current && REVIEW_STAGES.has(current.stage_code) && isAdminMember(current.owner_id));
  const parent = task.parent_id ? (allTasks.data ?? []).find((t) => t.id === task.parent_id) : undefined;
  const goal = goals.data?.find((g) => g.id === (task.goal_id ?? parent?.goal_id));
  const isDeliverable = task.kind === "deliverable";
  const openParts = isDeliverable ? partsOf(task.id, allTasks.data ?? []).filter((p) => p.status !== "done" && p.status !== "cancelled").length : 0;
  const opp = opps.data?.find((o) => o.id === task.opportunity_id);
  const taskDrafts = (drafts.data ?? []).filter((d) => d.task_id === task.id);
  const activeMembers = (members.data ?? []).filter((m) => m.is_active);
  const lastBlock = task.status === "blocked" ? events.find((e) => e.event_type === "blocked" || (e.event_type === "status_changed" && e.to_value === "blocked")) : undefined;
  const drawer = variant === "drawer";

  function open(d: Dialog) {
    action.reset();
    setNote("");
    setNextOwner(task.owner_id);
    setReturnTo(earlierDone[earlierDone.length - 1]?.id ?? "");
    setDialog(d);
  }
  const run = (a: WorkflowAction) => action.mutate(a, { onSuccess: () => { setDialog(null); setNote(""); setComment(""); } });
  // accepting a workflow deliverable request also accepts the task requests planned with it (each keeps its owner)
  const requestedParts = isDeliverable ? partsOf(task.id, allTasks.data ?? []).filter((p) => p.status === "requested") : [];
  async function acceptRequest() {
    try {
      await action.mutateAsync({ fn: "task_review_request", args: { p_task: task.id, p_accept: true, p_note: note || null, p_owner: nextOwner || null } });
      if (withParts) for (const p of requestedParts) await action.mutateAsync({ fn: "task_review_request", args: { p_task: p.id, p_accept: true, p_note: null, p_owner: null } });
      setDialog(null); setNote("");
    } catch { /* shown by the dialog from action.error */ }
  }
  const id = task.id;

  return (
    <article className={`task-detail${drawer ? " task-detail--drawer" : ""}`}>
      {drawer ? (
        <div className="drawer__top">
          <Link className="link small" to={`/workspace/tasks/${task.ref}`}>Open full page</Link>
          {onClose && <button type="button" className="icon-button" aria-label="Close task panel" onClick={onClose}>×</button>}
        </div>
      ) : <p className="crumbs"><Link to="/workspace">Workspace</Link> / {task.kind === "deliverable" ? "Deliverable" : "Task"}</p>}
      <header className="task-detail__header">
        <div>
          {drawer ? <h2 className="drawer__title">{task.title}</h2> : <h1>{task.title}</h1>}
          <div className="chips">
            <StatusBadge code={task.status} label={label("task_status", task.status)} />
            {current && <span className="chip">Stage: {label("workflow_stage", current.stage_code)}</span>}
            <span className="chip">{label("task_type", task.task_type)}</span>
            <span className="chip">{label("work_origin", task.work_origin)}</span>
            <PriorityMark code={task.priority} label={label("priority", task.priority)} />
          </div>
        </div>
        <div className="row-actions">
          {task.status !== "done" && task.status !== "cancelled" && <Link className="button" to={`/intelligence?task=${task.ref}`}>Draft with AI</Link>}
          {acts.has("edit") && <button type="button" className="button" onClick={() => { update.reset(); setDialog("edit"); }}>Edit details</button>}
        </div>
      </header>

      {task.status === "blocked" && (
        <div className="state state--error">
          <strong>Blocked:</strong> {task.blocker_reason ?? "No reason recorded."}
          {lastBlock && <span className="small muted"> — raised by {lastBlock.actor_id ? memberName(lastBlock.actor_id) : "System"}, {formatDateTime(lastBlock.occurred_at)}</span>}
        </div>
      )}
      {task.status === "in_review" && (
        <div className="state state--warning">{isAdmin ? "Waiting for your approval." : "Submitted — waiting for Sourabh or Tanvi to approve."}</div>
      )}
      {task.removed_at && (
        <div className="state state--error">
          <strong>In the Recycle Bin.</strong> Deleted {formatDateTime(task.removed_at)} by {memberName(task.removed_by)}{task.removed_reason ? ` — ${task.removed_reason}` : ""}.
          {isAdmin && (
            <div className="row-actions bin-actions">
              <button type="button" className="button button--small" disabled={bin.isPending}
                onClick={() => bin.mutate({ fn: "task_restore", args: { p_task: id } })}>Restore</button>
              <button type="button" className="button button--small button--quiet button--danger-text" onClick={() => { bin.reset(); setDialog("purge"); }}>Delete permanently</button>
            </div>
          )}
        </div>
      )}
      {task.status === "requested" && (
        <div className="state state--warning">
          {isAdmin
            ? <>Task request from {memberName(task.created_by)}. Review it, complete the expected business impact if needed, then accept or decline.</>
            : <>Requested — waiting for Sourabh or Tanvi to accept it. You can still edit the details or withdraw the request.</>}
        </div>
      )}
      {waitingOnAdmin && current && (
        <div className="state state--warning">
          With {memberName(current.owner_id)} for {label("workflow_stage", current.stage_code)}. It stays here until an admin approves it
          (hands it on) or sends it back for revision.
        </div>
      )}

      <div className="action-bar" aria-label="Workflow actions">
        {acts.has("accept_request") && <button type="button" className="button button--primary" onClick={() => open("accept")}>Accept request</button>}
        {acts.has("decline_request") && <button type="button" className="button" onClick={() => open("decline")}>Decline</button>}
        {acts.has("pick_up") && (
          <button type="button" className="button button--primary" disabled={action.isPending}
            onClick={() => run({ fn: "task_pick_up", args: { p_task: id } })}>Pick up {current ? label("workflow_stage", current.stage_code) : ""}</button>
        )}
        {acts.has("hand_off") && next && <button type="button" className="button button--primary" onClick={() => open("hand_off")}>{adminReview ? "Approve → " : "Hand off to "}{label("workflow_stage", next.stage_code)}</button>}
        {acts.has("submit") && <button type="button" className={`button${acts.has("hand_off") ? "" : " button--primary"}`} onClick={() => open("submit")}>Submit for approval</button>}
        {acts.has("approve") && (task.parent_id
          ? <button type="button" className="button button--primary" disabled={action.isPending}
              onClick={() => run({ fn: "task_decide", args: { p_task: id, p_approve: true, p_feedback: null } })}>Sign off</button>
          : <button type="button" className="button button--primary" disabled={openParts > 0} title={openParts > 0 ? `${openParts} task(s) still open` : undefined}
              onClick={() => open("approve")}>{isDeliverable ? "Approve deliverable" : "Approve completion"}</button>)}
        {acts.has("approve") && openParts > 0 && <span className="small muted">{openParts} of its tasks {openParts === 1 ? "is" : "are"} still open — finish or cancel them before approving.</span>}
        {acts.has("request_changes") && <button type="button" className="button" onClick={() => open("request_changes")}>Request changes</button>}
        {acts.has("return_for_rework") && <button type="button" className="button" onClick={() => open("return")}>{adminReview ? "Request revision" : "Return for rework"}</button>}
        {acts.has("block") && <button type="button" className="button" onClick={() => open("block")}>Mark blocked</button>}
        {acts.has("unblock") && <button type="button" className="button button--primary" onClick={() => open("unblock")}>Unblock</button>}
        {acts.has("reopen") && <button type="button" className="button" onClick={() => open("reopen")}>Reopen</button>}
        {acts.has("cancel") && <button type="button" className="button button--quiet" onClick={() => open("cancel")}>{task.status === "requested" ? "Withdraw request" : isDeliverable ? "Cancel deliverable" : "Cancel task"}</button>}
        {isAdmin && !task.removed_at && <button type="button" className="button button--quiet button--danger-text" onClick={() => { bin.reset(); setDialog("delete"); }}>Delete</button>}
        {acts.size === 0 && !waitingOnAdmin && <span className="muted small">You can view this task. Only its owner, the current stage owner or an admin can act on it.</span>}
      </div>
      {!dialog && <ErrorText error={action.error} />}

      <nav className="panel-tabs" role="tablist" aria-label="Task sections">
        {PANEL_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "is-on" : undefined} onClick={() => setTab(t.key)}>
            {t.key === "workflow" && task.kind === "deliverable" ? "Journey" : t.label}{t.key === "history" ? ` (${events.length})` : ""}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="panel-tab" role="tabpanel">
          {task.parent_id && <PartOfStrip task={task} />}
          <section className="card">
            <h2>Details</h2>
            <dl className="details">
              <dt>Owner</dt><dd>{memberName(task.owner_id)}</dd>
              <dt>Due</dt><dd className={isOverdue(task.due_date, task.status) ? "due--late" : undefined}>{formatDate(task.due_date)}</dd>
              <dt>Publish date</dt><dd>{formatDate(task.publish_date)}</dd>
              <dt>Reviewer</dt><dd>{memberName(task.reviewer_id)}</dd>
              {opp && <><dt>From opportunity</dt><dd><Link to={`/opportunities/${opp.ref}`}>{opp.title}</Link></dd></>}
              <dt>Goal</dt><dd>{goal ? <Link to={`/goals#goal-${goal.ref}`}>{goal.title}</Link> : "No goal"}{parent && goal && !task.goal_id && <span className="small muted"> (through its deliverable)</span>}{goal && task.counts_toward_goal && <span className="tag">counts toward the goal’s target</span>}</dd>
              {parent && <><dt>Deliverable</dt><dd>{parent.title}</dd></>}
              <dt>Format</dt><dd>{task.deliverable_format ?? "—"}</dd>
              <dt>Channel</dt><dd>{task.channel ? label("channel", task.channel) : "—"}</dd>
              {task.requester && <><dt>Requested by</dt><dd>{task.requester}</dd></>}
              <dt>Estimate</dt><dd>{task.estimated_minutes ? formatDuration(task.estimated_minutes) : "—"}</dd>
              <dt>Output link</dt><dd>{task.deliverable_url ? <a href={task.deliverable_url} target="_blank" rel="noopener noreferrer">Open link</a> : "Not attached yet"}</dd>
              <dt>Created</dt><dd>{formatDateTime(task.created_at)} by {memberName(task.created_by)}</dd>
              {task.completed_at && <><dt>Approved</dt><dd>{formatDateTime(task.completed_at)}</dd></>}
            </dl>
            {task.brief && <><h3>Brief</h3><p className="prewrap">{task.brief}</p></>}
            {task.completion_criteria && <><h3>Completion criteria</h3><p className="prewrap">{task.completion_criteria}</p></>}
            {taskDrafts.length > 0 && <><h3>AI drafts</h3><ul className="linked-tasks">{taskDrafts.map((d) => (
              <li key={d.id}><Link to={`/intelligence/drafts/${d.ref}`}>{d.output?.working_title ?? (d.kind === "script" ? "Script draft" : "Brief draft")}</Link><Chip code={d.status} label={DRAFT_STATUS_LABEL[d.status]!} /></li>
            ))}</ul></>}
          </section>
        </div>
      )}
      {tab === "workflow" && (
        <div className="panel-tab" role="tabpanel">
          {task.kind === "deliverable" ? <>
            <p className="jr-cta"><Link className="button button--small button--primary" to={`/workspace/deliverables/${task.ref}`}>Open the full journey</Link>
              <span className="small muted">Flow diagram, timeline by person, where time went, what went well and where it was lost.</span></p>
            <DeliverableJourney deliverable={task} />
          </> : (
            <section className="card">
              <h2>Workflow stages</h2>
              {stages.length === 0 ? <p className="muted">This task has no workflow stages.</p> : (
                <ol className="stages">
                  {stages.map((s) => (
                    <StageRow key={s.id} s={s} label={label} memberName={memberName}
                      canSkip={s.state === "pending" && (acts.has("hand_off") || acts.has("submit"))}
                      onSkip={() => run({ fn: "task_skip_stage", args: { p_task: id, p_stage: s.id, p_note: null } })} />
                  ))}
                </ol>
              )}
              <p className="muted small">Wait = time between hand-off and pick-up. Times start from when this tracker began; earlier history is not recorded.</p>
            </section>
          )}
        </div>
      )}
      {tab === "impact" && <div className="panel-tab" role="tabpanel"><TaskImpactPanel task={task} /></div>}
      {tab === "history" && (
        <div className="panel-tab" role="tabpanel">
        <section className="card">
          <h2>History</h2>
          {!task.removed_at && <form className="comment-box" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) run({ fn: "task_comment", args: { p_task: id, p_note: comment } }); }}>
            <textarea rows={2} placeholder="Add a comment for the team" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
            <button type="submit" className="button" disabled={!comment.trim() || action.isPending}>Comment</button>
          </form>}
          <ol className="history">
            {events.map((e) => <EventRow key={e.id} e={e} label={label} memberName={memberName} />)}
          </ol>
        </section>
        </div>
      )}

      {/* ---------------------------------------------------------------- dialogs */}
      <Modal title={isDeliverable ? "Edit deliverable" : "Edit task"} open={dialog === "edit"} onClose={() => setDialog(null)} wide>
        <TaskForm mode="edit" initial={taskToValues(task)} restrictedEditable={acts.has("edit_restricted")}
          busy={update.isPending} error={update.error} onCancel={() => setDialog(null)}
          onSubmit={(v) => update.mutate({ id, patch: valuesToTask(v) }, { onSuccess: () => setDialog(null) })} />
      </Modal>

      <ActionDialog title={`Hand off to ${next ? label("workflow_stage", next.stage_code) : ""}`} open={dialog === "hand_off"}
        onClose={() => setDialog(null)} busy={action.isPending} error={action.error} confirm="Hand off"
        onConfirm={() => run({ fn: "task_hand_off", args: { p_task: id, p_next_owner: nextOwner || null, p_note: note || null } })}>
        <p className="muted small">Completes <strong>{current ? label("workflow_stage", current.stage_code) : ""}</strong> and makes the next stage ready. The wait clock runs until the next owner picks it up.</p>
        <Field label="Next stage owner">
          <select value={nextOwner} onChange={(e) => setNextOwner(e.target.value)}>
            {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </Field>
        <Field label="What are you handing over? (optional)"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ActionDialog>

      <ActionDialog title="Return for rework" open={dialog === "return"} onClose={() => setDialog(null)} busy={action.isPending}
        error={action.error} confirm="Return" disabled={!note.trim() || !returnTo}
        onConfirm={() => run({ fn: "task_return_for_rework", args: { p_task: id, p_to_stage: returnTo, p_reason: note } })}>
        <Field label="Back to stage">
          <select value={returnTo} onChange={(e) => setReturnTo(e.target.value)}>
            {earlierDone.map((s) => <option key={s.id} value={s.id}>{label("workflow_stage", s.stage_code)}</option>)}
          </select>
        </Field>
        <Field label="Reason" required hint="e.g. unclear brief, factual correction, new direction"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ActionDialog>

      <NoteDialog title="Mark blocked" open={dialog === "block"} label="What is blocking it, and who can resolve it?" required
        confirm="Mark blocked" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_set_status", args: { p_task: id, p_status: "blocked", p_note: note } })} />
      <NoteDialog title="Unblock" open={dialog === "unblock"} label="How was it resolved? (optional)"
        confirm="Unblock" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_set_status", args: { p_task: id, p_status: "in_progress", p_note: note || null } })} />
      <NoteDialog title="Submit for approval" open={dialog === "submit"} label="Note for the approver (optional)"
        intro={isDeliverable
          ? (openParts > 0 ? `${openParts} of its tasks are still open; the deliverable can be approved only when they are done or cancelled.` : undefined)
          : !task.deliverable_url ? "No link to the output is attached yet. Add it under Edit details so the approver can check the work." : undefined}
        confirm="Submit" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_submit_for_approval", args: { p_task: id, p_note: note || null } })} />
      <NoteDialog title="Approve completion" open={dialog === "approve"} label="Feedback (optional)"
        intro="Confirm the deliverable exists, matches the brief and completion criteria, and any claims have been checked."
        confirm="Approve — mark Done" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_decide", args: { p_task: id, p_approve: true, p_feedback: note || null } })} />
      <NoteDialog title="Request changes" open={dialog === "request_changes"} label="What needs to change?" required
        confirm="Request changes" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_decide", args: { p_task: id, p_approve: false, p_feedback: note } })} />
      <MoveToBinDialog open={dialog === "delete"} onClose={() => setDialog(null)} busy={bin.isPending} error={bin.error}
        what={task.kind === "deliverable" ? "deliverable" : "task"} refText={task.title}
        onConfirm={(reason) => bin.mutate({ fn: "task_remove", args: { p_task: id, p_reason: reason } },
          { onSuccess: () => { setDialog(null); if (onClose) onClose(); else navigate("/workspace"); } })} />
      <PurgeDialog open={dialog === "purge"} onClose={() => setDialog(null)} busy={bin.isPending} error={bin.error}
        what={task.kind === "deliverable" ? "deliverable" : "task"} refText={task.title}
        onConfirm={() => bin.mutate({ fn: "task_purge", args: { p_task: id } },
          { onSuccess: () => { setDialog(null); navigate(isAdmin ? "/bin" : "/workspace"); } })} />
      <ActionDialog title="Accept task request" open={dialog === "accept"} onClose={() => setDialog(null)} busy={action.isPending}
        error={action.error} confirm="Accept and start" disabled={!task.parent_id && missingImpact(task).length > 0}
        onConfirm={() => void acceptRequest()}>
        <p className="muted small">{isDeliverable ? "Accepting puts the deliverable on the desk with the owner below; its tasks can then be added." : "Accepting starts the task with the owner below."} Due date, priority and other details can be changed with Edit details.</p>
        {!task.parent_id && missingImpact(task).length > 0 && (
          <p className="form__error" role="alert">Complete the expected business impact first ({missingImpact(task).join(", ")}). Use Edit details, then accept.</p>
        )}
        <Field label="Owner">
          <select value={nextOwner} onChange={(e) => setNextOwner(e.target.value)}>
            {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </Field>
        {requestedParts.length > 0 && (
          <label className="check small field--wide">
            <input type="checkbox" checked={withParts} onChange={(e) => setWithParts(e.target.checked)} />
            Also accept its {requestedParts.length} planned task{requestedParts.length > 1 ? "s" : ""} ({requestedParts.map((p) => p.title).join(", ")}), each with its own owner
          </label>
        )}
        <Field label="Note for the requester (optional)"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ActionDialog>
      <NoteDialog title="Decline task request" open={dialog === "decline"} label="Why is it declined?" required
        confirm="Decline request" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_review_request", args: { p_task: id, p_accept: false, p_note: note, p_owner: null } })} />
      <NoteDialog title={task.status === "requested" ? "Withdraw request" : "Cancel task"} open={dialog === "cancel"} label="Why is this work being stopped?" required
        confirm={task.status === "requested" ? "Withdraw request" : isDeliverable ? "Cancel deliverable" : "Cancel task"} note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_set_status", args: { p_task: id, p_status: "cancelled", p_note: note } })} />
      <NoteDialog title="Reopen task" open={dialog === "reopen"} label="Why is it being reopened?" required
        confirm="Reopen" note={note} setNote={setNote} busy={action.isPending} error={action.error} onClose={() => setDialog(null)}
        onConfirm={() => run({ fn: "task_set_status", args: { p_task: id, p_status: "in_progress", p_note: note } })} />
    </article>
  );
}

function StageRow({ s, label, memberName, canSkip, onSkip }: {
  s: TaskStage; label: (v: string, c: string | null | undefined) => string; memberName: (id: string | null) => string;
  canSkip: boolean; onSkip: () => void;
}) {
  const wait = minutesBetween(s.ready_at, s.picked_up_at);
  const elapsed = minutesBetween(s.entered_at, s.completed_at);
  return (
    <li className={`stage stage--${s.state}`}>
      <div className="stage__head">
        <span className="stage__dot" aria-hidden="true" />
        <strong>{label("workflow_stage", s.stage_code)}</strong>
        <span className="muted small">{s.state === "active" ? (s.picked_up_at ? "in progress" : "waiting for pick-up") : s.state}</span>
        {s.is_optional && s.state === "pending" && <span className="tag">optional</span>}
        {s.revision_count > 0 && <span className="tag tag--warn">rework ×{s.revision_count}</span>}
        {canSkip && s.is_optional && <button type="button" className="link small" onClick={onSkip}>Skip</button>}
      </div>
      {(s.state === "active" || s.state === "done") && (
        <div className="stage__meta">
          <span>{memberName(s.owner_id)}</span>
          {s.state === "active" && !s.picked_up_at && <span>ready {formatDateTime(s.ready_at)}</span>}
          {s.picked_up_at && <span>wait {formatDuration(wait)}</span>}
          {s.state === "done" && <span>stage time {formatDuration(elapsed)}</span>}
        </div>
      )}
    </li>
  );
}

export const EVENT_TEXT: Record<string, string> = {
  created: "created the task", status_changed: "changed status", stage_entered: "started stage", picked_up: "picked up",
  handed_off: "handed off", stage_completed: "completed stage", stage_skipped: "skipped stage",
  returned_for_rework: "returned for rework", blocked: "marked blocked", unblocked: "unblocked",
  submitted_for_approval: "submitted for approval", approved: "approved completion", changes_requested: "requested changes",
  cancelled: "cancelled the task", reopened: "reopened the task", comment: "commented",
  owner_changed: "reassigned the task", due_date_changed: "changed the due date", priority_changed: "changed priority",
  goal_changed: "changed the linked goal", publish_date_changed: "changed the publish date",
  request_accepted: "accepted the request", request_declined: "declined the request",
};

function EventRow({ e, label, memberName }: { e: TaskEvent; label: (v: string, c: string | null | undefined) => string; memberName: (id: string | null) => string }) {
  let detail: string | null = null;
  if (e.event_type === "status_changed") detail = `${label("task_status", e.from_value)} → ${label("task_status", e.to_value)}`;
  if (e.event_type === "handed_off") detail = `${label("workflow_stage", e.from_value)} → ${label("workflow_stage", e.to_value)} · to ${memberName(e.to_owner_id)}`;
  if (e.event_type === "returned_for_rework") detail = `${label("workflow_stage", e.from_value)} → ${label("workflow_stage", e.to_value)}`;
  if (["stage_entered", "stage_completed", "stage_skipped", "picked_up"].includes(e.event_type)) detail = label("workflow_stage", e.stage_code);
  if (e.event_type === "owner_changed") detail = `${memberName(e.from_owner_id)} → ${memberName(e.to_owner_id)}`;
  if (e.event_type === "due_date_changed" || e.event_type === "publish_date_changed") detail = `${formatDate(e.from_value)} → ${formatDate(e.to_value)}`;
  if (e.event_type === "priority_changed") detail = `${label("priority", e.from_value)} → ${label("priority", e.to_value)}`;
  if (e.event_type === "status_changed" && ["blocked", "cancelled", "in_review", "changes_requested", "done"].includes(e.to_value ?? "")) return null;
  return (
    <li className={`event event--${e.event_type}`}>
      <span className="event__time">{formatDateTime(e.occurred_at)}</span>
      <span><strong>{e.actor_id ? memberName(e.actor_id) : "System"}</strong> {EVENT_TEXT[e.event_type] ?? e.event_type}{detail && <> · {detail}</>}</span>
      {e.note && <span className="event__note prewrap">{e.note}</span>}
    </li>
  );
}

function ActionDialog({ title, open, onClose, onConfirm, confirm, busy, error, disabled, children }: {
  title: string; open: boolean; onClose: () => void; onConfirm: () => void; confirm: string; busy: boolean; error: unknown;
  disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="stack">
        {children}
        <ErrorText error={error} />
        <div className="form__actions">
          <button type="button" className="button" onClick={onClose}>Back</button>
          <button type="button" className="button button--primary" disabled={busy || disabled} onClick={onConfirm}>{busy ? "Saving…" : confirm}</button>
        </div>
      </div>
    </Modal>
  );
}

function NoteDialog({ title, open, label, required, intro, confirm, note, setNote, busy, error, onClose, onConfirm }: {
  title: string; open: boolean; label: string; required?: boolean; intro?: string; confirm: string; note: string;
  setNote: (v: string) => void; busy: boolean; error: unknown; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <ActionDialog title={title} open={open} onClose={onClose} onConfirm={onConfirm} confirm={confirm} busy={busy} error={error}
      disabled={required && !note.trim()}>
      {intro && <p className="muted small">{intro}</p>}
      <Field label={label} required={required}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </ActionDialog>
  );
}
