// Daily Ops (D-046): plan the workday, check in/out, punch in/out on tasks. Admins also get
// Team plans, Performance and Log — limited to the people they may see (the database
// enforces the same rule: contributors for both admins, and Tanvi for Sourabh).
import { NavLink, Outlet, useSearchParams } from "react-router";
import { useLookups, useOpsViewers } from "../lib/api.ts";
import { todayInIndia } from "../lib/format.ts";
import { type Member, useMember } from "../lib/session.tsx";
import { StatePanel } from "../components/States.tsx";
import { TaskDrawer } from "../workspace/TaskDrawer.tsx";
import { DayPlanner } from "./DayPlanner.tsx";

export function DailyOps() {
  const { member } = useMember();
  const isAdmin = member.role === "admin";
  const tabs = [
    { to: "/ops", label: "My day", end: true },
    ...(isAdmin ? [
      { to: "/ops/team", label: "Team plans", end: false },
      { to: "/ops/performance", label: "Performance", end: false },
      { to: "/ops/log", label: "Log", end: false },
    ] : []),
  ];
  return (
    <>
      <header className="ws-head">
        <div>
          <h1>Daily Ops</h1>
          <p className="muted">{isAdmin ? "Plan the workday, record time on tasks, and review the team’s working hours and performance." : "Plan your workday and record time on your tasks."}</p>
        </div>
      </header>
      {tabs.length > 1 && (
        <nav className="ws-tabs" aria-label="Daily Ops views">
          {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "is-on" : undefined)}>{t.label}</NavLink>)}
        </nav>
      )}
      <Outlet />
      <TaskDrawer />
    </>
  );
}

/** The selected day, kept in the URL (?day=YYYY-MM-DD). */
export function useDay(): [string, (d: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("day");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayInIndia();
  return [day, (d) => setParams((p) => { const n = new URLSearchParams(p); if (d === todayInIndia()) n.delete("day"); else n.set("day", d); return n; }, { replace: true })];
}

export function MyDay() {
  const { member } = useMember();
  const [day, setDay] = useDay();
  return <DayPlanner memberId={member.id} day={day} setDay={setDay} />;
}

/** People whose Daily Ops and performance I may see (never myself): admins see contributors, plus explicit grants. */
export function useOpsPeople(): { people: Member[]; ready: boolean } {
  const { member } = useMember();
  const { members } = useLookups();
  const viewers = useOpsViewers();
  if (member.role !== "admin") return { people: [], ready: true };
  const granted = new Set((viewers.data ?? []).map((v) => v.subject_id));
  const people = (members.data ?? []).filter((m) => m.is_active && m.id !== member.id && (m.role === "contributor" || granted.has(m.id)));
  return { people, ready: members.isSuccess && viewers.isSuccess };
}

/** Wraps admin-only views. Contributors never get here from the menu; a typed link shows this. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { member } = useMember();
  if (member.role !== "admin") return <StatePanel title="Only for admins"><p>This view is for Sourabh and Tanvi.</p></StatePanel>;
  return <>{children}</>;
}

export function TeamPlans() {
  return <AdminOnly><TeamPlansInner /></AdminOnly>;
}

function TeamPlansInner() {
  const { people, ready } = useOpsPeople();
  const [params, setParams] = useSearchParams();
  const [day, setDay] = useDay();
  if (!ready) return null;
  const who = people.find((p) => p.id === params.get("who"))?.id ?? people[0]?.id;
  if (!who) return <StatePanel title="Nobody to show"><p>There are no team members whose day you can see.</p></StatePanel>;
  return (
    <>
      <div className="ops-pick" role="group" aria-label="Whose day">
        {people.map((p) => (
          <button key={p.id} type="button" className={`ops-pick__btn${p.id === who ? " is-on" : ""}`} aria-pressed={p.id === who}
            onClick={() => setParams((x) => { const n = new URLSearchParams(x); n.set("who", p.id); return n; }, { replace: true })}>{p.display_name}</button>
        ))}
      </div>
      <DayPlanner memberId={who} day={day} setDay={setDay} />
    </>
  );
}
