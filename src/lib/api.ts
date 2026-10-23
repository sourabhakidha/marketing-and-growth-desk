// Data access for the Workspace. Every query runs as the signed-in user, so
// the database's RLS decides what is visible and what can change.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase.ts";
import { describeDbError, type Member } from "./session.tsx";

export interface VocabTerm { id: string; vocabulary: string; code: string; label: string; sort_order: number; is_active: boolean }
export interface WorkflowTemplate {
  id: string; code: string; name: string; description: string | null; default_for_task_type: string | null;
  sort_order: number; is_active: boolean;
  workflow_template_stages: { id: string; position: number; stage_code: string; is_optional: boolean }[];
}
export interface Task {
  id: string; ref: number; title: string; brief: string | null; task_type: string; work_origin: string;
  priority: string | null; status: string; owner_id: string; reviewer_id: string | null; goal_id: string | null;
  counts_toward_goal: boolean; deliverable_format: string | null; channel: string | null; requester: string | null;
  due_date: string | null; estimated_minutes: number | null; completion_criteria: string | null;
  deliverable_url: string | null; blocker_reason: string | null; workflow_template_id: string | null;
  created_by: string; created_at: string; updated_at: string; completed_at: string | null;
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
export interface Goal {
  id: string; ref: number; title: string; description: string | null; success_definition: string | null;
  owner_id: string; start_date: string | null; end_date: string | null; target_quantity: number | null;
  target_unit: string | null; progress_method: "task_checklist" | "accepted_deliverables" | "manual";
  manual_progress: number | null; status: string; completion_note: string | null; created_at: string;
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
  return { members, vocab, memberName, label, options, ready: members.isSuccess && vocab.isSuccess };
}

// ---------------------------------------------------------------- tasks
export interface TaskWithStage extends Task { task_stages: Pick<TaskStage, "id" | "stage_code" | "state" | "owner_id" | "picked_up_at" | "ready_at">[] }

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => run<TaskWithStage[]>(db().from("tasks")
      .select("*, task_stages(id, stage_code, state, owner_id, picked_up_at, ready_at)")
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
      const task = await run<Task | null>(db().from("tasks").select("*").eq("ref", ref).maybeSingle());
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
    | "requester" | "estimated_minutes" | "completion_criteria" | "reviewer_id" | "workflow_template_id" | "deliverable_url">>;

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["tasks"] }),
    qc.invalidateQueries({ queryKey: ["task"] }),
    qc.invalidateQueries({ queryKey: ["goals"] }),
    qc.invalidateQueries({ queryKey: ["goal_progress"] }),
    qc.invalidateQueries({ queryKey: ["task_events_all"] }),
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
  | { fn: "task_comment"; args: { p_task: string; p_note: string } };

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
    queryFn: () => run<Goal[]>(db().from("goals").select("*").order("ref", { ascending: false })),
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
    | "manual_progress" | "status" | "completion_note">>;

export function useSaveGoal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: GoalInput }) =>
      id ? run<null>(db().from("goals").update(input).eq("id", id))
         : run<{ ref: number }>(db().from("goals").insert(input).select("ref").single()),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------- history & exports
export function useAllTaskEvents(limit = 300) {
  return useQuery({
    queryKey: ["task_events_all", limit],
    queryFn: () => run<TaskEvent[]>(db().from("task_events").select("*").order("occurred_at", { ascending: false }).limit(limit)),
  });
}

export const fetchAll = {
  tasks: () => run<Task[]>(db().from("tasks").select("*").order("ref")),
  goals: () => run<Goal[]>(db().from("goals").select("*").order("ref")),
  goalProgress: () => run<GoalProgress[]>(db().from("goal_progress").select("*")),
  stages: () => run<TaskStage[]>(db().from("task_stages").select("*").order("task_id").order("position")),
  taskEvents: () => run<TaskEvent[]>(db().from("task_events").select("*").order("occurred_at")),
  auditEvents: () => run<AuditEvent[]>(db().from("audit_events").select("*").order("occurred_at")),
};
