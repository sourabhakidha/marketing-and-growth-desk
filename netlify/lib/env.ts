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
    ai: aiConfig(source) ? "configured" : "not_configured",
    reddit: source.REDDIT_CLIENT_ID && source.REDDIT_CLIENT_SECRET ? "configured" : "not_configured",
  } as const;
}

/** Guard against accidentally deploying the project-wide service-role key to Netlify. */
export function hasForbiddenServerSecrets(source: Record<string, string | undefined> = process.env): boolean {
  return Boolean(source.SUPABASE_SERVICE_ROLE_KEY);
}

export type AiProvider = "gemini" | "openai";
export interface AiConfig { provider: AiProvider; apiKey: string; model: string }

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * AI provider settings (D-024), or null when not configured (the UI then shows "not configured").
 * AI_PROVIDER picks the provider; without it, Gemini is used when GEMINI_API_KEY is set, else OpenAI.
 */
export function aiConfig(source: Record<string, string | undefined> = process.env): AiConfig | null {
  const requested = source.AI_PROVIDER?.trim().toLowerCase();
  const provider: AiProvider | null =
    requested === "gemini" || requested === "openai" ? requested
    : requested ? null
    : source.GEMINI_API_KEY?.trim() ? "gemini" : "openai";
  if (provider === "gemini") {
    const apiKey = source.GEMINI_API_KEY?.trim();
    const model = source.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return apiKey ? { provider, apiKey, model } : null;
  }
  if (provider === "openai") {
    const apiKey = source.OPENAI_API_KEY?.trim();
    const model = source.OPENAI_MODEL?.trim();
    return apiKey && model ? { provider, apiKey, model } : null;
  }
  return null;
}
