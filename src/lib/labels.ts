// Display labels for system-defined values in the intelligence modules.
export const EVIDENCE_LABEL: Record<string, string> = {
  official: "Official record", study: "Study / research", news_reporting: "News reporting", opinion: "Opinion",
  anecdote: "Public post (anecdote)", trend: "Trend signal", unknown: "Unknown",
};
export const SIGNAL_STATUS_LABEL: Record<string, string> = {
  new: "New", reviewed: "Reviewed", saved: "Saved", dismissed: "Dismissed", converted: "Linked to opportunity",
};
export const SOURCE_KIND_LABEL: Record<string, string> = { news_search: "News search", rss: "RSS feed", reddit: "Reddit", manual: "Manual" };
export const SOURCE_STATUS_LABEL: Record<string, string> = {
  never: "Never scanned", ok: "Healthy", empty: "No results", failed: "Failed", not_configured: "Not configured",
};
export const TOPIC_LABEL: Record<string, string> = {
  affordability: "Affordability", substitutes_generics: "Substitutes / generics", chronic_care: "Chronic care",
  quality_trust: "Quality & trust", policy_regulation: "Policy & regulation", online_pharmacy: "Online pharmacy",
};
export const OPP_STATUS_LABEL: Record<string, string> = {
  considering: "Considering", needs_research: "Needs research", approved: "Approved", deferred: "Deferred",
  rejected: "Rejected", converted: "In production",
};
export const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: "Awareness", understanding: "Understanding", objection_resolution: "Objection resolution",
  qualified_inquiry: "Qualified inquiry", conversion: "Conversion", retention: "Retention / adherence",
};
/** Bible §9.3 prioritisation dimensions. Effort is scored so that 5 = easiest. */
export const SCORE_DIMENSIONS: { key: string; label: string; hint: string }[] = [
  { key: "audience_relevance", label: "Audience relevance", hint: "How directly it addresses a real audience need" },
  { key: "source_quality", label: "Source quality", hint: "Strength of the evidence behind it" },
  { key: "strategic_fit", label: "Strategic fit", hint: "Fit with Akidha's education-first positioning and goals" },
  { key: "time_sensitivity", label: "Time sensitivity", hint: "5 = must act now" },
  { key: "distinctiveness", label: "Distinctiveness", hint: "How different it is from what we already say" },
  { key: "ease", label: "Ease of execution", hint: "5 = little effort" },
  { key: "expected_value", label: "Expected value", hint: "Judgement, not a prediction" },
];
export const LEARNING_CLASS_LABEL: Record<string, string> = {
  marketing_outcome: "Marketing outcome", audience: "Audience understanding", production_process: "Production process",
  management_decision: "Management decision", ai_quality: "AI quality",
};
export const LEARNING_STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review", accepted: "Accepted", rejected: "Rejected", superseded: "Superseded",
};
export const DRAFT_STATUS_LABEL: Record<string, string> = {
  queued: "Queued", running: "Drafting…", ready: "Ready for review", failed: "Failed", accepted: "Accepted", discarded: "Discarded",
};
export const STATUS_TONE: Record<string, string> = {
  new: "progress", reviewed: "neutral", saved: "review", dismissed: "muted", converted: "ok",
  considering: "neutral", needs_research: "warn", approved: "ok", deferred: "muted", rejected: "danger",
  pending_review: "review", accepted: "ok", superseded: "muted",
  queued: "neutral", running: "progress", ready: "review", failed: "danger", discarded: "muted",
  ok: "ok", empty: "neutral", never: "muted", not_configured: "warn",
};

export function scoreAverage(scores: Record<string, number> | null | undefined): number | null {
  const vals = SCORE_DIMENSIONS.map((d) => scores?.[d.key]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}
