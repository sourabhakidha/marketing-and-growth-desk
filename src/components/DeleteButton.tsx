import { useState } from "react";
import { useBinAction } from "../lib/api.ts";
import { useMember } from "../lib/session.tsx";
import { MoveToBinDialog } from "./DeleteDialog.tsx";

export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/**
 * Admin-only Delete (D-035): moves a task, deliverable or goal to the Recycle Bin with a reason.
 * Renders nothing for contributors.
 */
export function DeleteButton({ kind, id, title, className = "icon-button del-btn", text }: {
  kind: "task" | "deliverable" | "goal"; id: string; title: string; className?: string; text?: string;
}) {
  const { member } = useMember();
  const bin = useBinAction();
  const [open, setOpen] = useState(false);
  if (member.role !== "admin") return null;
  return (
    <>
      <button type="button" className={className} title={`Delete ${kind}`} aria-label={`Delete ${kind}: ${title}`}
        onClick={(e) => { e.stopPropagation(); bin.reset(); setOpen(true); }}>
        <TrashIcon />{text && <span>{text}</span>}
      </button>
      <MoveToBinDialog open={open} onClose={() => setOpen(false)} busy={bin.isPending} error={bin.error} what={kind} refText={title}
        onConfirm={(reason) => bin.mutate(kind === "goal" ? { fn: "goal_remove", args: { p_goal: id, p_reason: reason } } : { fn: "task_remove", args: { p_task: id, p_reason: reason } },
          { onSuccess: () => setOpen(false) })} />
    </>
  );
}
