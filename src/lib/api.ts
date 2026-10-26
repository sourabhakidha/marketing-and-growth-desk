// Data access for the Workspace. Every query runs as the signed-in user, so
// the database's RLS decides what is visible and what can change.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase.ts";
import { describeDbError, type Member } from "./session.tsx";
import { type DateRange, isBounded, timestampBounds } from "./dateRange.ts";

export interface VocabTerm { id: string; vocabulary: string; code: string; label: string; sort_order: number; is_active: boolean }
export interface WorkflowTemplate {
  id: string; code: string; name: string; description: string | null; default_for_task_type: string | null;
  sort_order: number; is_active: boolean;
  workflow_template_stages: { id: string; position: number; stage_code: string; is_optional: boolean }[];
}
export type Task = {
  id: string; ref: number; title: string; brief: string | null; task_type: string; work_origin: string;
  priority: string | null; status: string; owner_id: string; reviewer_id: string | null; goal_id: string | null;
  counts_toward_goal: boolean; deliverable_format: string | null; channel: string | null; requester: string | null;
  due_date: string | null; estimated_minutes: number | null; completion_criteria: string | null;
  deliverable_url: string | null; blocker_reason: string | null; workflow_template_id: string | null;
  publish_date: string | null; opportunity_id: string | null;
  created_by: string; created_at: string; updated_at: string; completed_at: string | null;
} & TaskImpact & BinFields & TaskStructure;
/** D-038: a deliverable is an umbrella; a task may be a part of one deliverable. */
export interface TaskStructure { kind?: "task" | "deliverable"; parent_id?: string | null }
/** Recycle Bin (D-035): removed = in the bin; purged = deleted permanently from the desk (row kept in the database). */
export interface BinFields {
  removed_at?: string | null; removed_by?: string | null; removed_reason?: string | null;
  purged_at?: string | null; purged_by?: string | null;
}
/** Expected business impact (D-030) — separate from brief and completion criteria. */
export interface TaskImpact {
  impact_outcome: string | null; impact_rationale: string | null; impact_audience: string | null; impact_metrics: string | null;
  impact_evidence: "hypothesis" | "historical" | "committed" | null; impact_dependencies: string | null; impact_risks: string | null;
}
export interface TaskStage {
  id: string; task_id: string; position: number; stage_code: string; is_optional: boolean; owner_id: string | null;
  state: "pending" | "active" | "done" | "skipped"; entered_at: string | null; ready_at: string | null;
  picked_up_at: string | null; completed_at: string | null; revision_count: number;
}
export interface TaskEvent {
  id: number; task_id: string; task_stage_id: string | null; stage_code: string | null; event_type: string;
  actor_id: string | null; from_owner_id: string | null; to_owner_id: string | null; from_value: string | null;
  to_value: string | null; note: string | null; source: string; occurred_at: string;
}
export type Goal = {
  id: string; ref: number; title: string; description: string | null; success_definition: string | null;
  owner_id: string; start_date: string | null; end_date: string | null; target_quantity: number | null;
  target_unit: string | null; progress_method: "task_checklist" | "accepted_deliverables" | "manual";
  manual_progress: number | null; status: string; completion_note: string | null; created_at: string;
} & GoalOutcome & BinFields & { channel?: string | null };
/** The business outcome a goal is for (D-030), kept apart from task-completion progress. */
export interface GoalOutcome {
  outcome_statement: string | null; outcome_rationale: string | null; success_measures: string | null;
  importance: "critical" | "high" | "medium" | "low" | null; outcome_kind: "measurable" | "qualitative" | null;
  outcome_metric: string | null; outcome_baseline: number | null; outcome_target: number | null; outcome_unit: string | null;
  outcome_status: "not_assessed" | "not_started" | "in_progress" | "partially_achieved" | "achieved" | "not_achieved";
  outcome_actual: number | null; outcome_evidence: string | null; outcome_assessed_at: string | null; outcome_assessed_by: string | null;
}
export interface GoalProgress { goal_id: string; linked_tasks: number; done_tasks: number; accepted_deliverables: number; progress_pct: number | null }
export interface AuditEvent {
  id: number; occurred_at: string; actor_user_id: string | null; source: string; entity_type: string;
  entity_id: string; event_type: string; old_value: unknown; new_value: unknown; details: unknown;
}

