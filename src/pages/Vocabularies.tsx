import { useQuery } from "@tanstack/react-query";
import { describeDbError } from "../lib/session.tsx";
import { supabase } from "../lib/supabase.ts";
import { Loading, StatePanel } from "../components/States.tsx";

interface Term { id: string; vocabulary: string; code: string; label: string; sort_order: number; is_active: boolean }

const TITLES: Record<string, string> = {
  task_type: "Task types",
  work_origin: "Work origins",
  task_status: "Task statuses",
  goal_status: "Goal statuses",
  priority: "Priorities",
  workflow_stage: "Workflow stages",
  performance_area: "Performance areas",
};

export function Vocabularies() {
  const terms = useQuery({
    queryKey: ["vocab_terms"],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("vocab_terms")
        .select("id, vocabulary, code, label, sort_order, is_active")
        .order("vocabulary")
        .order("sort_order");
      if (error) throw new Error(describeDbError(error.message));
      return data as Term[];
    },
  });

  const groups = new Map<string, Term[]>();
  for (const t of terms.data ?? []) groups.set(t.vocabulary, [...(groups.get(t.vocabulary) ?? []), t]);

  return (
    <>
      <header className="page-header">
        <h1>Vocabularies</h1>
        <p className="muted">
          Controlled values used across modules. Task type, work origin, status, stage and priority are separate
          fields and are never combined. Seeded from the Team Roles &amp; Workflow Playbook (decision D-004).
        </p>
      </header>
      {terms.isPending && <Loading />}
      {terms.isError && <StatePanel title="Could not load vocabularies" tone="error"><p>{terms.error.message}</p></StatePanel>}
      <div className="vocab-grid">
        {[...groups.entries()].map(([vocab, list]) => (
          <section key={vocab} className="card">
            <h2>{TITLES[vocab] ?? vocab}</h2>
            <ol>
              {list.map((t) => (
                <li key={t.id} className={t.is_active ? undefined : "muted"}>
                  {t.label}{!t.is_active && " (inactive)"}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
