import { describe, expect, it } from "vitest";
import { looksLikeServiceRoleKey, readPublicConfig } from "./config.ts";

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.y`;

describe("readPublicConfig", () => {
  it("returns null when not configured", () => {
    expect(readPublicConfig({})).toBeNull();
    expect(readPublicConfig({ VITE_SUPABASE_URL: "http://insecure", VITE_SUPABASE_PUBLISHABLE_KEY: "k".repeat(30) })).toBeNull();
  });
  it("accepts a publishable key", () => {
    expect(
      readPublicConfig({ VITE_SUPABASE_URL: "https://abc.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "k".repeat(20) }),
    ).toEqual({ supabaseUrl: "https://abc.supabase.co", supabasePublishableKey: "sb_publishable_" + "k".repeat(20) });
  });
  it("refuses service-role keys in the browser", () => {
    expect(looksLikeServiceRoleKey(jwt("service_role"))).toBe(true);
    expect(looksLikeServiceRoleKey(jwt("anon"))).toBe(false);
    expect(looksLikeServiceRoleKey("sb_secret_abc")).toBe(true);
    expect(() =>
      readPublicConfig({ VITE_SUPABASE_URL: "https://abc.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") + "padpadpadpad" }),
    ).toThrow(/service-role/);
  });
});