function db() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

async function run<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(describeDbError(error.message));
  return data as T;
}

type Pageable<T> = { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }> };
const PAGE = 1000; // Supabase returns at most 1,000 rows per request

/**
 * Every row of an ordered query, fetched page by page so nothing is silently cut off
 * at the 1,000-row API limit. `max` caps the total for "latest N" lists.
 */
async function runPaged<T>(query: () => Pageable<T>, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  while (out.length < max) {
    const size = Math.min(PAGE, max - out.length);
    const chunk = await run<T[]>(query().range(out.length, out.length + size - 1));
    out.push(...chunk);
    if (chunk.length < size) break;
  }
  return out;
}

/** Restrict a query on a timestamptz column to an India-calendar date range. */
function withinRange<Q extends { gte(column: string, value: string): Q; lt(column: string, value: string): Q }>(q: Q, column: string, r: DateRange | undefined): Q {
  if (!r) return q;
  const { gte, lt } = timestampBounds(r);
  let out = q;
  if (gte) out = out.gte(column, gte);
  if (lt) out = out.lt(column, lt);
  return out;
}

// ---------------------------------------------------------------- reference data
export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: () => run<Member[]>(db().from("members").select("id, username, email, display_name, role, is_active").order("display_name")),
    staleTime: 5 * 60_000,
  });
}

export function useVocab() {
  return useQuery({
    queryKey: ["vocab_terms"],
    queryFn: () => run<VocabTerm[]>(db().from("vocab_terms").select("id, vocabulary, code, label, sort_order, is_active")
      .order("vocabulary").order("sort_order")),
    staleTime: 5 * 60_000,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ["workflow_templates"],
    queryFn: () => run<WorkflowTemplate[]>(db().from("workflow_templates")
      .select("id, code, name, description, default_for_task_type, sort_order, is_active, workflow_template_stages(id, position, stage_code, is_optional)")
      .order("sort_order").order("position", { referencedTable: "workflow_template_stages" })),
    staleTime: 5 * 60_000,
  });
}

/** Lookup helpers built from reference data. */
export function useLookups() {
  const members = useMembers();
  const vocab = useVocab();
  const memberName = (id: string | null | undefined) =>
    (id && members.data?.find((m) => m.id === id)?.display_name) || (id ? "Unknown member" : "—");
  const label = (vocabulary: string, code: string | null | undefined) =>
    (code && vocab.data?.find((v) => v.vocabulary === vocabulary && v.code === code)?.label) || code || "—";
  const options = (vocabulary: string) => (vocab.data ?? []).filter((v) => v.vocabulary === vocabulary && v.is_active);
  const isAdminMember = (id: string | null | undefined) => Boolean(id && members.data?.find((m) => m.id === id)?.role === "admin");
  return { members, vocab, memberName, label, options, isAdminMember, ready: members.isSuccess && vocab.isSuccess };
}

// ---------------------------------------------------------------- tasks
export interface TaskWithStage extends Task {
  task_stages: Pick<TaskStage, "id" | "position" | "stage_code" | "is_optional" | "state" | "owner_id" | "picked_up_at" | "ready_at" | "revision_count">[];
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => runPaged<TaskWithStage>(() => db().from("tasks")
      .select("*, task_stages(id, position, stage_code, is_optional, state, owner_id, picked_up_at, ready_at, revision_count)")
      .is("removed_at", null)
      .order("ref", { ascending: false })),
  });
}

export function activeStage(task: TaskWithStage) {
  return task.task_stages.find((s) => s.state === "active") ?? null;
}

