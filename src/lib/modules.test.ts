import { describe, expect, it } from "vitest";
import { isBuilt, MODULES } from "./modules.ts";

describe("modules", () => {
  it("lists the six primary modules plus the Learning Loop once each", () => {
    expect([...MODULES.map((m) => m.name)].sort()).toEqual([
      "AI Intelligence", "Calendar", "Content Opportunities", "Content Radar", "Learning Loop", "Performance Planning", "Workspace",
    ]);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
  });
  it("only Performance Planning is not built (deferred)", () => {
    expect(MODULES.filter((m) => !isBuilt(m)).map((m) => m.name)).toEqual(["Performance Planning"]);
  });
});
