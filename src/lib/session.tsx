import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase.ts";

export type AppRole = "admin" | "contributor";

export interface Member {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: AppRole;
  is_active: boolean;
}

export type AccessState =
  | { kind: "not_configured" }
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_access"; email: string | undefined; reason: "not_a_member" | "inactive" }
  | { kind: "error"; message: string }
  | { kind: "member"; session: Session; member: Member };

const SessionContext = createContext<AccessState>({ kind: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const membership = useQuery({
    queryKey: ["membership", userId],
    enabled: Boolean(supabase && userId),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("members")
        .select("id, username, email, display_name, role, is_active")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(describeDbError(error.message));
      return (data as Member | null) ?? null;
    },
  });

  let state: AccessState;
  if (!supabase) state = { kind: "not_configured" };
  else if (session === undefined) state = { kind: "loading" };
  else if (session === null) state = { kind: "signed_out" };
  else if (membership.isPending) state = { kind: "loading" };
  else if (membership.isError) state = { kind: "error", message: membership.error.message };
  else if (!membership.data) state = { kind: "no_access", email: session.user.email, reason: "not_a_member" };
  else if (!membership.data.is_active) state = { kind: "no_access", email: session.user.email, reason: "inactive" };
  else state = { kind: "member", session, member: membership.data };

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useAccess(): AccessState {
  return useContext(SessionContext);
}

export function useMember(): { member: Member; session: Session } {
  const state = useAccess();
  if (state.kind !== "member") throw new Error("useMember() used outside a member-only route");
  return state;
}

/** Turns PostgREST errors into something a user can act on. */
export function describeDbError(message: string): string {
  if (/schema must be one of|Invalid schema/i.test(message)) {
    return "The marketing_os schema is not exposed in the Supabase Data API yet (see docs/SUPABASE_SETUP.md).";
  }
  if (/permission denied/i.test(message)) return "You do not have permission to do this. If you think you should, ask Sourabh or Tanvi.";
  return message;
}
