import { activeStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { taskTable } from "../lib/exportRows.ts";
import { todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { ExportCsvButton } from "../components/DateRange.tsx";
import { Popover } from "../components/Popover.tsx";
import { type DueFilter, matchesFilters, taskRange, type TaskFilters, useGroupBy } from "./filters.ts";
import { GROUP_OPTIONS, type GroupBy } from "./phases.ts";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "", label: "Any due date" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" },
  { value: "week", label: "Due in 7 days" }, { value: "next14", label: "Due in 14 days" }, { value: "none", label: "No due date" },
];

/**
 * The one toolbar (D-041): search, owner / type / priority / status, a "More" popover
 * (channel, due, goal, deliverable), Clear, and the view controls for the current tab.
 */
export function TaskFilterBar({ f, set, clear, active, view }: {
  f: TaskFilters;
  set: <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => void;
  setMany: (patch: Partial<TaskFilters>) => void;
  clear: () => void;
  active: boolean;
  /** which view controls to show */
  view: "hierarchy" | "work";
}) {
  const goals = useGoals();
  const tasks = useTasks();
  const { members, options, label, memberName } = useLookups();
  const { member: me } = useMember();
  const { scope } = useScope();
  const [group, setGroup] = useGroupBy();
  const today = todayInIndia();
  const more = [f.channel, f.due, f.goal, f.deliverable].filter(Boolean).length;
  const deliverables = (tasks.data ?? []).filter((t) => t.kind === "deliverable" && t.status !== "cancelled");

  return (
    <div className="wsbar" role="search" aria-label="Find work">
      <div className="wsbar__row">
        <input className="wsbar__search" type="search" placeholder="Search by title" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search" />
        <select className="wsbar__select" value={f.owner} onChange={(e) => set("owner", e.target.value)} aria-label="Owner">
          <option value="">Any owner</option>
          {(members.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <select className="wsbar__select" value={f.type} onChange={(e) => set("type", e.target.value)} aria-label="Type of work">
          <option value="">Any type</option>
          {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select className="wsbar__select" value={f.priority} onChange={(e) => set("priority", e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {options("priority").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <select className="wsbar__select" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Open + done</option>
          <option value="active">Open only</option>
          {options("task_status").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          <option value="all">All, incl. cancelled</option>
        </select>
        <Popover label="More filters" buttonClassName={`button button--small${more ? " is-active" : ""}`} button={<>More{more ? ` (${more})` : ""} <span className="caret" aria-hidden="true" /></>}>
          <div className="filter-grid">
            <label>Channel<select value={f.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Any channel</option>
              {options("channel").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select></label>
            <label>Due<select value={f.due} onChange={(e) => set("due", e.target.value as DueFilter)}>
              {DUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
            <label>Goal<select value={f.goal} onChange={(e) => set("goal", e.target.value)}>
              <option value="">Any goal</option>
              <option value="none">No goal</option>
              {(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select></label>
            <label>Deliverable<select value={f.deliverable} onChange={(e) => set("deliverable", e.target.value)}>
              <option value="">Any deliverable</option>
              {deliverables.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select></label>
          </div>
        </Popover>
        {active && <button type="button" className="link small" onClick={clear}>Clear</button>}
        <span className="wsbar__end">
          {view === "work" && (
            <label className="wsbar__group">
              <span className="small muted">Group by</span>
              <select value={group} onChange={(e) => setGroup(e.target.value as GroupBy)} aria-label="Group by">
                {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <ExportCsvButton name="tasks" range={taskRange(f, today)} disabled={!tasks.data || !goals.data}
            build={() => taskTable((tasks.data ?? []).filter((t) => matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data })),
              (id) => { const t = tasks.data?.find((x) => x.id === id); return t ? activeStage(t)?.stage_code ?? null : null; },
              goals.data ?? [], { label, memberName })} />
        </span>
      </div>
    </div>
  );
}
