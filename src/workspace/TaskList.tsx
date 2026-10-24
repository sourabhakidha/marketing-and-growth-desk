import { useMemo, useState } from "react";
import { useGoals, useLookups, useTasks } from "../lib/api.ts";
import { formatDate, goalRef, isOverdue, taskRef, todayInIndia } from "../lib/format.ts";
import { useMember } from "../lib/session.tsx";
import { PriorityMark, StatusBadge } from "../components/Badges.tsx";
import { Loading, StatePanel } from "../components/States.tsx";
import { matchesFilters, useTaskFilters, useTaskPanel } from "./filters.ts";
import { currentStage, nextStepOwner } from "./pipeline.ts";

type SortKey = "ref" | "due" | "priority" | "stage";
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function TaskList() {
  const tasks = useTasks();
  const goals = useGoals();
  const { label, memberName, options, ready } = useLookups();
  const { member: me } = useMember();
  const { f } = useTaskFilters();
  const panel = useTaskPanel();
  const today = todayInIndia();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "due", asc: true });

  const stageRank = useMemo(() => new Map(options("workflow_stage").map((o) => [o.code, o.sort_order])), [options]);
  const rows = useMemo(() => {
    const list = (tasks.data ?? []).filter((t) => matchesFilters(t, f, { meId: me.id, today }));
    const val = (t: (typeof list)[number]): string | number => {
      if (sort.key === "ref") return t.ref;
      if (sort.key === "due") return t.due_date ?? "9999-99-99";
      if (sort.key === "priority") return PRIORITY_RANK[t.priority ?? ""] ?? 9;
      return stageRank.get(currentStage(t)?.stage_code ?? "") ?? 999;
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : b.ref - a.ref;
      return sort.asc ? c : -c;
    });
  }, [tasks.data, f, me.id, today, sort, stageRank]);

  if (tasks.isPending || !ready) return <Loading />;
  if (tasks.isError) return <StatePanel title="Could not load tasks" tone="error"><p>{tasks.error.message}</p></StatePanel>;

  const head = (key: SortKey, text: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.asc ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {text}{sort.key === key ? (sort.asc ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return rows.length === 0 ? <StatePanel title="No tasks match these filters" /> : (
    <div className="table-wrap">
      <table className="task-table">
        <thead>
          <tr>
            {head("ref", "Task")}
            {head("stage", "Stage")}
            <th scope="col">Next step</th>
            <th scope="col">Status</th>
            {head("priority", "Priority")}
            <th scope="col">Type</th>
            {head("due", "Due")}
            <th scope="col">Goal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const stage = currentStage(t);
            const owner = nextStepOwner(t);
            const goal = goals.data?.find((g) => g.id === t.goal_id);
            const late = isOverdue(t.due_date, t.status, today);
            return (
              <tr key={t.id} className={t.ref === panel.ref ? "is-selected" : undefined}>
                <td className="wrap">
                  <button type="button" className="row-link" onClick={() => panel.open(t.ref)}>
                    <span className="ref">{taskRef(t.ref)}</span> {t.title}
                  </button>
                  {t.status === "blocked" && <div className="small task-table__blocker">Blocked: {t.blocker_reason ?? "reason not recorded"}</div>}
                </td>
                <td>{stage ? label("workflow_stage", stage.stage_code) : t.status === "done" ? "Done" : "—"}{stage && stage.owner_id && !stage.picked_up_at && t.status !== "blocked" && <span className="tag tag--wait">waiting</span>}</td>
                <td>{owner ? memberName(owner) : t.status === "in_review" ? "Admin approval" : "—"}</td>
                <td><StatusBadge code={t.status} label={label("task_status", t.status)} /></td>
                <td><PriorityMark code={t.priority} label={label("priority", t.priority)} /></td>
                <td>{label("task_type", t.task_type)}</td>
                <td className={late ? "due--late" : undefined}>{t.due_date ? formatDate(t.due_date) : "—"}</td>
                <td className="wrap">{goal ? `${goalRef(goal.ref)} · ${goal.title}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
