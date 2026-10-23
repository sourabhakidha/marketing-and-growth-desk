import type { Config } from "@netlify/functions";
import { requireMember } from "../lib/auth.ts";
import {
  buildMessages, callOpenAI, retrievalQuery, reviewFlags,
  type KnowledgeContext, type OpportunityContext, type SignalContext, type TaskContext,
} from "../lib/ai.ts";
import { aiConfig } from "../lib/env.ts";

// Background function: drafts a brief or script for a queued ai_drafts row.
// Runs AS the requesting member; the OpenAI key never leaves the server.
export default async (req: Request) => {
  let me: Awaited<ReturnType<typeof requireMember>>;
  try {
    me = await requireMember(req);
  } catch {
    return;
  }
  const { draftId } = (await req.json().catch(() => ({}))) as { draftId?: string };
  if (!draftId) return;

  const fail = (message: string) =>
    me.db.from("ai_drafts").update({ status: "failed", error: message.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", draftId);

  const { data: draft } = await me.db.from("ai_drafts")
    .select("id, kind, task_id, opportunity_id, language, format, duration, instructions, status, created_by")
    .eq("id", draftId).maybeSingle();
  if (!draft || draft.created_by !== me.memberId || draft.status !== "queued") return;

  const cfg = aiConfig();
  if (!cfg) { await fail("AI is not configured: add OPENAI_API_KEY and OPENAI_MODEL in Netlify."); return; }

  try {
    await me.db.from("ai_drafts").update({ status: "running" }).eq("id", draftId);

    const task = draft.task_id
      ? ((await me.db.from("tasks").select("ref, title, brief, task_type, deliverable_format, channel, completion_criteria, opportunity_id")
          .eq("id", draft.task_id).maybeSingle()).data as (TaskContext & { opportunity_id: string | null }) | null)
      : null;
    const opportunityId = draft.opportunity_id ?? task?.opportunity_id ?? null;
    const opportunity = opportunityId
      ? ((await me.db.from("opportunities")
          .select("ref, title, audience, audience_tension, strategic_rationale, content_angle, suggested_format, objective, proof_checks")
          .eq("id", opportunityId).maybeSingle()).data as OpportunityContext | null)
      : null;
    const signals: SignalContext[] = opportunityId
      ? (((await me.db.from("opportunity_signals")
          .select("radar_signals(id, title, url, publisher, published_at, evidence_class, excerpt)")
          .eq("opportunity_id", opportunityId)).data ?? []) as unknown as { radar_signals: SignalContext }[])
          .map((r) => r.radar_signals).filter(Boolean).slice(0, 8)
      : [];

    const brand = ((await me.db.from("knowledge_documents").select("id, title, content")
      .eq("kind", "brand_guidelines").eq("is_active", true).order("updated_at", { ascending: false }).limit(1)).data?.[0] ?? null) as KnowledgeContext | null;
    const query = retrievalQuery([draft.instructions, draft.format, task?.title, task?.brief, opportunity?.title, opportunity?.content_angle, opportunity?.audience_tension]);
    const patterns = ((await me.db.rpc("knowledge_search", { p_query: query, p_kind: "script_pattern", p_limit: 4 })).data ?? []) as KnowledgeContext[];
    const references = ((await me.db.rpc("knowledge_search", { p_query: query, p_kind: "reference", p_limit: 2 })).data ?? []) as (KnowledgeContext & { rank: number })[];

    const messages = buildMessages({
      request: { kind: draft.kind, language: draft.language, format: draft.format, duration: draft.duration, instructions: draft.instructions },
      brand,
      patterns: [...patterns, ...references.filter((r) => r.rank > 0)],
      task,
      opportunity,
      signals,
    });
    const result = await callOpenAI(messages, { apiKey: cfg.apiKey, model: cfg.model });
    const flags = reviewFlags(result.output, signals.map((s) => s.url));

    await me.db.from("ai_drafts").update({
      status: "ready",
      output: { ...result.output, review_flags: flags },
      model: result.model,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      knowledge_ids: [brand?.id, ...patterns.map((p) => p.id)].filter(Boolean),
      signal_ids: signals.map((s) => s.id),
      completed_at: new Date().toISOString(),
    }).eq("id", draftId);
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Drafting failed");
  }
};

export const config: Config = { path: "/api/ai-draft", method: ["POST"], background: true };
