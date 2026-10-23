import { describe, expect, it } from "vitest";
import { validateNewPassword } from "./password.ts";

describe("validateNewPassword", () => {
  it("enforces length and confirmation", () => {
    expect(validateNewPassword("short", "short", "ab")).toMatch(/12/);
    expect(validateNewPassword("long-enough-pass", "different-pass!", "ab")).toMatch(/match/);
  });
  it("rejects passwords containing the username", () => {
    expect(validateNewPassword("tanvi-2026-secure", "tanvi-2026-secure", "tanvi")).toMatch(/username/);
  });
  it("accepts a strong password", () => {
    expect(validateNewPassword("Saffron-forest-91!", "Saffron-forest-91!", "tanvi")).toBeNull();
  });
});
