// AI impact assessments (D-030): task, goal and period-brief schemas, the
// prompts, and normalisers that turn any model reply into a safe, explained
// assessment. The model only ever sees what we pass in and is told to say
// "unclear" rather than invent targets or present expectations as results.
import type { OutputSpec } from "./ai.ts";

const rated = (values: string[], description: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["rating", "reasoning"],
  properties: {
    rating: { type: "string", enum: values, description },
    reasoning: { type: "string", description: "Why, citing only facts given in the input. Say what is missing." },
  },
});
const list = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const TASK_RATINGS = {
  expected_impact: ["high", "medium", "low", "unclear"],
  strategic_alignment: ["strong", "partial", "weak", "unclear"],
  evidence_strength: ["strong", "moderate", "weak", "none"],
  goal_contribution: ["direct", "indirect", "unclear", "none", "no_goal"],
  recommended_action: ["proceed", "clarify", "rescope", "deprioritise", "link_to_goal"],
} as const;

export const GOAL_RATINGS = {
  strategic_importance: ["high", "medium", "low", "unclear"],
  clarity: ["clear", "partly_clear", "unclear"],
  measurability: ["measurable", "partly_measurable", "qualitative_only", "not_measurable"],
  feasibility: ["likely", "at_risk", "unlikely", "unclear"],
  expected_impact: ["high", "medium", "low", "unclear"],
  supporting_work: ["sufficient", "thin", "none", "overloaded"],
  contribution: ["direct", "indirect", "unclear", "none"],
} as const;

export const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "expected_impact", "strategic_alignment", "evidence_strength", "goal_contribution",
    "missing_information", "risks", "recommended_action", "caveats"],
  properties: {
    summary: { type: "string", description: "Two sentences: what the task is expected to change for the business and how sure we can be." },
    expected_impact: rated([...TASK_RATINGS.expected_impact], "Expected (not proven) business impact if delivered well"),
    strategic_alignment: rated([...TASK_RATINGS.strategic_alignment], "Fit with the linked goal / stated business outcome"),
    evidence_strength: rated([...TASK_RATINGS.evidence_strength], "How well the impact case is supported"),
    goal_contribution: rated([...TASK_RATINGS.goal_contribution], "How the task contributes to its linked goal; no_goal if standalone"),
    missing_information: list("Specific facts that would make the impact case assessable"),
    risks: list("Risks to the expected impact, dependencies included"),
    recommended_action: rated([...TASK_RATINGS.recommended_action], "What an admin should do next"),
    caveats: list("Limits of this assessment"),
  },
};

export const GOAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strategic_importance", "clarity", "measurability", "feasibility", "expected_impact", "supporting_work",
    "task_contributions", "gaps", "risks", "recommended_actions", "caveats"],
  properties: {
    summary: { type: "string", description: "Two sentences on the business outcome and how well the current work supports it." },
    strategic_importance: rated([...GOAL_RATINGS.strategic_importance], "Importance of the outcome to the business"),
    clarity: rated([...GOAL_RATINGS.clarity], "Is the business outcome clearly stated (outcome, not activity)?"),
    measurability: rated([...GOAL_RATINGS.measurability], "Can achievement be measured with what is stated?"),
    feasibility: rated([...GOAL_RATINGS.feasibility], "Feasibility within the timeframe given the linked tasks, effort, blockers"),
    expected_impact: rated([...GOAL_RATINGS.expected_impact], "Expected business impact if achieved"),
    supporting_work: rated([...GOAL_RATINGS.supporting_work], "Is there enough (or too much) linked work?"),
    task_contributions: {
      type: "array",
      description: "One entry per linked task given in the input",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task_ref", "contribution", "reasoning"],
        properties: {
          task_ref: { type: "string" },
          contribution: { type: "string", enum: [...GOAL_RATINGS.contribution] },
          reasoning: { type: "string" },
        },
      },
    },
    gaps: list("Missing work or information needed to achieve the outcome"),
    risks: list("Risks, dependencies, blockers"),
    recommended_actions: list("Specific next actions for admins"),
    caveats: list("Limits of this assessment"),
  },
};

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "highest_impact", "outcome_progress", "capacity", "concerns", "recommended_priorities", "caveats"],
  properties: {
    headline: { type: "string", description: "One or two sentences on the period." },
    highest_impact: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["ref", "reason"],
        properties: { ref: { type: "string", description: "T-n or G-n from the input" }, reason: { type: "string" } },
      },
    },
    outcome_progress: { type: "string", description: "Progress toward business outcomes vs task completion. Never treat completed tasks as achieved outcomes." },
    capacity: { type: "string", description: "How work and team capacity were spread across objectives." },
    concerns: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["ref", "issue"],
        properties: { ref: { type: "string", description: "T-n / G-n, or empty when general" }, issue: { type: "string" } },
      },
    },
    recommended_priorities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["action", "reason"],
        properties: { action: { type: "string" }, reason: { type: "string" } },
      },
    },
    caveats: list("Limits of this brief"),
  },
};

