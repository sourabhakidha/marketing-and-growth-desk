import { Link } from "react-router";
import { activeStage, type TaskWithStage, useLookups, useTasks } from "../lib/api.ts";
import { formatDate, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { isBuilt, MODULES } from "../lib/modules.ts";
import { useMember } from "../lib/session.tsx";
import { Loading } from "../components/States.tsx";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function Overview() {
  const { member } = useMember();
  const tasks = useTasks();
  const { label } = useLookups();
  const isAdmin = member.role === "admin";
  const today = todayInIndia();
  const all = tasks.data ?? [];
  const open = all.filter((t) => t.status !== "done" && t.status !== "cancelled");

  const groups: { title: string; empty: string; items: TaskWithStage[] }[] = [
    { title: "Waiting for you to pick up", empty: "Nothing handed to you.",
      items: open.filter((t) => { const s = activeStage(t); return s?.owner_id === member.id && !s.picked_up_at; }) },
    { title: isAdmin ? "Awaiting your approval" : "Your work awaiting approval", empty: "Nothing in review.",
      items: open.filter((t) => t.status === "in_review" && (isAdmin || t.owner_id === member.id)) },
    { title: "Changes requested", empty: "No returned work.",
      items: open.filter((t) => t.status === "changes_requested" && (isAdmin || t.owner_id === member.id)) },
    { title: "Blocked", empty: "Nothing blocked.", items: open.filter((t) => t.status === "blocked") },
    { title: "Overdue", empty: "Nothing overdue.", items: open.filter((t) => isOverdue(t.due_date, t.status, today)) },
    { title: "Due in the next 7 days", empty: "Nothing due this week.",
      items: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7)) },
  ];

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Sense → Interpret → Decide → Execute → Learn</p>
        <h1>Welcome, {member.display_name.split(" ")[0]}</h1>
        <p className="muted">What needs attention now. Every item links to its task; counts come from live Workspace records.</p>
      </header>

      {tasks.isPending ? <Loading /> : (
        <section className="attention-grid" aria-label="Needs attention">
          {groups.map((g) => (
            <div key={g.title} className="card attention">
              <h2>{g.title} <span className="count">{g.items.length}</span></h2>
              {g.items.length === 0 ? <p className="muted small">{g.empty}</p> : (
                <ul>
                  {g.items.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      <Link to={`/workspace/tasks/${t.ref}`}><span className="ref">{taskRef(t.ref)}</span> {t.title}</Link>
                      <span className="muted small">{t.due_date ? formatDate(t.due_date) : label("task_status", t.status)}</span>
                    </li>
                  ))}
                  {g.items.length > 6 && <li><Link to="/workspace">+{g.items.length - 6} more on the board</Link></li>}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      <h2 className="section-title">Modules</h2>
      <section className="module-grid" aria-label="Modules">
        {MODULES.map((m) => (
          <Link key={m.path} to={m.path} className={`module-card${isBuilt(m) ? "" : " module-card--planned"}`}>
            <span className={`pill${isBuilt(m) ? "" : " pill--muted"}`}>{isBuilt(m) ? "Live" : `Planned · Phase ${m.phase}`}</span>
            <h3>{m.name}</h3>
            <p>{m.question}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
