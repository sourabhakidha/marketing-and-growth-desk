import { useState } from "react";
import { Link } from "react-router";
import { type Goal, type Task, useBin, useBinAction, useLookups } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { PurgeDialog } from "../components/DeleteDialog.tsx";
import { ErrorText } from "../components/Form.tsx";
import { Loading, StatePanel } from "../components/States.tsx";

type Item = { kind: "task"; row: Task } | { kind: "goal"; row: Goal };

/** Recycle Bin (D-035): deleted tasks and goals, restorable or deletable for good. Admins only. */
export function RecycleBin() {
  const { member } = useMember();
  const bin = useBin();
  const act = useBinAction();
  const { memberName, label } = useLookups();
  const [purging, setPurging] = useState<Item | null>(null);

  if (member.role !== "admin") return <StatePanel title="Admins only"><p>Only Sourabh and Tanvi can see and manage the Recycle Bin.</p></StatePanel>;
  if (bin.isPending) return <Loading />;
  if (bin.isError) return <StatePanel title="Could not load the Recycle Bin" tone="error"><p>{bin.error.message}</p></StatePanel>;

  const restore = (i: Item) => act.mutate(i.kind === "task" ? { fn: "task_restore", args: { p_task: i.row.id } } : { fn: "goal_restore", args: { p_goal: i.row.id } });
  const items: Item[] = [...bin.data.tasks.map((row) => ({ kind: "task" as const, row })), ...bin.data.goals.map((row) => ({ kind: "goal" as const, row }))]
    .sort((a, b) => (b.row.removed_at ?? "").localeCompare(a.row.removed_at ?? ""));

  return (
    <>
      <p className="muted small">Deleted tasks and goals wait here, hidden from every view. <strong>Restore</strong> puts them back where they were. <strong>Delete permanently</strong> removes them from Marketing Desk for good; the record stays in the database and the activity log.</p>
      <ErrorText error={act.error} />
      {items.length === 0 ? <StatePanel title="The Recycle Bin is empty"><p>Deleted tasks and goals will appear here.</p></StatePanel> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Deleted</th><th>Reason</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.kind}-${i.row.id}`}>
                  <td className="wrap">
                    <span className="chip">{i.kind === "goal" ? "Goal" : i.row.kind === "deliverable" ? "Deliverable" : "Task"}</span>{" "}
                    {i.kind === "task" ? <Link to={`/workspace/tasks/${i.row.ref}`}>{i.row.title}</Link> : <>{i.row.title}</>}
                    {i.kind === "task" && <div className="small muted">{label("task_type", i.row.task_type)} · {label("task_status", i.row.status)} · owner {memberName(i.row.owner_id)}</div>}
                  </td>
                  <td className="small">{formatDateTime(i.row.removed_at)}<br />by {memberName(i.row.removed_by)}</td>
                  <td className="wrap small">{i.row.removed_reason}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="button button--small" disabled={act.isPending} onClick={() => restore(i)}>Restore</button>
                      <button type="button" className="button button--small button--quiet button--danger-text" onClick={() => { act.reset(); setPurging(i); }}>Delete permanently</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PurgeDialog open={Boolean(purging)} onClose={() => setPurging(null)} busy={act.isPending} error={act.error}
        what={purging?.kind === "goal" ? "goal" : purging?.row && "kind" in purging.row && purging.row.kind === "deliverable" ? "deliverable" : "task"} refText={purging ? purging.row.title : ""}
        onConfirm={() => purging && act.mutate(purging.kind === "task" ? { fn: "task_purge", args: { p_task: purging.row.id } } : { fn: "goal_purge", args: { p_goal: purging.row.id } },
          { onSuccess: () => setPurging(null) })} />
    </>
  );
}
