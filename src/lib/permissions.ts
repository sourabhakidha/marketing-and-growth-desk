// Mirrors the server rules (decisions D-010 – D-012) so the UI only offers
// actions that will succeed. The database enforces the same rules; this file
// never grants anything by itself.

export interface ActionContext {
  meId: string;
  isAdmin: boolean;
  status: string;
  ownerId: string;
  createdBy: string;
  /** ownerIsAdmin: the active stage is with an admin (e.g. Internal Review), so only admins move it (D-028) */
  activeStage: { ownerId: string | null; pickedUp: boolean; ownerIsAdmin?: boolean } | null;
  hasNextStage: boolean;
  hasEarlierDoneStage: boolean;
  /** in the Recycle Bin: nothing runs until it is restored (D-035) */
  removed?: boolean;
  /** a cancelled request that was never accepted (no step ever started) cannot be reopened (D-033) */
  neverAccepted?: boolean;
}

export type TaskAction =
  | "pick_up" | "hand_off" | "return_for_rework" | "block" | "unblock" | "submit"
  | "approve" | "request_changes" | "cancel" | "reopen" | "edit" | "edit_restricted"
  | "accept_request" | "decline_request";

const CLOSED = new Set(["done", "cancelled"]);

/** Stages where work waits for someone's sign-off; with an admin they count as "awaiting approval". */
export const REVIEW_STAGES: ReadonlySet<string> = new Set(["internal_review", "final_review", "approval"]);

export function canWorkOn(c: ActionContext): boolean {
  if (c.isAdmin) return true;
  if (heldByAdmin(c)) return false;
  return c.ownerId === c.meId || (c.activeStage?.ownerId ?? null) === c.meId;
}

/** A contributor is waiting on an admin: the active stage was handed to Sourabh or Tanvi. */
export function heldByAdmin(c: Pick<ActionContext, "isAdmin" | "status" | "activeStage">): boolean {
  return !c.isAdmin && !CLOSED.has(c.status) && Boolean(c.activeStage?.ownerIsAdmin);
}

export function availableActions(c: ActionContext): Set<TaskAction> {
  const a = new Set<TaskAction>();
  if (c.removed) return a;
  const work = canWorkOn(c);
  const open = !CLOSED.has(c.status);

  if (c.isAdmin || c.ownerId === c.meId || c.createdBy === c.meId) {
    if (c.status !== "done" || c.isAdmin) a.add("edit");
  }
  if (c.isAdmin) a.add("edit_restricted");

  // D-033: a contributor's new task is a request until an admin accepts or declines it
  if (c.status === "requested") {
    if (c.isAdmin) { a.add("accept_request"); a.add("decline_request"); }
    else if (c.ownerId === c.meId || c.createdBy === c.meId) a.add("cancel");
    return a;
  }

  if (open && c.activeStage && !c.activeStage.pickedUp && (c.activeStage.ownerId === c.meId || c.isAdmin)) a.add("pick_up");
  if (open && work && c.status !== "blocked" && c.status !== "in_review") {
    if (c.hasNextStage) a.add("hand_off");
    a.add("submit");
    a.add("block");
  }
  if (open && work && c.hasEarlierDoneStage) a.add("return_for_rework");
  if (c.status === "blocked" && work) a.add("unblock");
  if (c.status === "in_review" && c.isAdmin) { a.add("approve"); a.add("request_changes"); }
  if (open && (c.isAdmin || c.ownerId === c.meId || c.createdBy === c.meId)) a.add("cancel");
  if (CLOSED.has(c.status) && c.isAdmin && !(c.status === "cancelled" && c.neverAccepted)) a.add("reopen");
  return a;
}

interface ReviewTask {
  status: string; owner_id: string; created_by: string;
  task_stages: { stage_code: string; state: string; owner_id: string | null }[];
}

/**
 * Overview "awaiting approval": submitted for approval, or sitting in a review stage.
 * Admins see work submitted or held by an admin for review; contributors see their own
 * work (owned, created or worked on) that is submitted or in review with someone else.
 */
export function awaitingApproval(t: ReviewTask, me: { id: string; isAdmin: boolean; isAdminMember: (id: string | null) => boolean }): boolean {
  if (CLOSED.has(t.status)) return false;
  const s = t.task_stages.find((x) => x.state === "active");
  const inReviewStage = Boolean(s && REVIEW_STAGES.has(s.stage_code));
  if (me.isAdmin) return t.status === "in_review" || (inReviewStage && me.isAdminMember(s!.owner_id));
  const mine = t.owner_id === me.id || t.created_by === me.id || t.task_stages.some((x) => x.state === "done" && x.owner_id === me.id);
  return mine && (t.status === "in_review" || (inReviewStage && s!.owner_id !== me.id));
}
