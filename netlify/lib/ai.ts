// AI drafting (Bible §10). Server-side only. The model drafts briefs and
// scripts as PROPOSALS grounded in the knowledge base; it never changes plans.

export interface DraftRequest {
  kind: "brief" | "script";
  language: string | null;
  format: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface TaskContext { ref: number; title: string; brief: string | null; task_type: string; deliverable_format: string | null; channel: string | null; completion_criteria: string | null }
export interface OpportunityContext { ref: number; title: string; audience: string | null; audience_tension: string | null; strategic_rationale: string | null; content_angle: string | null; suggested_format: string | null; objective: string | null; proof_checks: string | null }
export interface SignalContext { id: string; title: string; url: string; publisher: string | null; published_at: string | null; evidence_class: string; excerpt: string | null }
export interface KnowledgeContext { id: string; title: string; content: string }

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "working_title", "objective", "audience", "language", "format_and_duration", "core_message", "hook_options",
    "structure", "script_text", "on_screen_text", "cta", "visual_direction", "claims_requiring_review",
    "assumptions_and_gaps", "pattern_references", "evidence_used",
  ],
  properties: {
    working_title: { type: "string" },
    objective: { type: "string" },
    audience: { type: "string" },
    language: { type: "string" },
    format_and_duration: { type: "string" },
    core_message: { type: "string", description: "One sentence" },
    hook_options: { type: "array", items: { type: "string" }, description: "2-3 hooks for the first 1-3 seconds" },
    structure: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["beat", "content"], properties: { beat: { type: "string" }, content: { type: "string" } } },
    },
    script_text: { type: "string", description: "Full script/VO for kind=script; empty string for kind=brief" },
    on_screen_text: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    visual_direction: { type: "string" },
    claims_requiring_review: { type: "array", items: { type: "string" }, description: "Every medical, price, savings, certification or process claim needing verification" },
    assumptions_and_gaps: { type: "array", items: { type: "string" } },
    pattern_references: { type: "array", items: { type: "string" }, description: "Titles of knowledge-base patterns that informed the draft" },
    evidence_used: { type: "array", items: { type: "string" }, description: "URLs of supplied source signals actually used; never invent URLs" },
  },
} as const;

export interface DraftOutput {
  working_title: string; objective: string; audience: string; language: string; format_and_duration: string;
  core_message: string; hook_options: string[]; structure: { beat: string; content: string }[]; script_text: string;
  on_screen_text: string[]; cta: string; visual_direction: string; claims_requiring_review: string[];
  assumptions_and_gaps: string[]; pattern_references: string[]; evidence_used: string[];
}

const SYSTEM_RULES = `You are the drafting assistant inside Akidha Marketing Desk, Akidha's internal marketing tool.
You write DRAFT creative briefs and scripts for Akidha's marketing team. A human reviews everything you write.

Non-negotiable rules:
1. Medical safety and factual accuracy come first. Never invent or infer medicine facts, salts, strengths, dosages, indications, side effects, equivalence, manufacturers, certifications, prices, savings percentages, discounts, delivery promises or service steps (doctor calls, pharmacist checks). Where such a fact is needed and not given in the brief, write [REVIEW REQUIRED: <what is needed>] in the text and list it under claims_requiring_review.
2. Never tell anyone to start, stop, change, split or substitute a medicine without professional guidance. Never use absolute guarantees ("100% safe", "guaranteed", "no side effects", "same results for everyone").
3. Use "substitute" (not "generic") in Akidha-facing copy unless the brief says otherwise.
4. Historical script patterns are for structure, hooks and tone only. Do not copy their wording, numbers or claims, and do not describe any past creative as successful.
5. Source signals are context, not proof. Public posts are anecdotes. Only cite URLs that were supplied, in evidence_used.
6. Follow the brand voice: warm, calm, respectful, simple, practical; like a caring family member; no fear, pressure or hype.
7. If the brief is missing something essential, still produce your best draft and list the gap in assumptions_and_gaps.
Return only the JSON object required by the schema.`;

function block(title: string, body: string | null | undefined): string {
  return body && body.trim() ? `## ${title}\n${body.trim()}\n` : "";
}