export function useTask(ref: number) {
  return useQuery({
    queryKey: ["task", ref],
    queryFn: async () => {
      // a task in the bin can still be opened (to restore it); a permanently deleted one is gone from the desk
      const task = await run<Task | null>(db().from("tasks").select("*").eq("ref", ref).is("purged_at", null).maybeSingle());
      if (!task) return null;
      const [stages, events] = await Promise.all([
        run<TaskStage[]>(db().from("task_stages").select("*").eq("task_id", task.id).order("position")),
        run<TaskEvent[]>(db().from("task_events").select("*").eq("task_id", task.id).order("occurred_at", { ascending: false }).order("id", { ascending: false })),
      ]);
      return { task, stages, events };
    },
  });
}

export type NewTask = Pick<Task, "title" | "task_type" | "work_origin" | "owner_id"> &
  Partial<Pick<Task, "brief" | "priority" | "due_date" | "goal_id" | "counts_toward_goal" | "deliverable_format" | "channel"
    | "requester" | "estimated_minutes" | "completion_criteria" | "reviewer_id" | "workflow_template_id" | "deliverable_url"
    | "publish_date" | "opportunity_id">> & Partial<TaskImpact> & TaskStructure
  & { /** D-041: the steps to run, read once at creation (else the workflow template's) */ initial_stages?: string[] };

export function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["opportunities"] }),
    qc.invalidateQueries({ queryKey: ["opportunity"] }),
    qc.invalidateQueries({ queryKey: ["tasks"] }),
    qc.invalidateQueries({ queryKey: ["task"] }),
    qc.invalidateQueries({ queryKey: ["goals"] }),
    qc.invalidateQueries({ queryKey: ["goal_progress"] }),
    qc.invalidateQueries({ queryKey: ["task_events_all"] }),
    qc.invalidateQueries({ queryKey: ["task_stages_all"] }),
  ]);
}

export function useCreateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    // created_by is overwritten by the server with the caller's identity
    mutationFn: (input: NewTask & { created_by: string }) =>
      run<{ ref: number }>(db().from("tasks").insert(input).select("ref").single()),
    onSuccess: invalidate,
  });
}

/**
 * A deliverable and, for a workflow deliverable, one task per chosen step (D-045).
 * The tasks are inserted after the deliverable so they can point at it.
 */
export function useCreateDeliverable() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ deliverable, tasks }: { deliverable: NewTask & { created_by: string }; tasks: (NewTask & { created_by: string })[] }) => {
      const d = await run<{ id: string; ref: number }>(db().from("tasks").insert(deliverable).select("id, ref").single());
      if (tasks.length) {
        try {
          await run<{ id: string }[]>(db().from("tasks").insert(tasks.map((t) => ({ ...t, parent_id: d.id }))).select("id"));
        } catch (e) {
          throw new Error(`The deliverable was created, but its workflow tasks could not be: ${e instanceof Error ? e.message : String(e)}. Add them from the deliverable.`);
        }
      }
      return d;
    },
    onSettled: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
      run<null>(db().from("tasks").update(patch).eq("id", id)),
    onSuccess: invalidate,
  });
}

export type WorkflowAction =
  | { fn: "task_pick_up"; args: { p_task: string } }
  | { fn: "task_hand_off"; args: { p_task: string; p_next_owner: string | null; p_note: string | null } }
  | { fn: "task_skip_stage"; args: { p_task: string; p_stage: string; p_note: string | null } }
  | { fn: "task_return_for_rework"; args: { p_task: string; p_to_stage: string; p_reason: string } }
  | { fn: "task_set_status"; args: { p_task: string; p_status: string; p_note: string | null } }
  | { fn: "task_submit_for_approval"; args: { p_task: string; p_note: string | null } }
  | { fn: "task_decide"; args: { p_task: string; p_approve: boolean; p_feedback: string | null } }
  | { fn: "task_comment"; args: { p_task: string; p_note: string } }
  | { fn: "task_review_request"; args: { p_task: string; p_accept: boolean; p_note: string | null; p_owner: string | null } };

