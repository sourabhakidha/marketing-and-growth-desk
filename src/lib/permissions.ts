// Mirrors the server rules (decisions D-010 – D-012) so the UI only offers
// actions that will succeed. The database enforces the same rules; this file
// never grants anything by itself.

export interface ActionContext {
  meId: string;
  isAdmin: boolean;
  status: string;
  ownerId: string;
  createdBy: string;
  activeStage: { ownerId: string | null; pickedUp: boolean } | null;
  hasNextStage: boolean;
  hasEarlierDoneStage: boolean;
}

export type TaskAction =
  | "pick_up" | "hand_off" | "return_for_rework" | "block" | "unblock" | "submit"
  | "approve" | "request_changes" | "cancel" | "reopen" | "edit" | "edit_restricted";

const CLOSED = new Set(["done", "cancelled"]);

export function canWorkOn(c: ActionContext): boolean {
  return c.isAdmin || c.ownerId === c.meId || (c.activeStage?.ownerId ?? null) === c.meId;
}

export function availableActions(c: ActionContext): Set<TaskAction> {
  const a = new Set<TaskAction>();
  const work = canWorkOn(c);
  const open = !CLOSED.has(c.status);

  if (c.isAdmin || c.ownerId === c.meId || c.createdBy === c.meId) {
    if (c.status !== "done" || c.isAdmin) a.add("edit");
  }
  if (c.isAdmin) a.add("edit_restricted");

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
  if (CLOSED.has(c.status) && c.isAdmin) a.add("reopen");
  return a;
}
