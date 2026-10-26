// Top-level hubs (D-040): Goals, Ideas (Radar + Opportunities), Insights
// (Impact Brief, Flow, Learnings, Process, Activity, Exports) and the Recycle Bin.
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useSaveGoal } from "../lib/api.ts";
import { useMember } from "../lib/session.tsx";
import { Modal } from "../components/Modal.tsx";
import { Goals } from "../workspace/Goals.tsx";
import { emptyGoal, GoalForm, valuesToGoal } from "../workspace/GoalForm.tsx";
import { RecycleBin } from "../workspace/RecycleBin.tsx";
import { TaskDrawer } from "../workspace/TaskDrawer.tsx";

function Tabs({ label, items }: { label: string; items: { to: string; text: string; end?: boolean }[] }) {
  return (
    <nav className="tabs hub-tabs" aria-label={label}>
      {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end}>{i.text}</NavLink>)}
    </nav>
  );
}

export function GoalsPage() {
  const { member } = useMember();
  const isAdmin = member.role === "admin";
  const save = useSaveGoal();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="page-header page-header--row">
        <div>
          <p className="crumbs"><Link to="/workspace">Workspace</Link> / Goal details</p>
          <h1>Goal details</h1>
          <p className="muted">Each goal’s business outcome, how it is measured, the impact assessment, and what actually happened.</p>
        </div>
        {isAdmin && <button type="button" className="button button--primary" onClick={() => { save.reset(); setOpen(true); }}>+ New goal</button>}
      </header>
      <Goals />
      <Modal title="New goal" open={open} onClose={() => setOpen(false)} wide>
        {open && (
          <GoalForm mode="create" initial={emptyGoal(member.id)} busy={save.isPending} error={save.error} onCancel={() => setOpen(false)}
            onSubmit={(v) => save.mutate({ input: valuesToGoal(v) }, { onSuccess: () => { setOpen(false); navigate("/goals"); } })} />
        )}
      </Modal>
      <TaskDrawer />
    </>
  );
}

export function IdeasLayout() {
  return (
    <>
      <Tabs label="Ideas" items={[{ to: "/radar", text: "Radar signals" }, { to: "/opportunities", text: "Opportunities" }]} />
      <Outlet />
    </>
  );
}

export function InsightsLayout() {
  return (
    <>
      <header className="page-header">
        <h1>Insights</h1>
        <p className="muted">How the work is going: impact on business outcomes, how work flows, what we learned, and the full record.</p>
      </header>
      <Tabs label="Insights" items={[
        { to: "/insights", text: "Impact Brief", end: true }, { to: "/insights/flow", text: "Flow" },
        { to: "/insights/learnings", text: "Learnings" }, { to: "/insights/process", text: "Process" },
        { to: "/insights/activity", text: "Activity" }, { to: "/insights/exports", text: "Exports" },
      ]} />
      <Outlet />
      <TaskDrawer />
    </>
  );
}

export function BinPage() {
  return (
    <>
      <header className="page-header">
        <h1>Recycle Bin</h1>
        <p className="muted">Deleted tasks and goals. Admins can restore them or delete them permanently from Marketing Desk.</p>
      </header>
      <RecycleBin />
    </>
  );
}
