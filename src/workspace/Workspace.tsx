import { NavLink, Outlet, useLocation } from "react-router";
import { NewActivityButton } from "./NewActivity.tsx";
import { TaskFilterBar } from "./TaskFilterBar.tsx";
import { TaskDrawer } from "./TaskDrawer.tsx";
import { useTaskFilters } from "./filters.ts";

const VIEWS = [
  { to: "/workspace", label: "Pipeline", end: true },
  { to: "/workspace/board", label: "Status board", end: false },
  { to: "/workspace/list", label: "List", end: false },
  { to: "/workspace/calendar", label: "Calendar", end: false },
];
const WORK_PATHS = new Set(["/workspace", "/workspace/", "/workspace/board", "/workspace/list", "/workspace/calendar"]);

export function Workspace() {
  const { pathname, search } = useLocation();
  const filters = useTaskFilters();
  const workView = WORK_PATHS.has(pathname);
  // Keep filters when switching between work views (but not the open task).
  const keep = new URLSearchParams(search);
  keep.delete("task");
  keep.delete("action");
  const qs = keep.toString() ? `?${keep.toString()}` : "";

  return (
    <>
      <header className="page-header page-header--row">
        <div>
          <h1>Workspace</h1>
          <p className="muted">What is being created, where it is in the process, who owns the next step, and what is holding it up.</p>
        </div>
        <NewActivityButton />
      </header>

      <div className="ws-bar">
        <nav className="viewswitch" aria-label="Work views">
          {VIEWS.map((v) => (
            <NavLink key={v.to} to={`${v.to}${qs}`} end={v.end} className={({ isActive }) => (isActive ? "is-on" : undefined)}>{v.label}</NavLink>
          ))}
        </nav>
        <nav className="tabs tabs--inline" aria-label="Workspace records">
          <NavLink to="/workspace/goals">Goals</NavLink>
          <NavLink to="/workspace/activity">Activity log</NavLink>
          <NavLink to="/workspace/exports">Exports</NavLink>
        </nav>
      </div>

      {workView && <TaskFilterBar {...filters} />}
      <Outlet />
      {workView && <TaskDrawer />}
    </>
  );
}
