// Team / Me view switch (D-034). Everyone can see all work; "Me" only narrows
// what each section shows to the signed-in person's own work. Remembered per
// browser; it never changes access.
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

export type Scope = "team" | "me";
const KEY = "marketing-desk.scope";

const ScopeContext = createContext<{ scope: Scope; setScope: (s: Scope) => void }>({ scope: "team", setScope: () => {} });

function stored(): Scope {
  try { return localStorage.getItem(KEY) === "me" ? "me" : "team"; } catch { return "team"; }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>(stored);
  useEffect(() => { try { localStorage.setItem(KEY, scope); } catch { /* private mode: keep in memory only */ } }, [scope]);
  return <ScopeContext.Provider value={{ scope, setScope }}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const { scope, setScope } = useContext(ScopeContext);
  return { scope, setScope, isMe: scope === "me" };
}

/** The Team / Me switch shown in the top bar. */
export function ScopeSwitch() {
  const { scope, setScope } = useScope();
  return (
    <div className="scope-switch" role="group" aria-label="Show work for">
      <button type="button" className={scope === "team" ? "is-on" : undefined} aria-pressed={scope === "team"} onClick={() => setScope("team")}>Team</button>
      <button type="button" className={scope === "me" ? "is-on" : undefined} aria-pressed={scope === "me"} onClick={() => setScope("me")}>Me</button>
    </div>
  );
}

// ---------------------------------------------------------------- what counts as "mine"
interface TaskLike {
  owner_id: string; created_by: string; reviewer_id?: string | null;
  task_stages?: { owner_id: string | null }[];
}

/** A task is mine if I own it, created/requested it, review it, or hold or held one of its stages. */
export function isMyTask(t: TaskLike, meId: string): boolean {
  return t.owner_id === meId || t.created_by === meId || t.reviewer_id === meId
    || Boolean(t.task_stages?.some((s) => s.owner_id === meId));
}

/** A goal is mine if I own it or one of my tasks is linked to it. */
export function isMyGoal(g: { id: string; owner_id: string }, myTaskGoalIds: Set<string>, meId: string): boolean {
  return g.owner_id === meId || myTaskGoalIds.has(g.id);
}