export function buildMessages(input: {
  request: DraftRequest;
  brand: KnowledgeContext | null;
  patterns: KnowledgeContext[];
  task: TaskContext | null;
  opportunity: OpportunityContext | null;
  signals: SignalContext[];
}): { role: "system" | "user"; content: string }[] {
  const { request, brand, patterns, task, opportunity, signals } = input;
  const system = [
    SYSTEM_RULES,
    brand ? `\n# Brand guidelines (authoritative)\n${brand.content}` : "\n# Brand guidelines\n(Not loaded — be conservative and flag tone questions.)",
  ].join("\n");

  const parts: string[] = [];
  parts.push(`# Request\nDraft a ${request.kind === "script" ? "SCRIPT (fill script_text with the full script / voice-over, with shot or beat cues)" : "CREATIVE BRIEF (leave script_text as an empty string)"}.`);
  parts.push(block("Language", request.language ?? "Hinglish (Roman script) unless the brief says otherwise"));
  parts.push(block("Format", request.format));
  parts.push(block("Duration / size", request.duration));
  parts.push(block("Instructions from the team", request.instructions));
  if (task) {
    parts.push(block(`Task T-${task.ref}`, [
      `Title: ${task.title}`, `Task type: ${task.task_type}`, task.deliverable_format && `Format: ${task.deliverable_format}`,
      task.channel && `Channel: ${task.channel}`, task.brief && `Brief: ${task.brief}`,
      task.completion_criteria && `Completion criteria: ${task.completion_criteria}`,
    ].filter(Boolean).join("\n")));
  }
  if (opportunity) {
    parts.push(block(`Approved opportunity O-${opportunity.ref}`, [
      `Title: ${opportunity.title}`, opportunity.audience && `Audience: ${opportunity.audience}`,
      opportunity.audience_tension && `Audience tension / need: ${opportunity.audience_tension}`,
      opportunity.strategic_rationale && `Why it matters: ${opportunity.strategic_rationale}`,
      opportunity.content_angle && `Angle: ${opportunity.content_angle}`, opportunity.suggested_format && `Suggested format: ${opportunity.suggested_format}`,
      opportunity.objective && `Objective: ${opportunity.objective}`, opportunity.proof_checks && `Proof / claim checks: ${opportunity.proof_checks}`,
    ].filter(Boolean).join("\n")));
  }
  if (signals.length) {
    parts.push(`## Source signals (context, not proof)\n${signals.map((s) =>
      `- [${s.evidence_class}] ${s.title} — ${s.publisher ?? "unknown publisher"}, published ${s.published_at ?? "unknown"}\n  URL: ${s.url}${s.excerpt ? `\n  Excerpt: ${s.excerpt}` : ""}`).join("\n")}\n`);
  }
  if (patterns.length) {
    parts.push(`## Historical script patterns (structure and tone only — do not copy)\n${patterns.map((p) => `### ${p.title}\n${p.content}`).join("\n\n")}\n`);
  }
  return [{ role: "system", content: system }, { role: "user", content: parts.filter(Boolean).join("\n") }];
}

/** Words used to retrieve relevant script patterns (OR-joined for websearch_to_tsquery). */
export function retrievalQuery(texts: (string | null | undefined)[]): string {
  const stop = new Set(["the", "and", "for", "with", "this", "that", "from", "your", "have", "will", "into", "about", "script", "brief", "draft", "akidha"]);
  const words = texts.filter(Boolean).join(" ").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const unique = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 25);
  return unique.join(" or ");
}

/** Post-check the model output; we flag, never silently fix. */
export function reviewFlags(out: DraftOutput, suppliedUrls: string[]): string[] {
  const flags: string[] = [];
  const all = JSON.stringify(out);
  if (/(100\s?%\s?safe|guarantee[ds]?|no side[- ]effects|zero risk|works for everyone)/i.test(all)) flags.push("Contains absolute-guarantee wording — must be removed or legally approved.");
  if (/₹\s?\d|\b\d{1,3}\s?%/.test(out.script_text + out.on_screen_text.join(" ") + out.core_message) && !out.claims_requiring_review.length)
    flags.push("Contains prices or percentages but lists no claims for review.");
  const invented = out.evidence_used.filter((u) => !suppliedUrls.includes(u));
  if (invented.length) flags.push(`Cites URLs that were not supplied: ${invented.join(", ")}`);
  return flags;
}

export interface OpenAIResult { output: DraftOutput; model: string; promptTokens: number | null; completionTokens: number | null }

export async function callOpenAI(
  messages: { role: string; content: string }[],
  opts: { apiKey: string; model: string; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<OpenAIResult> {
  const fetcher = opts.fetcher ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);
  try {
    const res = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name: "akidha_draft", strict: true, schema: DRAFT_SCHEMA } },
        max_completion_tokens: 6000,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }; model?: string;
      choices?: { message?: { content?: string; refusal?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${body.error?.message ?? "request failed"}`);
    const msg = body.choices?.[0]?.message;
    if (msg?.refusal) throw new Error(`Model declined: ${msg.refusal}`);
    if (!msg?.content) throw new Error("Model returned no content");
    return {
      output: JSON.parse(msg.content) as DraftOutput,
      model: body.model ?? opts.model,
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("OpenAI request timed out");
    throw err;
  } finally {
    clearTimeout(t);
  }
}
