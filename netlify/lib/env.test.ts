import { describe, expect, it } from "vitest";
import { aiConfig, DEFAULT_GEMINI_MODEL, hasForbiddenServerSecrets, integrationStatus, readServerEnv } from "./env.ts";

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
    expect(status).toEqual({ database: "not_configured", ai: "not_configured", reddit: "not_configured" });
    expect(JSON.stringify(status)).not.toContain("sk-secret");
  });
  it("flags a service-role key in the deploy environment", () => {
    expect(hasForbiddenServerSecrets({ SUPABASE_SERVICE_ROLE_KEY: "x" })).toBe(true);
    expect(hasForbiddenServerSecrets({})).toBe(false);
  });
});

describe("ai provider config", () => {
  it("prefers Gemini when its key is set, with a default model", () => {
    expect(aiConfig({ GEMINI_API_KEY: "g" })).toEqual({ provider: "gemini", apiKey: "g", model: DEFAULT_GEMINI_MODEL });
    expect(aiConfig({ GEMINI_API_KEY: "g", GEMINI_MODEL: "m" })?.model).toBe("m");
  });
  it("uses OpenAI only with key and model, or when asked explicitly", () => {
    expect(aiConfig({ OPENAI_API_KEY: "o" })).toBeNull();
    expect(aiConfig({ OPENAI_API_KEY: "o", OPENAI_MODEL: "x" })?.provider).toBe("openai");
    expect(aiConfig({ AI_PROVIDER: "openai", GEMINI_API_KEY: "g", OPENAI_API_KEY: "o", OPENAI_MODEL: "x" })?.provider).toBe("openai");
    expect(aiConfig({ AI_PROVIDER: "gemini" })).toBeNull();
    expect(aiConfig({ AI_PROVIDER: "other", GEMINI_API_KEY: "g" })).toBeNull();
  });
  it("reports ai configured for Gemini without exposing the key", () => {
    const s = integrationStatus({ GEMINI_API_KEY: "secret-g" });
    expect(s.ai).toBe("configured");
    expect(JSON.stringify(s)).not.toContain("secret-g");
  });
});
