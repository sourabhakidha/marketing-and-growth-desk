import { describe, expect, it } from "vitest";
import { callModel } from "./ai.ts";
import { collectRefs, goalSpec, normalizeBrief, normalizeGoalAssessment, normalizeTaskAssessment, taskMessages, taskSpec } from "./impact.ts";

describe("task assessment normaliser", () => {
  it("keeps valid ratings and their reasons", () => {
    const a = normalizeTaskAssessment({ expected_impact: { rating: "High", reasoning: "Caregiver ads converted before" }, missing_information: ["baseline"] });
    expect(a.expected_impact).toEqual({ rating: "high", reasoning: "Caregiver ads converted before" });
    expect(a.missing_information).toEqual(["baseline"]);
  });
  it("turns unknown or unexplained ratings into an explicit 'can't tell'", () => {
    const a = normalizeTaskAssessment({ expected_impact: { rating: "guaranteed" }, evidence_strength: "proven" });
    expect(a.expected_impact.rating).toBe("unclear");
    expect(a.expected_impact.reasoning).toMatch(/unexplained/);
    expect(a.evidence_strength.rating).toBe("none");
    expect(a.recommended_action.rating).toBe("clarify");
  });
});

describe("goal assessment normaliser", () => {
  it("drops contributions for tasks that were not in the input", () => {
    const g = normalizeGoalAssessment({ task_contributions: [
      { task_ref: "T-1", contribution: "direct", reasoning: "r" }, { task_ref: "T-99", contribution: "direct", reasoning: "invented" },
    ] }, ["T-1"]);
    expect(g.task_contributions.map((c) => c.task_ref)).toEqual(["T-1"]);
  });
  it("says 'none' for supporting work when no tasks are linked", () => {
    expect(normalizeGoalAssessment({}, []).supporting_work.rating).toBe("none");
  });
});

describe("impact brief", () => {
  it("only cites refs present in the period data", () => {
    const refs = collectRefs({ tasks: [{ ref: "T-4" }], goals: [{ ref: "G-2", note: "see T-5" }] });
    expect(refs.sort()).toEqual(["G-2", "T-4", "T-5"]);
    const b = normalizeBrief({ highest_impact: [{ ref: "T-4", reason: "x" }, { ref: "T-77", reason: "made up" }], concerns: [{ ref: "", issue: "No goal has outcome data" }] }, refs);
    expect(b.highest_impact.map((h) => h.ref)).toEqual(["T-4"]);
    expect(b.concerns).toHaveLength(1);
  });
});

describe("model call with a custom output", () => {
  it("sends the impact schema and normalises the reply", async () => {
    let sent: { generationConfig: { responseJsonSchema: { required: string[] }; temperature: number } } | null = null;
    const fetcher = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ expected_impact: { rating: "medium", reasoning: "r" } }) }] } }] }));
    }) as unknown as typeof fetch;
    const r = await callModel(taskMessages({ task: { ref: "T-1" } }), { provider: "gemini", apiKey: "k", model: "gemini-2.5-flash" }, fetcher, taskSpec());
    expect(r.output.expected_impact.rating).toBe("medium");
    expect(sent!.generationConfig.responseJsonSchema.required).toContain("goal_contribution");
    expect(sent!.generationConfig.temperature).toBe(0.2);
  });
  it("goal spec carries the linked task refs", () => {
    expect(goalSpec(["T-1"]).normalize({ task_contributions: [{ task_ref: "T-2", contribution: "direct", reasoning: "" }] }).task_contributions).toEqual([]);
  });
});
