// Pipeline view model. Pure functions: the pipeline only *visualises* the
// workflow engine; every move goes through the same database actions as the
// task page (task_hand_off etc.), which re-check all rules server-side.
import type { TaskWithStage } from "../lib/api.ts";
import { availableActions } from "../lib/permissions.ts";

export const DONE_COLUMN = "__done";
export const NO_STAGE_COLUMN = "__none";

export type PipelineStage = TaskWithStage["task_stages"][number];

export function currentStage(t: TaskWithStage): PipelineStage | null {
  return t.task_stages.find((s) => s.state === "active") ?? null;
}

/** The stage a hand-off would move this task to: the next *pending* stage after the active one. */
export function nextStage(t: TaskWithStage): PipelineStage | null {
  const cur = currentStage(t);
  if (!cur) return null;
  return [...t.task_stages]
    .filter((s) => s.state === "pending" && s.position > cur.position)
    .sort((a, b) => a.position - b.position)[0] ?? null;
}

/** Which pipeline column a task sits in. Status and stage stay separate: a blocked task stays in its stage. */
export function columnOf(t: TaskWithStage): string {
  const cur = currentStage(t);
  if (cur) return cur.stage_code;
  if (t.status === "done") return DONE_COLUMN;
  return NO_STAGE_COLUMN;
}

export interface PipelineColumn {
  code: string;
  tasks: TaskWithStage[];
  waiting: number;   // handed to someone, not yet picked up
  blocked: number;
  inReview: number;
}

/** Columns in the shared stage-vocabulary order; Done (approved) closes the journey. */
export function buildPipeline(tasks: TaskWithStage[], stageCodes: string[]): PipelineColumn[] {
  const codes = [...stageCodes.filter((c) => c !== "completed"), DONE_COLUMN];
  const extra = new Set<string>();
  for (const t of tasks) {
    const c = columnOf(t);
    if (!codes.includes(c)) extra.add(c);
  }
  // Stages not in the vocabulary (should not happen) or tasks without a workflow go last, never hidden.
  const all = [...codes.slice(0, -1), ...[...extra].filter((c) => c !== NO_STAGE_COLUMN), DONE_COLUMN,
    ...(extra.has(NO_STAGE_COLUMN) ? [NO_STAGE_COLUMN] : [])];
  return all.map((code) => {
    const items = tasks.filter((t) => columnOf(t) === code);
    return {
      code,
      tasks: items,
      waiting: items.filter((t) => { const s = currentStage(t); return Boolean(s && s.owner_id && !s.picked_up_at && t.status !== "blocked"); }).length,
      blocked: items.filter((t) => t.status === "blocked").length,
      inReview: items.filter((t) => t.status === "in_review").length,
    };
  });
}

/** The person who owns the next step: the active stage owner, else the task owner. */
export function nextStepOwner(t: TaskWithStage): string | null {
  if (t.status === "done" || t.status === "cancelled") return null;
  if (t.status === "in_review") return null; // an admin decides
  return currentStage(t)?.owner_id ?? t.owner_id;
}

export type DropResult = { ok: true; next: PipelineStage } | { ok: false; reason: string };

/**
 * Can this task be dropped on this column? Mirrors the hand-off rules exactly;
 * the database still decides. Anything else is refused with a reason.
 */
export function checkDrop(t: TaskWithStage, targetCode: string, me: { id: string; isAdmin: boolean }, stageLabel: (c: string) => string): DropResult {
  const cur = currentStage(t);
  if (targetCode === columnOf(t)) return { ok: false, reason: "The task is already at this stage." };
  if (t.status === "done" || t.status === "cancelled") return { ok: false, reason: "Closed tasks don't move. Reopen it from the task panel first." };
  if (targetCode === DONE_COLUMN) return { ok: false, reason: "Only an admin approval marks work Done. Submit it for approval from the task panel." };
  if (t.status === "blocked") return { ok: false, reason: "Blocked tasks can't move. Unblock it first (the reason stays in its history)." };
  if (t.status === "in_review") return { ok: false, reason: "This task is waiting for approval. An admin approves it or requests changes." };
  if (!cur) return { ok: false, reason: "This task has no active workflow stage." };
  const next = nextStage(t);
  const acts = availableActions({
    meId: me.id, isAdmin: me.isAdmin, status: t.status, ownerId: t.owner_id, createdBy: t.created_by,
    activeStage: { ownerId: cur.owner_id, pickedUp: Boolean(cur.picked_up_at) }, hasNextStage: Boolean(next), hasEarlierDoneStage: false,
  });
  if (!next) {
    return acts.has("submit")
      ? { ok: false, reason: "This is the task's last stage. Submit it for approval instead." }
      : { ok: false, reason: "Only the task owner, the current stage owner or an admin can move this task." };
  }
  if (!acts.has("hand_off")) return { ok: false, reason: "Only the task owner, the current stage owner or an admin can hand this off." };
  if (next.stage_code === targetCode) return { ok: true, next };
  const inWorkflow = t.task_stages.some((s) => s.stage_code === targetCode);
  if (!inWorkflow) return { ok: false, reason: `${stageLabel(targetCode)} is not part of this task's workflow.` };
  const target = t.task_stages.find((s) => s.stage_code === targetCode)!;
  if (target.position < cur.position) return { ok: false, reason: `To go back to ${stageLabel(targetCode)}, use "Return for rework" in the task panel so the reason is recorded.` };
  return {
    ok: false,
    reason: `Work moves one stage at a time. The next stage is ${stageLabel(next.stage_code)}${next.is_optional ? " (optional — you can skip it in the task panel)" : ""}.`,
  };
}
