-- =============================================================================
-- Akidha Marketing Desk — no task action on a task in the Recycle Bin (D-035)
-- Every workflow action (pick up, hand off, skip, rework, status, submit,
-- approve, comment, accept/decline request) loads its task through
-- load_task_for_action; refuse there so no path, admin or not, can act on a
-- deleted task. Restore it first.
-- Touches ONLY marketing_os_private.
-- =============================================================================

create or replace function marketing_os_private.load_task_for_action(p_task uuid)
returns marketing_os.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare t marketing_os.tasks;
begin
  perform marketing_os_private.require_member();
  select * into t from marketing_os.tasks where id = p_task for update;
  if not found or t.purged_at is not null then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if t.removed_at is not null then
    raise exception 'This task is in the Recycle Bin. Restore it first.' using errcode = '42501';
  end if;
  perform set_config('marketing_os.workflow_action', 'on', true);
  return t;
end;
$$;