export function useWorkflowAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (action: WorkflowAction) => run<null>(db().rpc(action.fn, action.args)),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- goals
export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: () => run<Goal[]>(db().from("goals").select("*").is("removed_at", null).order("ref", { ascending: false })),
  });
}

export function useGoalProgress() {
  return useQuery({
    queryKey: ["goal_progress"],
    queryFn: () => run<GoalProgress[]>(db().from("goal_progress").select("*")),
  });
}

export type GoalInput = Pick<Goal, "title" | "owner_id" | "progress_method"> &
  Partial<Pick<Goal, "description" | "success_definition" | "start_date" | "end_date" | "target_quantity" | "target_unit"
    | "manual_progress" | "status" | "completion_note">> & Partial<Omit<GoalOutcome, "outcome_assessed_at" | "outcome_assessed_by">> & { channel?: string | null };

export function useSaveGoal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: GoalInput }) =>
      id ? run<null>(db().from("goals").update(input).eq("id", id))
         : run<{ ref: number }>(db().from("goals").insert(input).select("ref").single()),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- recycle bin (D-035, admins only)
export function useBin() {
  return useQuery({
    queryKey: ["bin"],
    queryFn: async () => {
      const [tasks, goals] = await Promise.all([
        run<Task[]>(db().from("tasks").select("*").not("removed_at", "is", null).is("purged_at", null).order("removed_at", { ascending: false })),
        run<Goal[]>(db().from("goals").select("*").not("removed_at", "is", null).is("purged_at", null).order("removed_at", { ascending: false })),
      ]);
      return { tasks, goals };
    },
  });
}

export type BinAction =
  | { fn: "task_remove"; args: { p_task: string; p_reason: string } }
  | { fn: "task_restore" | "task_purge"; args: { p_task: string } }
  | { fn: "goal_remove"; args: { p_goal: string; p_reason: string } }
  | { fn: "goal_restore" | "goal_purge"; args: { p_goal: string } };

export function useBinAction() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: BinAction) => run<null>(db().rpc(a.fn, a.args)),
    onSuccess: () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["bin"] }), qc.invalidateQueries({ queryKey: ["impact_assessments"] })]),
  });
}

// ---------------------------------------------------------------- history & exports
export function useAllTaskEvents(limit = 300) {
  return useQuery({
    queryKey: ["task_events_all", limit],
    queryFn: () => runPaged<TaskEvent>(() => db().from("task_events").select("*").order("occurred_at", { ascending: false }).order("id", { ascending: false }), limit),
  });
}

/** Task events in a date range (all of them), or the latest `limit` when the range is open. */
export function useTaskEvents(range: DateRange, limit = 500) {
  const bounded = isBounded(range);
  return useQuery({
    queryKey: ["task_events_all", "range", range.from, range.to, bounded ? null : limit],
    queryFn: () => runPaged<TaskEvent>(() => withinRange(db().from("task_events").select("*"), "occurred_at", range)
      .order("occurred_at", { ascending: false }).order("id", { ascending: false }), bounded ? Infinity : limit),
  });
}

// Full exports: every row, paged. Event-style tables take an optional date range on their timestamp.
export const fetchAllExtra = {
  signals: (r?: DateRange, column: "collected_at" | "published_at" = "collected_at") =>
    runPaged<RadarSignal>(() => withinRange(db().from("radar_signals").select("*"), column, r).order(column).order("ref")),
  opportunities: () => runPaged<Opportunity>(() => db().from("opportunities").select("*").order("ref")),
  opportunitySignals: () => runPaged<{ opportunity_id: string; signal_id: string }>(() => db().from("opportunity_signals")
    .select("opportunity_id, signal_id").order("opportunity_id").order("signal_id")),
  learnings: () => runPaged<Learning>(() => db().from("learnings").select("*").order("ref")),
  drafts: (r?: DateRange) => runPaged<AiDraft>(() => withinRange(db().from("ai_drafts").select("*"), "created_at", r).order("ref")),
};

