import { describe, expect, it } from "vitest";
import { CURRENT_PHASE, MODULES } from "./modules.ts";

describe("modules", () => {
  it("lists the six primary modules plus the Learning Loop once each", () => {
    expect(MODULES.map((m) => m.name)).toEqual([
      "Workspace", "Performance Planning", "Calendar", "Content Radar",
      "Content Opportunities", "AI Intelligence", "Learning Loop",
    ]);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
  });
  it("does not present any module as built in Phase 0", () => {
    expect(MODULES.every((m) => m.phase > CURRENT_PHASE)).toBe(true);
  });
});
