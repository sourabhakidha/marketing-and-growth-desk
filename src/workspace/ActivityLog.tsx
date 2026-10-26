import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useLookups, useTasks, useTaskEvents } from "../lib/api.ts";
import { isBounded } from "../lib/dateRange.ts";
import { eventTable } from "../lib/exportRows.ts";
import {formatDateTime} from "../lib/format.ts";
import { DateRangePicker, ExportCsvButton, useDateRange } from "../components/DateRange.tsx";
import { useMember } from "../lib/session.tsx";
import { isMyTask, useScope } from "../lib/scope.tsx";
import { Loading, StatePanel } from "../components/States.tsx";

const TYPE_LABEL: Record<string, string> = {
  created: "Created", status_changed: "Status changed", stage_entered: "Stage started", picked_up: "Picked up",
  handed_off: "Handed off", stage_completed: "Stage completed", stage_skipped: "Stage skipped",
  returned_for_rework: "Returned for rework", blocked: "Blocked", unblocked: "Unblocked",
  submitted_for_approval: "Submitted for approval", approved: "Approved", changes_requested: "Changes requested",
  cancelled: "Cancelled", reopened: "Reopened", comment: "Comment", owner_changed: "Reassigned",
  due_date_changed: "Due date changed", priority_changed: "Priority changed", goal_changed: "Goal changed",
  publish_date_changed: "Publish date changed",
};

export function ActivityLog() {
  const dates = useDateRange();
  const { member: me } = useMember();
  const { isMe } = useScope();
  const events = useTaskEvents(dates.range, 500);
  const tasks = useTasks();
  const { memberName, label, members } = useLookups();
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");

  const byId = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);
  const rows = (events.data ?? []).filter((e) => byId.has(e.task_id) && (!actor || e.actor_id === actor) && (!type || e.event_type === type)
    && (!isMe || e.actor_id === me.id || Boolean(byId.get(e.task_id) && isMyTask(byId.get(e.task_id)!, me.id))));

  if (events.isPending) return <Loading />;
  if (events.isError) return <StatePanel title="Could not load activity" tone="error"><p>{events.error.message}</p></StatePanel>;

  return (
    <>
      <div className="filters">
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
          <option value="">All events</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <DateRangePicker {...dates} />
        <span className="muted small">{isBounded(dates.range) ? `${rows.length} events in this period` : "Latest 500 events · pick a period to see all of it"}</span>
        <span className="filters__end">
          <ExportCsvButton name="activity" range={dates.range} build={() => eventTable(rows, tasks.data ?? [], { label, memberName })} />
        </span>
      </div>
      {rows.length === 0 ? <StatePanel title="No activity recorded yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Task</th><th scope="col">Event</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const t = byId.get(e.task_id);
                const detail =
                  e.event_type === "status_changed" ? `${label("task_status", e.from_value)} → ${label("task_status", e.to_value)}`
                  : e.event_type === "handed_off" ? `${label("workflow_stage", e.from_value)} → ${label("workflow_stage", e.to_value)} (${memberName(e.to_owner_id)})`
                  : e.stage_code ? label("workflow_stage", e.stage_code) : "";
                return (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.occurred_at)}</td>
                    <td>{e.actor_id ? memberName(e.actor_id) : "System"}</td>
                    <td className="wrap">{t ? <Link to={`/workspace/tasks/${t.ref}`}>{t.title}</Link> : "—"}</td>
                    <td>{TYPE_LABEL[e.event_type] ?? e.event_type}</td>
                    <td className="wrap">{[detail, e.note].filter(Boolean).join(" — ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