export const fetchAll = {
  tasks: () => runPaged<Task>(() => db().from("tasks").select("*").is("removed_at", null).order("ref")),
  goals: () => runPaged<Goal>(() => db().from("goals").select("*").is("removed_at", null).order("ref")),
  goalProgress: () => runPaged<GoalProgress>(() => db().from("goal_progress").select("*").order("goal_id")),
  stages: () => runPaged<TaskStage>(() => db().from("task_stages").select("*").order("task_id").order("position")),
  taskEvents: (r?: DateRange) => runPaged<TaskEvent>(() => withinRange(db().from("task_events").select("*"), "occurred_at", r).order("occurred_at").order("id")),
  auditEvents: (r?: DateRange) => runPaged<AuditEvent>(() => withinRange(db().from("audit_events").select("*"), "occurred_at", r).order("occurred_at").order("id")),
};

// ---------------------------------------------------------------- generic helpers for new modules
export { db as client, run };

// ---------------------------------------------------------------- radar
export interface RadarSource {
  id: string; kind: "news_search" | "rss" | "reddit"; name: string;
  config: { query?: string; region?: string; feed_url?: string; subreddit?: string };
  evidence_class: string; is_active: boolean; last_scan_at: string | null; last_success_at: string | null;
  last_status: "never" | "ok" | "empty" | "failed" | "not_configured"; last_error: string | null; last_item_count: number | null;
}
export interface RadarScan { id: string; started_by: string; started_at: string; finished_at: string | null; status: "running" | "ok" | "partial" | "failed"; inserted: number | null; duplicates: number | null }
export interface RadarSignal {
  id: string; ref: number; source_id: string | null; source_type: string; source_name: string; url: string; title: string;
  excerpt: string | null; publisher: string | null; published_at: string | null; collected_at: string; topic_tags: string[];
  region: string; evidence_class: string; status: "new" | "reviewed" | "saved" | "dismissed" | "converted"; notes: string | null;
  collected_by: string | null;
}

