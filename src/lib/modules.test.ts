import { describe, expect, it } from "vitest";
import { isBuilt, MODULES } from "./modules.ts";

describe("modules (D-040)", () => {
  it("has the simplified top navigation, each once", () => {
    expect(MODULES.map((m) => m.name)).toEqual(["Daily Ops", "Workspace", "Ideas", "AI", "Insights"]);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
  });
  it("lists only built modules", () => {
    expect(MODULES.every(isBuilt)).toBe(true);
  });
});
