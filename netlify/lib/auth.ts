import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bearerToken, HttpError } from "./http.ts";
import { readServerEnv } from "./env.ts";

export type AppRole = "admin" | "contributor";

export interface MemberContext {
  userId: string;
  memberId: string;
  username: string;
  displayName: string;
  role: AppRole;
  /** Supabase client acting AS the caller: every query is subject to RLS. */
  db: SupabaseClient<any, "marketing_os">;
}

/**
 * Verifies the caller's Supabase session and their Marketing OS membership.
 * Uses the caller's own JWT (never the service-role key), so the database
 * enforces the same RLS rules as the browser.
 */
export async function requireMember(req: Request, opts: { role?: AppRole } = {}): Promise<MemberContext> {
  const env = readServerEnv();
  if (!env) throw new HttpError("not_configured", "Supabase is not configured for server functions");

  const token = bearerToken(req);
  if (!token) throw new HttpError("unauthenticated", "Sign in required");

  const db = createClient<any, "marketing_os">(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "marketing_os" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError("unauthenticated", "Session is invalid or expired");

  const { data: member, error: memberError } = await db
    .from("members")
    .select("id, username, display_name, role, is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (memberError) throw new HttpError("upstream_error", "Could not verify membership");
  if (!member || !member.is_active) throw new HttpError("not_a_member", "You do not have access to Marketing OS");
  if (opts.role === "admin" && member.role !== "admin") throw new HttpError("forbidden", "Admin access required");

  return {
    userId: userData.user.id,
    memberId: member.id,
    username: member.username,
    displayName: member.display_name,
    role: member.role,
    db,
  };
}
