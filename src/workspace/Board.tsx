// Board (D-040): five plain phases; the workflow stage is a chip on the card.
// Group by deliverable / owner / goal / channel / type gives one band per group.
import { useMemo } from "react";
import { type TaskWithStage, useGoals, useLookups, useTasks } from "../lib/api.ts";
import { deadlineOf, partsOf, RISK_LABEL, rollup } from "../lib/deliverables.ts";
import {formatDate, isOverdue, todayInIndia} from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { useScope } from "../lib/scope.tsx";
import { PriorityMark } from "../components/Badges.tsx";
import { DeleteButton } from "../components/DeleteButton.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useGroupBy, useTaskFilters, useTaskPanel } from "./filters.ts";
import { groupTasks, type Phase, phaseOf, PHASES, stageStep } from "./phases.ts";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function Board() {
  const tasks = useTasks();
  const goals = useGoals();
  const { label, memberName, isAdminMember, ready } = useLookups();
  const { member: me } = useMember();
  const { scope } = useScope();
  const { f } = useTaskFilters();
  const [group] = useGroupBy();
  const panel = useTaskPanel();
  const today = todayInIndia();
  const all = (tasks.data ?? []) as TaskWithStage[];

  const items = useMemo(() => all.filter((t) => t.kind !== "deliverable" && matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data })),
    [all, f, me.id, today, scope]);
  const deliverables = useMemo(() => all.filter((t) => t.kind === "deliverable" && t.status !== "cancelled"
    && (group !== "deliverable" || items.some((p) => p.parent_id === t.id) || matchesFilters(t, f, { meId: me.id, today, scope, all: tasks.data }))), [all, items, group, f, me.id, today, scope]);

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;
  if (all.length === 0) return <StatePanel title="No work yet"><p>Use <strong>+ Create new</strong> to add the first task or deliverable.</p></StatePanel>;

  const groups = groupTasks(items, group, { all, goals: goals.data ?? [], label, memberName, deliverables });
  const counts = Object.fromEntries(PHASES.map((p) => [p.key, items.filter((t) => phaseOf(t, isAdminMember) === p.key).length])) as Record<Phase, number>;

  return (
    <div className="wboard">
      <div className="wboard__head" role="row">
        {group !== "none" && <span className="wboard__lanehead" aria-hidden="true" />}
        {PHASES.map((p) => (
          <div key={p.key} className={`wboard__colhead wboard__colhead--${p.key}`} title={p.hint}>
            <span>{p.label}</span><span className="wboard__count">{counts[p.key]}</span>
          </div>
        ))}
      </div>
      {groups.map((g) => {
        const r = g.deliverable ? rollup(g.deliverable, partsOf(g.deliverable.id, all), today) : null;
        return (
          <section key={g.key} className={`wboard__lane${group === "none" ? " wboard__lane--flat" : ""}`} aria-label={g.title || "All work"}>
            {group !== "none" && (
              <header className="wboard__lanehead">
                {g.deliverable ? (
                  <button type="button" className="lane-title link" onClick={() => panel.open(g.deliverable!.ref)}>{g.title}</button>
                ) : <span className="lane-title">{g.title}</span>}
                <span className="small muted">{g.tasks.length} {g.tasks.length === 1 ? "item" : "items"}</span>
                {r && g.deliverable && (
                  <span className="lane-meta">
                    <span className={`risk risk--${r.risk}`}>{RISK_LABEL[r.risk]}</span>
                    <span className="small">{r.done}/{r.total - r.cancelled} tasks done</span>
                    {deadlineOf(g.deliverable) && <span className="small muted">lands {formatDate(deadlineOf(g.deliverable))}</span>}
                  </span>
                )}
              </header>
            )}
            {PHASES.map((p) => {
              const cell = g.tasks.filter((t) => phaseOf(t, isAdminMember) === p.key);
              return (
                <div key={p.key} className="wboard__cell" aria-label={`${p.label}: ${cell.length}`}>
                  {cell.map((t) => (
                    <Card key={t.id} t={t} today={today} label={label} memberName={memberName} selected={t.ref === panel.ref}
                      partOf={group !== "deliverable" && t.parent_id ? all.find((x) => x.id === t.parent_id)?.title : undefined}
                      onOpen={() => panel.open(t.ref)} />
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
      {items.length === 0 && <p className="muted small wboard__empty">Nothing matches these filters.</p>}
    </div>
  );
}

function Card({ t, today, label, memberName, selected, partOf, onOpen }: {
  t: TaskWithStage; today: string; selected: boolean; partOf?: string;
  label: (v: string, c: string | null | undefined) => string; memberName: (id: string | null | undefined) => string; onOpen: () => void;
}) {
  const step = stageStep(t);
  const stage = t.task_stages.find((s) => s.state === "active");
  const overdue = isOverdue(t.due_date, t.status, today);
  const waiting = stage && stage.owner_id && !stage.picked_up_at && t.status !== "blocked" && t.status !== "requested";
  const who = stage?.owner_id ?? t.owner_id;
  return (
    <div className="card-wrap">
    <button type="button" className={`bcard${selected ? " is-selected" : ""}${t.status === "blocked" ? " is-blocked" : ""}`} onClick={onOpen}
      aria-label={`${t.title}. ${label("task_status", t.status)}.`}>
      <span className="bcard__top">
        <PriorityMark code={t.priority} label={label("priority", t.priority)} />
      </span>
      <span className="bcard__title">{t.title}</span>
      {partOf && <span className="bcard__partof">↳ {partOf}</span>}
      {step && <span className="bcard__stage">{label("workflow_stage", step.code)} · {step.step}/{step.of}</span>}
      <span className="bcard__flags">
        {t.status === "blocked" && <span className="flagchip flagchip--blocked" title={t.blocker_reason ?? undefined}>Blocked</span>}
        {t.status === "changes_requested" && <span className="flagchip flagchip--warn">Changes requested</span>}
        {waiting && <span className="flagchip">Waiting pick-up</span>}
        {stage && stage.revision_count > 0 && <span className="flagchip flagchip--warn">Rework ×{stage.revision_count}</span>}
        {t.channel && <span className="flagchip flagchip--plain">{label("channel", t.channel)}</span>}
      </span>
      <span className="bcard__foot">
        <span className="who"><span className="avatar" aria-hidden="true">{initials(memberName(who))}</span>{memberName(who)}</span>
        <span className={overdue ? "due due--late" : "due"}>{t.due_date ? `${overdue ? "Overdue · " : ""}${formatDate(t.due_date)}` : ""}</span>
      </span>
    </button>
    <DeleteButton kind="task" id={t.id} title={t.title} className="icon-button del-btn del-btn--card" />
    </div>
  );
}
