import { useState } from "react";
import { useNavigate } from "react-router";
import { Modal } from "../components/Modal.tsx";
import { useCreateTask, useSaveGoal } from "../lib/api.ts";
import { useMember } from "../lib/session.tsx";
import { emptyGoal, GoalForm, valuesToGoal } from "./GoalForm.tsx";
import { TaskForm, type TaskFormValues, valuesToTask } from "./TaskForm.tsx";

const emptyTask = (ownerId: string): TaskFormValues => ({
  title: "", task_type: "", work_origin: "", owner_id: ownerId, priority: "", due_date: "", goal_id: "",
  counts_toward_goal: false, brief: "", deliverable_format: "", channel: "", requester: "", estimate_hours: "",
  completion_criteria: "", reviewer_id: "", workflow_template_id: "", deliverable_url: "", publish_date: "",
});

/** The single "New activity" entry point (Bible §5.1): choose Task or Goal. */
export function NewActivityButton() {
  const { member } = useMember();
  const isAdmin = member.role === "admin";
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"task" | "goal">("task");
  const createTask = useCreateTask();
  const saveGoal = useSaveGoal();
  const navigate = useNavigate();

  function close() {
    setOpen(false);
    createTask.reset();
    saveGoal.reset();
  }

  return (
    <>
      <button type="button" className="button button--primary" onClick={() => { setKind("task"); setOpen(true); }}>
        + New activity
      </button>
      <Modal title="New activity" open={open} onClose={close} wide>
        <div className="segmented" role="radiogroup" aria-label="Activity type">
          <button type="button" role="radio" aria-checked={kind === "task"} className={kind === "task" ? "is-on" : ""} onClick={() => setKind("task")}>Task</button>
          <button type="button" role="radio" aria-checked={kind === "goal"} className={kind === "goal" ? "is-on" : ""} onClick={() => setKind("goal")}>Goal</button>
        </div>
        <p className="muted small">
          {kind === "task"
            ? "A specific piece of work with one owner. It can stand alone or contribute to a goal."
            : "A larger outcome over a timeframe, advanced by linked tasks. Only admins create goals."}
        </p>
        {kind === "task" && (
          <TaskForm
            key="task"
            mode="create"
            initial={emptyTask(member.id)}
            restrictedEditable
            busy={createTask.isPending}
            error={createTask.error}
            onCancel={close}
            onSubmit={(v) => createTask.mutate(
              { ...valuesToTask(v), created_by: member.id },
              { onSuccess: (row) => { close(); navigate(`/workspace/tasks/${row.ref}`); } },
            )}
          />
        )}
        {kind === "goal" && !isAdmin && (
          <p className="state state--warning">Only Sourabh or Tanvi can create goals. Ask an admin, or create a task now and link it later.</p>
        )}
        {kind === "goal" && isAdmin && (
          <GoalForm
            key="goal"
            mode="create"
            initial={emptyGoal(member.id)}
            busy={saveGoal.isPending}
            error={saveGoal.error}
            onCancel={close}
            onSubmit={(v) => saveGoal.mutate({ input: valuesToGoal(v) }, { onSuccess: () => { close(); navigate("/workspace/goals"); } })}
          />
        )}
      </Modal>
    </>
  );
}
