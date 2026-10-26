-- =============================================================================
-- Akidha Marketing Desk — stages held by an admin (decision D-028)
-- When a stage is handed to an admin (Sourabh, Tanvi) — typically Internal
-- Review — only an admin can move the task on (hand off = approve the stage),
-- send it back (return for rework = revision), skip, submit, block or unblock
-- it. The task owner and earlier stage owners wait for that decision.
-- Cancelling keeps its own rule (owner, creator or admin) and is unchanged.
-- Touches ONLY marketing_os_private.
-- =============================================================================

create or replace function marketing_os_private.can_work_on(t marketing_os.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when marketing_os_private.is_admin() then true
    -- an admin holds the active stage: it stays with the admins until one of them decides
    when exists (select 1 from marketing_os.task_stages s
                 join marketing_os.members m on m.id = s.owner_id
                 where s.task_id = t.id and s.state = 'active' and m.role = 'admin') then false
    else t.owner_id = marketing_os_private.current_member_id()
      or exists (select 1 from marketing_os.task_stages s
                 where s.task_id = t.id and s.state = 'active'
                   and s.owner_id = marketing_os_private.current_member_id())
  end
$$;

revoke all on function marketing_os_private.can_work_on(marketing_os.tasks) from public;
