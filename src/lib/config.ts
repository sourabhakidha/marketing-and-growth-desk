// Browser configuration. Only PUBLIC values may live here (they ship in the bundle).
export interface PublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function readPublicConfig(env: Record<string, unknown> = import.meta.env): PublicConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const key = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string" ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim() : "";
  if (!/^https:\/\/[^/]+$/.test(url) || key.length < 20) return null;
  // Defence in depth: refuse a service-role JWT if one is pasted here by mistake.
  if (looksLikeServiceRoleKey(key)) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY looks like a service-role key. Use the publishable (anon) key.");
  }
  return { supabaseUrl: url, supabasePublishableKey: key };
}

export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded?.role === "service_role";
  } catch {
    return false;
  }
}
