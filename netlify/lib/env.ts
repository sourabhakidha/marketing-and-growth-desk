import { z } from "zod";

// Server-side configuration. Values are read per request so that a missing
// variable produces a visible "not configured" state instead of a crash.
const serverEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv | null {
  const parsed = serverEnvSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

/** Integration states shown to users (Bible §14.2 / §18.3). Booleans only — never values. */
export function integrationStatus(source: Record<string, string | undefined> = process.env) {
  return {
    database: readServerEnv(source) ? "configured" : "not_configured",
    ai: source.OPENAI_API_KEY && source.OPENAI_MODEL ? "configured" : "not_configured",
  } as const;
}

/** Guard against accidentally deploying the project-wide service-role key to Netlify. */
export function hasForbiddenServerSecrets(source: Record<string, string | undefined> = process.env): boolean {
  return Boolean(source.SUPABASE_SERVICE_ROLE_KEY);
}
