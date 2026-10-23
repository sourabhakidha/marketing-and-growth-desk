import { NavLink, Outlet } from "react-router";
import { NewActivityButton } from "./NewActivity.tsx";

export function Workspace() {
  return (
    <>
      <header className="page-header page-header--row">
        <div>
          <h1>Workspace</h1>
          <p className="muted">What work exists, who owns it, where it is blocked, and what is due.</p>
        </div>
        <NewActivityButton />
      </header>
      <nav className="tabs" aria-label="Workspace views">
        <NavLink to="/workspace" end>Task board</NavLink>
        <NavLink to="/workspace/goals">Goals</NavLink>
        <NavLink to="/workspace/activity">Activity log</NavLink>
        <NavLink to="/workspace/exports">Exports</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
