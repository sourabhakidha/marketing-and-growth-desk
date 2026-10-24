import { useGoals, useLookups } from "../lib/api.ts";
import { goalRef } from "../lib/format.ts";
import type { DueFilter, TaskFilters } from "./filters.ts";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "", label: "Any due date" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" },
  { value: "week", label: "Due in 7 days" }, { value: "next14", label: "Due in 14 days" }, { value: "none", label: "No due date" },
];

export function TaskFilterBar({ f, set, clear, active, hideStatus = false }: {
  f: TaskFilters;
  set: <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => void;
  clear: () => void;
  active: boolean;
  hideStatus?: boolean;
}) {
  const goals = useGoals();
  const { members, options } = useLookups();
  return (
    <div className="filters filters--bar" role="search" aria-label="Filter tasks">
      <input type="search" placeholder="Search title or T-number" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search tasks" />
      <select value={f.owner} onChange={(e) => set("owner", e.target.value)} aria-label="Owner">
        <option value="">All owners</option>
        {(members.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
      </select>
      <select value={f.type} onChange={(e) => set("type", e.target.value)} aria-label="Task type">
        <option value="">All task types</option>
        {options("task_type").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
      <select value={f.priority} onChange={(e) => set("priority", e.target.value)} aria-label="Priority">
        <option value="">Any priority</option>
        {options("priority").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
      <select value={f.due} onChange={(e) => set("due", e.target.value as DueFilter)} aria-label="Due date">
        {DUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select value={f.goal} onChange={(e) => set("goal", e.target.value)} aria-label="Goal">
        <option value="">Any goal</option>
        <option value="none">No goal</option>
        {(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{goalRef(g.ref)} · {g.title}</option>)}
      </select>
      {!hideStatus && (
        <select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Open + done</option>
          <option value="active">Open only</option>
          {options("task_status").map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          <option value="all">All, incl. cancelled</option>
        </select>
      )}
      <label className="check"><input type="checkbox" checked={f.mine} onChange={(e) => set("mine", e.target.checked)} /> My work</label>
      {active && <button type="button" className="link small" onClick={clear}>Clear filters</button>}
    </div>
  );
}
