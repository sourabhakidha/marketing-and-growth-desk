import { describe, expect, it } from "vitest";
import { buildMessages, callOpenAI, retrievalQuery, reviewFlags, type DraftOutput } from "./ai.ts";

const out: DraftOutput = {
  working_title: "t", objective: "o", audience: "a", language: "Hinglish", format_and_duration: "Reel 45s", core_message: "m",
  hook_options: ["h"], structure: [{ beat: "b", content: "c" }], script_text: "", on_screen_text: [], cta: "c",
  visual_direction: "v", claims_requiring_review: [], assumptions_and_gaps: [], pattern_references: [], evidence_used: [],
};

describe("buildMessages", () => {
  it("puts the guardrails and brand text in the system message and context in the user message", () => {
    const msgs = buildMessages({
      request: { kind: "script", language: "Hindi", format: "Reel", duration: "45 s", instructions: "Family angle" },
      brand: { id: "b", title: "Brand", content: "VOICE: warm" },
      patterns: [{ id: "p", title: "Papa ne nahi maana", content: "Hook: …" }],
      task: { ref: 7, title: "Write script", brief: "BP patients", task_type: "content_development", deliverable_format: null, channel: "Meta ad", completion_criteria: null },
      opportunity: null,
      signals: [{ id: "s", title: "NPPA cap", url: "https://x.in/a", publisher: "PIB", published_at: null, evidence_class: "official", excerpt: null }],
    });
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toContain("[REVIEW REQUIRED");
    expect(msgs[0]!.content).toContain("VOICE: warm");
    expect(msgs[1]!.content).toContain("T-7");
    expect(msgs[1]!.content).toContain("Papa ne nahi maana");
    expect(msgs[1]!.content).toContain("published unknown");
    expect(msgs[1]!.content).toContain("SCRIPT");
  });
});

describe("retrievalQuery", () => {
  it("OR-joins distinctive words", () => {
    expect(retrievalQuery(["Write script for Papa", "family BP"])).toBe("write or papa or family");
  });
});

describe("reviewFlags", () => {
  it("flags guarantees, unreviewed numbers and invented URLs", () => {
    const flags = reviewFlags({ ...out, script_text: "100% safe, 70% savings", evidence_used: ["https://made.up"] }, ["https://x.in/a"]);
    expect(flags).toHaveLength(3);
  });
  it("passes a clean draft", () => expect(reviewFlags(out, [])).toEqual([]));
});

describe("callOpenAI", () => {
  it("requests strict JSON-schema output and parses it", async () => {
    let body: Record<string, unknown> = {};
    const fetcher = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ model: "m-1", choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
    }) as unknown as typeof fetch;
    const res = await callOpenAI([{ role: "user", content: "x" }], { apiKey: "k", model: "m", fetcher });
    expect((body.response_format as { type: string }).type).toBe("json_schema");
    expect(res.output.working_title).toBe("t");
    expect(res.completionTokens).toBe(20);
  });
  it("surfaces API errors without the key", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(callOpenAI([], { apiKey: "sk-secret", model: "m", fetcher })).rejects.toThrow(/400: bad model/);
  });
});
