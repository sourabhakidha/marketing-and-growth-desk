import { describe, expect, it } from "vitest";
import { isBuilt, MODULES } from "./modules.ts";

describe("modules", () => {
  it("lists the six primary modules plus the Learning Loop once each", () => {
    expect(MODULES.map((m) => m.name)).toEqual([
      "Workspace", "Performance Planning", "Calendar", "Content Radar",
      "Content Opportunities", "AI Intelligence", "Learning Loop",
    ]);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
  });
  it("marks only the Workspace as built in Phase 1", () => {
    expect(MODULES.filter(isBuilt).map((m) => m.name)).toEqual(["Workspace"]);
  });
});
