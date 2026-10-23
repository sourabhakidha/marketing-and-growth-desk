import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicConfig } from "./config.ts";

const config = readPublicConfig();

/**
 * Browser client scoped to the marketing_os schema. Uses the publishable key;
 * everything it can read or write is decided by RLS. Null when not configured.
 */
export const supabase: SupabaseClient<any, "marketing_os"> | null = config
  ? createClient<any, "marketing_os">(config.supabaseUrl, config.supabasePublishableKey, {
      db: { schema: "marketing_os" },
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "akidha-marketing-os-auth" },
    })
  : null;
