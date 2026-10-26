import { Link } from "react-router";
import { activeStage, type TaskWithStage, useDrafts, useLatestScan, useLearnings, useLookups, useOpportunities, useSignals, useTasks } from "../lib/api.ts";
import { formatDate, formatDateTime, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { awaitingApproval } from "../lib/permissions.ts";
import { partsOf, RISK_LABEL, rollup } from "../lib/deliverables.ts";
import { useMember } from "../lib/session.tsx";
import { isMyTask, useScope } from "../lib/scope.tsx";
import { Loading } from "../components/States.tsx";
import { oppRef } from "../modules/Opportunities.tsx";
import { Board } from "../workspace/Board.tsx";
import { TaskDrawer } from "../workspace/TaskDrawer.tsx";
import { useGroupBy } from "../workspace/filters.ts";
import { GROUP_OPTIONS, type GroupBy } from "../workspace/phases.ts";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Item { key: string; href: string; ref: string; title: string; meta: string }
interface Group { title: string; empty: string; items: Item[]; more?: string }

const taskItem = (t: TaskWithStage, meta: string): Item => ({ key: t.id, href: `?task=${t.ref}`, ref: taskRef(t.ref), title: t.title, meta });

export function Overview() {
  const { member } = useMember();
  const tasks = useTasks();
  const opps = useOpportunities();
  const learnings = useLearnings();
  const drafts = useDrafts();
  const signals = useSignals(200);
  const scan = useLatestScan();
  const { label, memberName, isAdminMember } = useLookups();
  const isAdmin = member.role === "admin";
  const today = todayInIndia();
  const { isMe } = useScope();
  const mine = <T,>(list: T[], pick: (x: T) => boolean) => (isMe ? list.filter(pick) : list);
  const open = mine((tasks.data ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled"), (t) => isMyTask(t, member.id));
  const due = (t: TaskWithStage) => (t.due_date ? formatDate(t.due_date) : label("task_status", t.status));
  const approvals = open.filter((t) => awaitingApproval(t, { id: member.id, isAdmin, isAdminMember }));
  const approvalMeta = (t: TaskWithStage) => {
    const s = activeStage(t);
    const where = t.status === "in_review" ? "Submitted" : s ? `${label("workflow_stage", s.stage_code)} · ${memberName(s.owner_id)}` : "";
    return t.due_date ? `${where} · ${formatDate(t.due_date)}` : where;
  };

  const requests = open.filter((t) => t.status === "requested" && (isAdmin || t.created_by === member.id));
  const atRisk = open.filter((t) => t.kind === "deliverable").map((d) => ({ d, r: rollup(d, partsOf(d.id, tasks.data ?? []), today) }))
    .filter((x) => x.r.risk === "blocked" || x.r.risk === "at_risk");
  const groups: Group[] = [
    { title: "Deliverables at risk", empty: "No deliverable at risk.", more: "/workspace/deliverables",
      items: atRisk.map(({ d, r }) => taskItem(d, `${RISK_LABEL[r.risk]}: ${r.reasons[0] ?? ""}`)) },
    { title: isAdmin ? "Task requests to review" : "Your task requests", empty: isAdmin ? "No requests waiting." : "No requests waiting for acceptance.", more: "/workspace/list?status=requested",
      items: requests.map((t) => taskItem(t, isAdmin ? `from ${memberName(t.created_by)}` : "awaiting acceptance")) },
    { title: "Waiting for you to pick up", empty: "Nothing handed to you.", more: "/workspace/list?mine=1",
      // review work handed to an admin is listed once, under approvals
      items: open.filter((t) => { const s = activeStage(t); return s?.owner_id === member.id && !s.picked_up_at && !approvals.includes(t); }).map((t) => taskItem(t, due(t))) },
    { title: isAdmin ? "Tasks awaiting your approval" : "Your work awaiting approval", empty: "Nothing in review.", more: "/workspace/list?status=in_review",
      items: approvals.map((t) => taskItem(t, approvalMeta(t))) },
    { title: "Changes requested", empty: "No returned work.", more: "/workspace/list?status=changes_requested",
      items: open.filter((t) => t.status === "changes_requested" && (isAdmin || t.owner_id === member.id)).map((t) => taskItem(t, due(t))) },
    { title: "Blocked", empty: "Nothing blocked.", more: "/workspace/list?status=blocked", items: open.filter((t) => t.status === "blocked").map((t) => taskItem(t, t.blocker_reason ?? "")) },
    { title: "Overdue", empty: "Nothing overdue.", more: "/workspace/list?due=overdue", items: open.filter((t) => isOverdue(t.due_date, t.status, today)).map((t) => taskItem(t, due(t))) },
    { title: "Due or publishing in 7 days", empty: "Nothing scheduled this week.", more: "/workspace/calendar",
      items: open.filter((t) => [t.due_date, t.publish_date].some((d) => d && d >= today && d <= addDays(today, 7)))
        .map((t) => taskItem(t, t.publish_date && t.publish_date >= today && t.publish_date <= addDays(today, 7) ? `publish ${formatDate(t.publish_date)}` : `due ${formatDate(t.due_date)}`)) },
  ];
  if (isAdmin) {
    groups.push({ title: "Opportunities awaiting decision", empty: "No ideas waiting.", more: "/opportunities",
      items: mine(opps.data ?? [], (o) => o.created_by === member.id).filter((o) => o.status === "considering" || o.status === "needs_research")
        .map((o) => ({ key: o.id, href: `/opportunities/${o.ref}`, ref: oppRef(o.ref), title: o.title, meta: o.status === "needs_research" ? "needs research" : "considering" })) });
    groups.push({ title: "Learnings to review", empty: "Nothing to review.", more: "/insights/learnings",
      items: mine(learnings.data ?? [], (l) => l.created_by === member.id || l.owner_id === member.id).filter((l) => l.status === "pending_review")
        .map((l) => ({ key: l.id, href: "/insights/learnings", ref: `L-${l.ref}`, title: l.title, meta: formatDate(l.created_at) })) });
  }
  groups.push({ title: "Your AI drafts ready", empty: "No drafts waiting.", more: "/intelligence",
    items: (drafts.data ?? []).filter((d) => d.created_by === member.id && d.status === "ready")
      .map((d) => ({ key: d.id, href: `/intelligence/drafts/${d.ref}`, ref: `D-${d.ref}`, title: d.output?.working_title ?? d.kind, meta: formatDate(d.created_at) })) });
  const newSignals = mine(signals.data ?? [], (s) => s.collected_by === member.id).filter((s) => s.status === "new");
  groups.push({ title: "New Radar signals", empty: scan.data ? "Nothing new since the last scan." : "Radar has not been scanned yet.", more: "/radar",
    items: newSignals.map((s) => ({ key: s.id, href: "/radar", ref: `S-${s.ref}`, title: s.title, meta: s.published_at ? formatDate(s.published_at) : "date unknown" })) });

  const needs = groups.filter((g) => g.items.length > 0);

  return (
    <>
      <header className="page-header">
        <h1>Good to see you, {member.display_name.split(" ")[0]}</h1>
        <p className="muted">My day: what needs you now, then all the work.
          {scan.data?.finished_at && <> Radar last scanned {formatDateTime(scan.data.finished_at)}.</>}</p>
      </header>

      {tasks.isPending ? <Loading /> : needs.length === 0 ? (
        <section className="card allclear"><strong>All clear.</strong> <span className="muted">Nothing is waiting on you right now.</span></section>
      ) : (
        <section className="attention-grid" aria-label="Needs you">
          {needs.map((g) => (
            <div key={g.title} className="card attention">
              <h2>{g.title} <span className="count">{g.items.length}</span></h2>
              <ul>
                {g.items.slice(0, 4).map((i) => (
                  <li key={i.key}>
                    <Link to={i.href}>{i.title}</Link>
                    <span className="muted small">{i.meta}</span>
                  </li>
                ))}
                {g.items.length > 4 && g.more && <li><Link to={g.more}>+{g.items.length - 4} more</Link></li>}
              </ul>
            </div>
          ))}
        </section>
      )}

      <div className="myday-board__head section-title">
        <h2>All work</h2>
        <GroupBySelect />
        <Link className="link small" to="/workspace">Open the Workspace</Link>
      </div>
      <Board />
      <TaskDrawer />
    </>
  );
}

function GroupBySelect() {
  const [group, setGroup] = useGroupBy();
  return (
    <label className="wsbar__group">
      <span className="small muted">Group by</span>
      <select value={group} onChange={(e) => setGroup(e.target.value as GroupBy)} aria-label="Group by">
        {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