export function useRadarSources() {
  return useQuery({ queryKey: ["radar_sources"], queryFn: () => run<RadarSource[]>(db().from("radar_sources").select("*").order("kind").order("name")) });
}
export function useLatestScan() {
  return useQuery({
    queryKey: ["radar_scan_latest"],
    queryFn: () => run<RadarScan | null>(db().from("radar_scans").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });
}
/** Latest `limit` signals; with a bounded range, every signal whose `column` falls in it. */
export function useSignals(limit = 400, range?: DateRange, column: "collected_at" | "published_at" = "collected_at") {
  const bounded = Boolean(range && isBounded(range));
  return useQuery({
    queryKey: ["radar_signals", bounded ? null : limit, range?.from, range?.to, column],
    queryFn: () => runPaged<RadarSignal>(() => withinRange(db().from("radar_signals").select("*"), column, bounded ? range : undefined)
      .order(column, { ascending: false, nullsFirst: false }).order("ref", { ascending: false }), bounded ? Infinity : limit),
  });
}

// ---------------------------------------------------------------- opportunities
export interface Opportunity {
  id: string; ref: number; title: string; audience: string | null; audience_tension: string | null; strategic_rationale: string | null;
  content_angle: string | null; suggested_format: string | null; objective: string | null; proof_checks: string | null;
  priority: string | null; scores: Record<string, number>; status: "considering" | "needs_research" | "approved" | "deferred" | "rejected" | "converted";
  next_action: string | null; decision_note: string | null; decided_by: string | null; decided_at: string | null;
  created_by: string; created_at: string; updated_at: string;
}
export function useOpportunities() {
  return useQuery({ queryKey: ["opportunities"], queryFn: () => runPaged<Opportunity>(() => db().from("opportunities").select("*").order("ref", { ascending: false })) });
}
export interface OpportunitySignalLink { opportunity_id: string; signal_id: string; linked_at: string; radar_signals: { collected_at: string } | null }
export function useOpportunitySignalLinks() {
  return useQuery({
    queryKey: ["opportunity_signal_links"],
    queryFn: () => run<OpportunitySignalLink[]>(db().from("opportunity_signals").select("opportunity_id, signal_id, linked_at, radar_signals(collected_at)") as unknown as
      PromiseLike<{ data: OpportunitySignalLink[] | null; error: { message: string } | null }>),
  });
}
export function useOpportunity(ref: number) {
  return useQuery({
    queryKey: ["opportunity", ref],
    queryFn: async () => {
      const opp = await run<Opportunity | null>(db().from("opportunities").select("*").eq("ref", ref).maybeSingle());
      if (!opp) return null;
      const [links, tasks] = await Promise.all([
        run<{ signal_id: string; linked_at: string; radar_signals: RadarSignal | null }[]>(
          db().from("opportunity_signals").select("signal_id, linked_at, radar_signals(*)").eq("opportunity_id", opp.id) as unknown as
            PromiseLike<{ data: { signal_id: string; linked_at: string; radar_signals: RadarSignal | null }[] | null; error: { message: string } | null }>),
        run<Task[]>(db().from("tasks").select("*").eq("opportunity_id", opp.id).is("removed_at", null).order("ref")),
      ]);
      return { opp, signals: links.map((l) => l.radar_signals).filter((x): x is RadarSignal => Boolean(x)), tasks };
    },
  });
}

// ---------------------------------------------------------------- AI drafts & knowledge
export interface DraftOutput {
  working_title: string; objective: string; audience: string; language: string; format_and_duration: string; core_message: string;
  hook_options: string[]; structure: { beat: string; content: string }[]; script_text: string; on_screen_text: string[]; cta: string;
  visual_direction: string; claims_requiring_review: string[]; assumptions_and_gaps: string[]; pattern_references: string[];
  evidence_used: string[]; review_flags?: string[];
}
export interface AiDraft {
  id: string; ref: number; kind: "brief" | "script"; task_id: string | null; opportunity_id: string | null; language: string | null;
  format: string | null; duration: string | null; instructions: string | null;
  status: "queued" | "running" | "ready" | "failed" | "accepted" | "discarded"; output: DraftOutput | null; model: string | null;
  knowledge_ids: string[]; signal_ids: string[]; prompt_tokens: number | null; completion_tokens: number | null; error: string | null;
  decision_note: string | null; decided_at: string | null; created_by: string; created_at: string; completed_at: string | null;
}
/** Latest 200 drafts; with a bounded range, every draft created in it. */
export function useDrafts(range?: DateRange) {
  const bounded = Boolean(range && isBounded(range));
  return useQuery({
    queryKey: ["ai_drafts", bounded ? range!.from : null, bounded ? range!.to : null],
    queryFn: () => runPaged<AiDraft>(() => withinRange(db().from("ai_drafts").select("*"), "created_at", bounded ? range : undefined)
      .order("ref", { ascending: false }), bounded ? Infinity : 200),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "queued" || d.status === "running") ? 3000 : false),
  });
}
export interface KnowledgeDoc { id: string; kind: "brand_guidelines" | "script_pattern" | "reference"; title: string; content: string; language: string | null; tags: string[]; source_note: string | null; is_active: boolean; updated_at: string }
export function useKnowledge() {
  return useQuery({ queryKey: ["knowledge"], queryFn: () => run<KnowledgeDoc[]>(db().from("knowledge_documents").select("id, kind, title, content, language, tags, source_note, is_active, updated_at").order("kind").order("title")) });
}