// ---------------------------------------------------------------- normalised outputs
export interface Rated { rating: string; reasoning: string }
export interface TaskAssessment {
  summary: string; expected_impact: Rated; strategic_alignment: Rated; evidence_strength: Rated; goal_contribution: Rated;
  missing_information: string[]; risks: string[]; recommended_action: Rated; caveats: string[];
}
export interface GoalAssessment {
  summary: string; strategic_importance: Rated; clarity: Rated; measurability: Rated; feasibility: Rated; expected_impact: Rated;
  supporting_work: Rated; task_contributions: { task_ref: string; contribution: string; reasoning: string }[];
  gaps: string[]; risks: string[]; recommended_actions: string[]; caveats: string[];
}
export interface ImpactBrief {
  headline: string; highest_impact: { ref: string; reason: string }[]; outcome_progress: string; capacity: string;
  concerns: { ref: string; issue: string }[]; recommended_priorities: { action: string; reason: string }[]; caveats: string[];
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
/** An unknown rating becomes the "can't tell" value, and an unexplained one says so. */
function rate(v: unknown, allowed: readonly string[], fallback: string): Rated {
  const o = obj(v);
  const rating = str(o.rating).toLowerCase();
  return {
    rating: allowed.includes(rating) ? rating : fallback,
    reasoning: str(o.reasoning) || "No reasoning was given, so treat this rating as unexplained.",
  };
}

export function normalizeTaskAssessment(raw: unknown): TaskAssessment {
  const o = obj(raw);
  const R = TASK_RATINGS;
  return {
    summary: str(o.summary),
    expected_impact: rate(o.expected_impact, R.expected_impact, "unclear"),
    strategic_alignment: rate(o.strategic_alignment, R.strategic_alignment, "unclear"),
    evidence_strength: rate(o.evidence_strength, R.evidence_strength, "none"),
    goal_contribution: rate(o.goal_contribution, R.goal_contribution, "unclear"),
    missing_information: strs(o.missing_information),
    risks: strs(o.risks),
    recommended_action: rate(o.recommended_action, R.recommended_action, "clarify"),
    caveats: strs(o.caveats),
  };
}

export function normalizeGoalAssessment(raw: unknown, taskRefs: string[] = []): GoalAssessment {
  const o = obj(raw);
  const R = GOAL_RATINGS;
  const contributions = (Array.isArray(o.task_contributions) ? o.task_contributions : []).map((c) => {
    const x = obj(c);
    const contribution = str(x.contribution).toLowerCase();
    return { task_ref: str(x.task_ref), contribution: (R.contribution as readonly string[]).includes(contribution) ? contribution : "unclear", reasoning: str(x.reasoning) };
  }).filter((c) => c.task_ref && (taskRefs.length === 0 || taskRefs.includes(c.task_ref))); // never keep tasks we didn't send
  return {
    summary: str(o.summary),
    strategic_importance: rate(o.strategic_importance, R.strategic_importance, "unclear"),
    clarity: rate(o.clarity, R.clarity, "unclear"),
    measurability: rate(o.measurability, R.measurability, "not_measurable"),
    feasibility: rate(o.feasibility, R.feasibility, "unclear"),
    expected_impact: rate(o.expected_impact, R.expected_impact, "unclear"),
    supporting_work: rate(o.supporting_work, R.supporting_work, taskRefs.length ? "thin" : "none"),
    task_contributions: contributions,
    gaps: strs(o.gaps), risks: strs(o.risks), recommended_actions: strs(o.recommended_actions), caveats: strs(o.caveats),
  };
}

export function normalizeBrief(raw: unknown, knownRefs: string[] = []): ImpactBrief {
  const o = obj(raw);
  const known = (ref: string) => !ref || knownRefs.length === 0 || knownRefs.includes(ref);
  return {
    headline: str(o.headline),
    highest_impact: (Array.isArray(o.highest_impact) ? o.highest_impact : []).map((x) => ({ ref: str(obj(x).ref), reason: str(obj(x).reason) }))
      .filter((x) => x.ref && known(x.ref) && x.reason),
    outcome_progress: str(o.outcome_progress),
    capacity: str(o.capacity),
    concerns: (Array.isArray(o.concerns) ? o.concerns : []).map((x) => ({ ref: str(obj(x).ref), issue: str(obj(x).issue) }))
      .filter((x) => x.issue && known(x.ref)),
    recommended_priorities: (Array.isArray(o.recommended_priorities) ? o.recommended_priorities : [])
      .map((x) => ({ action: str(obj(x).action), reason: str(obj(x).reason) })).filter((x) => x.action),
    caveats: strs(o.caveats),
  };
}

export const taskSpec = (): OutputSpec<TaskAssessment> =>
  ({ name: "akidha_task_impact", schema: TASK_SCHEMA, normalize: normalizeTaskAssessment, temperature: 0.2, maxTokens: 4000 });
export const goalSpec = (taskRefs: string[]): OutputSpec<GoalAssessment> =>
  ({ name: "akidha_goal_impact", schema: GOAL_SCHEMA, normalize: (r) => normalizeGoalAssessment(r, taskRefs), temperature: 0.2, maxTokens: 6000 });
export const briefSpec = (refs: string[]): OutputSpec<ImpactBrief> =>
  ({ name: "akidha_impact_brief", schema: BRIEF_SCHEMA, normalize: (r) => normalizeBrief(r, refs), temperature: 0.3, maxTokens: 6000 });

/** All T-n / G-n refs mentioned anywhere in the brief input, so the reply can't cite work we didn't send. */
export function collectRefs(v: unknown, out = new Set<string>()): string[] {
  if (typeof v === "string") { for (const m of v.matchAll(/\b[TG]-\d+\b/g)) out.add(m[0]); }
  else if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectRefs(x, out));
  return [...out];
}

