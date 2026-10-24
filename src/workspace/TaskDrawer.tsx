import { useEffect, useRef } from "react";
import { TaskPanel } from "./TaskDetail.tsx";
import { useTaskPanel } from "./filters.ts";

/** Right-hand task panel over the current Workspace view (Escape or × closes; focus returns to the page). */
export function TaskDrawer() {
  const { ref, action, close, clearAction } = useTaskPanel();
  const dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (ref && !d.open) { opener.current = document.activeElement; d.showModal(); }
    if (!ref && d.open) { d.close(); (opener.current as HTMLElement | null)?.focus?.(); }
  }, [ref]);

  return (
    <dialog ref={dlg} className="drawer" aria-label="Task details" onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dlg.current) close(); }}>
      <div className="drawer__body">
        {ref && <TaskPanel key={ref} taskNumber={ref} variant="drawer" initialAction={action} onActionConsumed={clearAction} onClose={close} />}
      </div>
    </dialog>
  );
}
