import { Link } from "react-router";
import { activeStage, type TaskWithStage, useDrafts, useLatestScan, useLearnings, useLookups, useOpportunities, useSignals, useTasks } from "../lib/api.ts";
import { formatDate, formatDateTime, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { isBuilt, MODULES } from "../lib/modules.ts";
import { useMember } from "../lib/session.tsx";
import { Loading } from "../components/States.tsx";
import { oppRef } from "../modules/Opportunities.tsx";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Item { key: string; href: string; ref: string; title: string; meta: string }
interface Group { title: string; empty: string; items: Item[]; more?: string }

const taskItem = (t: TaskWithStage, meta: string): Item => ({ key: t.id, href: `/workspace/tasks/${t.ref}`, ref: taskRef(t.ref), title: t.title, meta });

export function Overview() {
  const { member } = useMember();
  const tasks = useTasks();
  const opps = useOpportunities();
  const learnings = useLearnings();
  const drafts = useDrafts();
  const signals = useSignals(200);
  const scan = useLatestScan();
  const { label } = useLookups();
  const isAdmin = member.role === "admin";
  const today = todayInIndia();
  const open = (tasks.data ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled");
  const due = (t: TaskWithStage) => (t.due_date ? formatDate(t.due_date) : label("task_status", t.status));

  const groups: Group[] = [
    { title: "Waiting for you to pick up", empty: "Nothing handed to you.", more: "/workspace",
      items: open.filter((t) => { const s = activeStage(t); return s?.owner_id === member.id && !s.picked_up_at; }).map((t) => taskItem(t, due(t))) },
    { title: isAdmin ? "Tasks awaiting your approval" : "Your work awaiting approval", empty: "Nothing in review.", more: "/workspace",
      items: open.filter((t) => t.status === "in_review" && (isAdmin || t.owner_id === member.id)).map((t) => taskItem(t, due(t))) },
    { title: "Changes requested", empty: "No returned work.", more: "/workspace",
      items: open.filter((t) => t.status === "changes_requested" && (isAdmin || t.owner_id === member.id)).map((t) => taskItem(t, due(t))) },
    { title: "Blocked", empty: "Nothing blocked.", more: "/workspace", items: open.filter((t) => t.status === "blocked").map((t) => taskItem(t, t.blocker_reason ?? "")) },
    { title: "Overdue", empty: "Nothing overdue.", more: "/calendar", items: open.filter((t) => isOverdue(t.due_date, t.status, today)).map((t) => taskItem(t, due(t))) },
    { title: "Due or publishing in 7 days", empty: "Nothing scheduled this week.", more: "/calendar",
      items: open.filter((t) => [t.due_date, t.publish_date].some((d) => d && d >= today && d <= addDays(today, 7)))
        .map((t) => taskItem(t, t.publish_date && t.publish_date >= today && t.publish_date <= addDays(today, 7) ? `publish ${formatDate(t.publish_date)}` : `due ${formatDate(t.due_date)}`)) },
  ];
  if (isAdmin) {
    groups.push({ title: "Opportunities awaiting decision", empty: "No ideas waiting.", more: "/opportunities",
      items: (opps.data ?? []).filter((o) => o.status === "considering" || o.status === "needs_research")
        .map((o) => ({ key: o.id, href: `/opportunities/${o.ref}`, ref: oppRef(o.ref), title: o.title, meta: o.status === "needs_research" ? "needs research" : "considering" })) });
    groups.push({ title: "Learnings to review", empty: "Nothing to review.", more: "/learning",
      items: (learnings.data ?? []).filter((l) => l.status === "pending_review")
        .map((l) => ({ key: l.id, href: "/learning", ref: `L-${l.ref}`, title: l.title, meta: formatDate(l.created_at) })) });
  }
  groups.push({ title: "Your AI drafts ready", empty: "No drafts waiting.", more: "/intelligence",
    items: (drafts.data ?? []).filter((d) => d.created_by === member.id && d.status === "ready")
      .map((d) => ({ key: d.id, href: `/intelligence/drafts/${d.ref}`, ref: `D-${d.ref}`, title: d.output?.working_title ?? d.kind, meta: formatDate(d.created_at) })) });
  const newSignals = (signals.data ?? []).filter((s) => s.status === "new");
  groups.push({ title: "New Radar signals", empty: scan.data ? "Nothing new since the last scan." : "Radar has not been scanned yet.", more: "/radar",
    items: newSignals.map((s) => ({ key: s.id, href: "/radar", ref: `S-${s.ref}`, title: s.title, meta: s.published_at ? formatDate(s.published_at) : "date unknown" })) });

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Sense → Interpret → Decide → Execute → Learn</p>
        <h1>Welcome, {member.display_name.split(" ")[0]}</h1>
        <p className="muted">What needs attention now. Every item links to its record; counts come from live data.
          {scan.data?.finished_at && <> Radar last scanned {formatDateTime(scan.data.finished_at)}.</>}</p>
      </header>

      {tasks.isPending ? <Loading /> : (
        <section className="attention-grid" aria-label="Needs attention">
          {groups.map((g) => (
            <div key={g.title} className="card attention">
              <h2>{g.title} <span className="count">{g.items.length}</span></h2>
              {g.items.length === 0 ? <p className="muted small">{g.empty}</p> : (
                <ul>
                  {g.items.slice(0, 5).map((i) => (
                    <li key={i.key}>
                      <Link to={i.href}><span className="ref">{i.ref}</span> {i.title}</Link>
                      <span className="muted small">{i.meta}</span>
                    </li>
                  ))}
                  {g.items.length > 5 && g.more && <li><Link to={g.more}>+{g.items.length - 5} more</Link></li>}
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
            <span className={`pill${isBuilt(m) ? "" : " pill--muted"}`}>{isBuilt(m) ? "Live" : "Later"}</span>
            <h3>{m.name}</h3>
            <p>{m.question}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