// ---------------------------------------------------------------- prompts
const RULES = `You assess the expected business impact of marketing work for Akidha's internal Marketing Desk.
Rules — follow all of them:
1. Use ONLY the facts in the input JSON. Never invent targets, numbers, baselines, results, dates or people.
2. Everything you rate is an EXPECTATION, not a result. Never present a prediction as proven. Write "expected", "likely", "could".
3. Completing tasks does not mean a business goal is achieved. Only a recorded outcome status/actual value says that.
4. Explain every rating in its reasoning, pointing to the specific input fields you relied on. If key facts are missing, rate "unclear" (or the lowest evidence level) and list exactly what is missing.
5. Evidence levels: "hypothesis" = untested belief; "historical" = based on past data; "committed" = an agreed business target. Treat a hypothesis as weaker evidence than historical data.
6. Be concise, specific and practical. Recommendations are for admins (Sourabh, Tanvi) and must be concrete next steps.
7. Never include customer or patient personal data. Reply in English.`;

export function taskMessages(input: unknown) {
  return [
    { role: "system", content: `${RULES}\nAssess one task: its expected business impact, strategic alignment, evidence strength, contribution to its linked goal (or "no_goal" if it is standalone — standalone work is allowed), missing information, risks and the recommended action.` },
    { role: "user", content: `Input (JSON):\n${JSON.stringify(input, null, 1)}` },
  ];
}

export function goalMessages(input: unknown) {
  return [
    { role: "system", content: `${RULES}\nAssess one goal: strategic importance, clarity of the business outcome (an outcome, not a count of tasks), measurability, feasibility given the linked tasks (effort, status, blockers, dependencies, risks), expected business impact, whether supporting work is sufficient / thin / none / overloaded, and each linked task's contribution. Roll up the linked tasks' impact cases and prior task assessments where given. Keep task-completion progress separate from outcome achievement.` },
    { role: "user", content: `Input (JSON):\n${JSON.stringify(input, null, 1)}` },
  ];
}

export function briefMessages(input: unknown) {
  return [
    { role: "system", content: `${RULES}\nWrite an impact brief for the period in the input: the highest-impact tasks and goals with reasons, progress toward business outcomes versus task completion, how work and capacity were spread across objectives (per person where given), low-impact or poorly justified work, neglected goals, blockers, risks and gaps, and recommended priorities with specific actions for admins. Refer to work only by the refs given (T-n, G-n).` },
    { role: "user", content: `Period data (JSON, computed from recorded Marketing Desk data):\n${JSON.stringify(input, null, 1)}` },
  ];
}