// ---------------------------------------------------------------- learnings
export interface Learning {
  id: string; ref: number; title: string; learning_class: string; observation: string; period_start: string | null; period_end: string | null;
  evidence: string | null; interpretation: string | null; confidence: string; limitations: string | null; next_test: string | null;
  owner_id: string | null; review_date: string | null; task_id: string | null; goal_id: string | null; opportunity_id: string | null;
  status: "pending_review" | "accepted" | "rejected" | "superseded"; decision_note: string | null; decided_by: string | null;
  decided_at: string | null; created_by: string; created_at: string;
}
export function useLearnings() {
  return useQuery({ queryKey: ["learnings"], queryFn: () => runPaged<Learning>(() => db().from("learnings").select("*").order("ref", { ascending: false })) });
}
export function useAllStages() {
  return useQuery({ queryKey: ["task_stages_all"], queryFn: () => runPaged<TaskStage>(() => db().from("task_stages").select("*").order("task_id").order("position")) });
}

/** Calls a Marketing Desk server function with the signed-in user's token. */
export async function callApi(path: string, body: unknown): Promise<Response> {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");
  return fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

export interface Health { status: string; integrations: { database: string; ai: string; reddit: string }; warnings: string[] }
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`Health check failed (${res.status})`);
      return (await res.json()) as Health;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- impact assessments (D-030)
export interface ImpactAssessment {
  id: string; ref: number; subject: "task" | "goal" | "brief"; task_id: string | null; goal_id: string | null;
  period_kind: string | null; period_from: string | null; period_to: string | null; input?: unknown;
  status: "queued" | "running" | "ready" | "failed"; output: Record<string, unknown> | null; model: string | null;
  error: string | null; created_by: string; created_at: string; completed_at: string | null;
}

/** Every assessment, newest first (they are small; the latest per task/goal is what the UI shows). */
export function useImpactAssessments() {
  return useQuery({
    queryKey: ["impact_assessments"],
    queryFn: () => runPaged<ImpactAssessment>(() => db().from("impact_assessments")
      .select("id, ref, subject, task_id, goal_id, period_kind, period_from, period_to, status, output, model, error, created_by, created_at, completed_at")
      .order("created_at", { ascending: false }).order("ref", { ascending: false })),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "queued" || a.status === "running") ? 3000 : false),
  });
}

export type AssessmentRequest =
  | { subject: "task"; task_id: string }
  | { subject: "goal"; goal_id: string }
  | { subject: "brief"; period_kind: string; period_from: string; period_to: string; input: unknown };

/** Queue an AI assessment and start the server function. If the server can't be reached, the row is marked failed, not left queued. */
export function useRequestAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: AssessmentRequest) => {
      const row = await run<{ id: string }>(db().from("impact_assessments").insert(req as Record<string, unknown>).select("id").single());
      let problem: string | null = null;
      try {
        const res = await callApi("/api/impact-assess", { assessmentId: row.id });
        if (!res.ok && res.status !== 202) problem = `The AI service could not start (${res.status}).`;
      } catch {
        problem = "The AI service could not be reached.";
      }
      if (problem) {
        const hint = location.hostname === "localhost" ? " The local preview runs without server functions; AI works on the deployed site." : "";
        await run(db().from("impact_assessments").update({ status: "failed", error: problem + hint, completed_at: new Date().toISOString() }).eq("id", row.id));
      }
      return row.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["impact_assessments"] }),
  });
}

export const EMPTY_TASK_IMPACT: TaskImpact = {
  impact_outcome: null, impact_rationale: null, impact_audience: null, impact_metrics: null,
  impact_evidence: null, impact_dependencies: null, impact_risks: null,
};
export const EMPTY_GOAL_OUTCOME: GoalOutcome = {
  outcome_statement: null, outcome_rationale: null, success_measures: null, importance: null, outcome_kind: null,
  outcome_metric: null, outcome_baseline: null, outcome_target: null, outcome_unit: null, outcome_status: "not_assessed",
  outcome_actual: null, outcome_evidence: null, outcome_assessed_at: null, outcome_assessed_by: null,
};

