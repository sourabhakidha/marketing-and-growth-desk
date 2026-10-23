import { describe, expect, it } from "vitest";
import { hasForbiddenServerSecrets, integrationStatus, readServerEnv } from "./env.ts";

describe("server env", () => {
  it("is null until both Supabase values are present", () => {
    expect(readServerEnv({})).toBeNull();
    expect(readServerEnv({ SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(
      readServerEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "x".repeat(40) }),
    ).not.toBeNull();
  });
  it("reports status flags without values", () => {
    const status = integrationStatus({ OPENAI_API_KEY: "sk-secret" });
    expect(status).toEqual({ database: "not_configured", ai: "not_configured" });
    expect(JSON.stringify(status)).not.toContain("sk-secret");
  });
  it("flags a service-role key in the deploy environment", () => {
    expect(hasForbiddenServerSecrets({ SUPABASE_SERVICE_ROLE_KEY: "x" })).toBe(true);
    expect(hasForbiddenServerSecrets({})).toBe(false);
  });
});
