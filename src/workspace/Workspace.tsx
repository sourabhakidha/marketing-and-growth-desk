// Workspace (D-041, D-044): Goal → Deliverable → Task. Tabs: Overview (default), Goals,
// Deliverables, Tasks, Calendar, List — one toolbar, one date range, one "+ Create new".
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useSaveGoal } from "../lib/api.ts";
import { isPreset, type RangePreset } from "../lib/dateRange.ts";
import { todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { DateRangePicker } from "../components/DateRange.tsx";
import { Modal } from "../components/Modal.tsx";
import { PopupMenu } from "../components/PopupMenu.tsx";
import { TaskFilterBar } from "./TaskFilterBar.tsx";
import { TaskDrawer } from "./TaskDrawer.tsx";
import { TASK_DATE_BASES, taskRange, useTaskFilters } from "./filters.ts";
import { emptyGoal, GoalForm, valuesToGoal } from "./GoalForm.tsx";
import { NewDeliverableModal, NewTaskModal } from "./Hierarchy.tsx";

const TABS = [
  { to: "/workspace", label: "Overview", end: true },
  { to: "/workspace/goals", label: "Goals", end: false },
  { to: "/workspace/deliverables", label: "Deliverables", end: false },
  { to: "/workspace/tasks", label: "Tasks", end: false },
  { to: "/workspace/calendar", label: "Calendar", end: false },
  { to: "/workspace/list", label: "List", end: false },
];

export function Workspace() {
  const { search, pathname } = useLocation();
  const filters = useTaskFilters();
  const { f, setMany } = filters;
  const today = todayInIndia();
  const range = taskRange(f, today);
  const preset: RangePreset = isPreset(f.range) ? f.range : "all";
  // keep filters when switching tabs (but not the open task)
  const keep = new URLSearchParams(search);
  keep.delete("task"); keep.delete("action"); keep.delete("view");
  const qs = keep.toString() ? `?${keep.toString()}` : "";
  const overview = pathname === "/workspace" || pathname === "/workspace/" || /^\/workspace\/deliverables\/\d+/.test(pathname);
  const hierarchy = pathname.startsWith("/workspace/goals") || pathname.startsWith("/workspace/deliverables");

  return (
    <>
      <header className="ws-head">
        <div>
          <h1>Workspace</h1>
          <p className="muted">Goals, the deliverables that serve them, and the tasks that produce them.</p>
        </div>
        <div className="ws-head__actions">
          <DateRangePicker range={range} bases={TASK_DATE_BASES}
            value={{ preset, from: f.from, to: f.to, basis: f.on || "created" }}
            onChange={(p) => setMany({
              ...(p.preset !== undefined && { range: p.preset === "all" ? "" : p.preset }),
              ...(p.from !== undefined && { from: p.from }), ...(p.to !== undefined && { to: p.to }),
              ...(p.basis !== undefined && { on: p.basis === "created" ? "" : p.basis }),
            })} />
          <CreateNew />
        </div>
      </header>
      <nav className="ws-tabs" aria-label="Workspace views">
        {TABS.map((t) => <NavLink key={t.to} to={`${t.to}${qs}`} end={t.end} className={({ isActive }) => (isActive ? "is-on" : undefined)}>{t.label}</NavLink>)}
      </nav>
      {!overview && <TaskFilterBar {...filters} view={hierarchy ? "hierarchy" : "work"} />}
      <Outlet />
      <TaskDrawer />
    </>
  );
}

function CreateNew() {
  const { member } = useMember();
  const isAdmin = member.role === "admin";
  const save = useSaveGoal();
  const [open, setOpen] = useState<null | "goal" | "deliverable" | "task">(null);
  return (
    <>
      <PopupMenu label="Create new" buttonClassName="button button--primary create-new" align="end"
        button={<>+ Create new <span className="caret caret--light" aria-hidden="true" /></>}>
        {isAdmin && (
          <button type="button" role="menuitem" className="popup__item create-item" onClick={() => { save.reset(); setOpen("goal"); }}>
            <strong>Goal</strong><span className="small muted">A business outcome to achieve</span>
          </button>
        )}
        <button type="button" role="menuitem" className="popup__item create-item" onClick={() => setOpen("deliverable")}>
          <strong>{isAdmin ? "Deliverable" : "Request a deliverable"}</strong><span className="small muted">A concrete output for a goal</span>
        </button>
        <button type="button" role="menuitem" className="popup__item create-item" onClick={() => setOpen("task")}>
          <strong>{isAdmin ? "Task" : "Request a task"}</strong><span className="small muted">A piece of work with one owner</span>
        </button>
      </PopupMenu>
      <Modal title="New goal" open={open === "goal"} onClose={() => setOpen(null)} wide>
        {open === "goal" && <GoalForm mode="create" initial={emptyGoal(member.id)} busy={save.isPending} error={save.error} onCancel={() => setOpen(null)}
          onSubmit={(v) => save.mutate({ input: valuesToGoal(v) }, { onSuccess: () => setOpen(null) })} />}
      </Modal>
      {open === "deliverable" && <NewDeliverableModal onClose={() => setOpen(null)} />}
      {open === "task" && <NewTaskModal onClose={() => setOpen(null)} />}
    </>
  );
}