/** Full stage rows for a set of tasks (journey timelines). */
/** The full history of a set of tasks (oldest first), e.g. a deliverable and its tasks. */
export function useEventsFor(taskIds: string[]) {
  const key = [...taskIds].sort();
  return useQuery({
    queryKey: ["task_events_all", "for", key],
    enabled: key.length > 0,
    queryFn: () => runPaged<TaskEvent>(() => db().from("task_events").select("*").in("task_id", key).order("occurred_at").order("id"), Infinity),
  });
}

export function useStagesFor(taskIds: string[]) {
  const key = [...taskIds].sort();
  return useQuery({
    queryKey: ["task_stages_all", "for", key],
    enabled: key.length > 0,
    queryFn: () => runPaged<TaskStage>(() => db().from("task_stages").select("*").in("task_id", key).order("task_id").order("position")),
  });
}

// ---------------------------------------------------------------- Daily Ops (D-046)
// Each member's planned hours, planned blocks and punch-in/out records. The database shows a
// member only their own rows, an admin also the contributors, and Sourabh also Tanvi's.
export interface WorkDay {
  id: string; member_id: string; day: string; planned_start: string | null; planned_end: string | null;
  checked_in_at: string | null; checked_out_at: string | null; plan_changed_by: string | null; plan_changed_at: string | null;
}
export interface PlanItem {
  id: string; member_id: string; day: string; task_id: string | null; title: string | null; starts_at: string; ends_at: string;
  suggested: boolean; accepted_at: string | null; created_by: string; updated_by: string | null; removed_at: string | null;
}
export interface TaskSession {
  id: string; member_id: string; task_id: string; plan_item_id: string | null; day: string;
  started_at: string; ended_at: string | null; ended_by: string | null; note: string | null;
}
export interface OpsViewer { viewer_id: string; subject_id: string }

/** Rows of an ops table for a range of days (inclusive), ordered by day. */
function daysBetween<Q extends { gte(c: string, v: string): Q; lte(c: string, v: string): Q }>(q: Q, from: string, to: string): Q {
  return q.gte("day", from).lte("day", to);
}
export function useWorkDays(from: string, to: string) {
  return useQuery({ queryKey: ["ops", "days", from, to], queryFn: () => runPaged<WorkDay>(() => daysBetween(db().from("work_days").select("*"), from, to).order("day")) });
}
export function usePlanItems(from: string, to: string) {
  return useQuery({ queryKey: ["ops", "plan", from, to], queryFn: () => runPaged<PlanItem>(() => daysBetween(db().from("plan_items").select("*").is("removed_at", null), from, to).order("day").order("starts_at")) });
}
export function useSessions(from: string, to: string) {
  return useQuery({ queryKey: ["ops", "sessions", from, to], queryFn: () => runPaged<TaskSession>(() => daysBetween(db().from("task_sessions").select("*"), from, to).order("started_at")), refetchInterval: 60_000 });
}
/** Admin-to-admin access granted to me (e.g. Sourabh → Tanvi). */
export function useOpsViewers() {
  return useQuery({ queryKey: ["ops", "viewers"], queryFn: () => run<OpsViewer[]>(db().from("ops_viewers").select("viewer_id, subject_id")) });
}

export type OpsAction =
  | { fn: "ops_set_hours"; args: { p_member: string; p_day: string; p_start: string; p_end: string } }
  | { fn: "ops_check_in"; args: Record<string, never> }
  | { fn: "ops_check_out"; args: Record<string, never> }
  | { fn: "ops_punch_in"; args: { p_task: string; p_plan_item: string | null } }
  | { fn: "ops_punch_out"; args: { p_note: string | null } }
  | { fn: "ops_plan_save"; args: { p_id: string | null; p_member: string; p_day: string; p_task: string | null; p_title: string | null; p_start: string; p_end: string } }
  | { fn: "ops_plan_remove"; args: { p_id: string } }
  | { fn: "ops_plan_accept"; args: { p_day: string } };

export function useOpsAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: OpsAction) => run<unknown>(db().rpc(a.fn, a.args)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ops"] }),
  });
}
