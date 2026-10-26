-- =============================================================================
-- Akidha Marketing Desk — Recycle Bin for tasks and goals (decision D-035)
-- Nothing is ever deleted from the database. Admins (Sourabh, Tanvi) can:
--   * Delete            → the task/goal moves to the Recycle Bin (hidden from
--                         every desk view; restorable). A reason is required.
--   * Restore           → back where it was.
--   * Delete permanently → removed from the desk entirely (not shown anywhere,
--                         not even in the Bin). The row and its history stay in
--                         the database and in the audit log.
-- Only these functions can change the bin columns. Contributors cannot.
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

alter table marketing_os.tasks
  add column removed_at     timestamptz,
  add column removed_by     uuid references marketing_os.members (id),
  add column removed_reason text,
  add column purged_at      timestamptz,
  add column purged_by      uuid references marketing_os.members (id),
  add constraint tasks_purged_from_bin check (purged_at is null or removed_at is not null);

alter table marketing_os.goals
  add column removed_at     timestamptz,
  add column removed_by     uuid references marketing_os.members (id),
  add column removed_reason text,
  add column purged_at      timestamptz,
  add column purged_by      uuid references marketing_os.members (id),
  add constraint goals_purged_from_bin check (purged_at is null or removed_at is not null);

create index tasks_removed_idx on marketing_os.tasks (removed_at);
create index goals_removed_idx on marketing_os.goals (removed_at);

-- True only inside the bin functions below
create function marketing_os_private.in_bin_action()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('marketing_os.bin_action', true), '') = 'on'
$$;
revoke all on function marketing_os_private.in_bin_action() from public;

create function marketing_os_private.bin_columns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.removed_at, new.removed_by, new.removed_reason, new.purged_at, new.purged_by)
     is distinct from (old.removed_at, old.removed_by, old.removed_reason, old.purged_at, old.purged_by)
     and not marketing_os_private.in_bin_action() then
    raise exception 'Use Delete / Restore / Delete permanently to change the Recycle Bin' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function marketing_os_private.bin_columns_guard() from public;

create trigger tasks_bin_guard before update on marketing_os.tasks
  for each row execute function marketing_os_private.bin_columns_guard();
create trigger goals_bin_guard before update on marketing_os.goals
  for each row execute function marketing_os_private.bin_columns_guard();

-- New rows never start in the bin
create function marketing_os_private.bin_columns_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.removed_at := null; new.removed_by := null; new.removed_reason := null;
  new.purged_at := null; new.purged_by := null;
  return new;
end;
$$;
revoke all on function marketing_os_private.bin_columns_on_insert() from public;
create trigger tasks_bin_insert before insert on marketing_os.tasks
  for each row execute function marketing_os_private.bin_columns_on_insert();
create trigger goals_bin_insert before insert on marketing_os.goals
  for each row execute function marketing_os_private.bin_columns_on_insert();

-- No workflow action runs on a task in the bin
create or replace function marketing_os_private.can_work_on(t marketing_os.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.removed_at is not null then false
    when t.status = 'requested' then false
    when marketing_os_private.is_admin() then true
    -- an admin holds the active stage: it stays with the admins until one of them decides (D-028)
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

-- ---------------------------------------------------------------------------
-- Bin actions (admins only)
-- ---------------------------------------------------------------------------
create function marketing_os_private.require_admin_for_bin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare me uuid := marketing_os_private.require_member();
begin
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can delete, restore or permanently delete' using errcode = '42501';
  end if;
  return me;
end;
$$;
revoke all on function marketing_os_private.require_admin_for_bin() from public;

create function marketing_os.task_remove(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for deleting'; end if;
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.tasks set removed_at = now(), removed_by = me, removed_reason = btrim(p_reason)
   where id = p_task and removed_at is null;
  if not found then raise exception 'Task not found or already in the Recycle Bin'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

create function marketing_os.task_restore(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.tasks set removed_at = null, removed_by = null, removed_reason = null
   where id = p_task and removed_at is not null and purged_at is null;
  if not found then raise exception 'Only a task in the Recycle Bin can be restored'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

create function marketing_os.task_purge(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.tasks set purged_at = now(), purged_by = me
   where id = p_task and removed_at is not null and purged_at is null;
  if not found then raise exception 'Only a task in the Recycle Bin can be deleted permanently'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

create function marketing_os.goal_remove(p_goal uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for deleting'; end if;
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.goals set removed_at = now(), removed_by = me, removed_reason = btrim(p_reason)
   where id = p_goal and removed_at is null;
  if not found then raise exception 'Goal not found or already in the Recycle Bin'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

create function marketing_os.goal_restore(p_goal uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.goals set removed_at = null, removed_by = null, removed_reason = null
   where id = p_goal and removed_at is not null and purged_at is null;
  if not found then raise exception 'Only a goal in the Recycle Bin can be restored'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

create function marketing_os.goal_purge(p_goal uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := marketing_os_private.require_admin_for_bin();
begin
  perform set_config('marketing_os.bin_action', 'on', true);
  update marketing_os.goals set purged_at = now(), purged_by = me
   where id = p_goal and removed_at is not null and purged_at is null;
  if not found then raise exception 'Only a goal in the Recycle Bin can be deleted permanently'; end if;
  perform set_config('marketing_os.bin_action', '', true);
end;
$$;

revoke all on function marketing_os.task_remove(uuid, text), marketing_os.task_restore(uuid), marketing_os.task_purge(uuid),
  marketing_os.goal_remove(uuid, text), marketing_os.goal_restore(uuid), marketing_os.goal_purge(uuid) from public;
grant execute on function marketing_os.task_remove(uuid, text), marketing_os.task_restore(uuid), marketing_os.task_purge(uuid),
  marketing_os.goal_remove(uuid, text), marketing_os.goal_restore(uuid), marketing_os.goal_purge(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Goal progress counts only tasks that are on the desk
-- ---------------------------------------------------------------------------
create or replace view marketing_os.goal_progress
with (security_invoker = true)
as
select
  g.id as goal_id,
  count(t.id) filter (where t.status <> 'cancelled')                           as linked_tasks,
  count(t.id) filter (where t.status = 'done')                                 as done_tasks,
  count(t.id) filter (where t.status = 'done' and t.counts_toward_goal)        as accepted_deliverables,
  case g.progress_method
    when 'task_checklist' then
      case when count(t.id) filter (where t.status <> 'cancelled') = 0 then null
           else round(100.0 * count(t.id) filter (where t.status = 'done')
                      / count(t.id) filter (where t.status <> 'cancelled')) end
    when 'accepted_deliverables' then
      least(100, round(100.0 * count(t.id) filter (where t.status = 'done' and t.counts_toward_goal)
                       / nullif(g.target_quantity, 0)))
    else g.manual_progress
  end as progress_pct
from marketing_os.goals g
left join marketing_os.tasks t on t.goal_id = g.id and t.removed_at is null
group by g.id;
