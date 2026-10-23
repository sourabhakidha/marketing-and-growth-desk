-- =============================================================================
-- Akidha Marketing Desk — Phase 1: Workspace
-- Goals, tasks, workflow templates, per-task workflow stages, append-only task
-- events, and the actions that move work (hand-off, pick-up, return, block,
-- submit, approve). Touches ONLY marketing_os / marketing_os_private.
--
-- Business rules (docs/DECISIONS.md D-010 – D-013):
--   * any member can create a task and assign it (D-010)
--   * after creation only admins can reassign, change due date or priority
--   * owners / creators update their own work; status changes only through the
--     workflow actions below, so every change leaves an event
--   * Done requires admin approval for ALL tasks (D-011)
--   * only admins create and manage goals (D-012)
--   * task status, workflow stage, task type and work origin stay separate
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary additions (D-013: Production/Shoot and Publishing/Scheduling are
-- task types)
-- ---------------------------------------------------------------------------
insert into marketing_os.vocab_terms (vocabulary, code, label, sort_order) values
  ('task_type', 'production_shoot',      'Production / Shoot',      55),
  ('task_type', 'publishing_scheduling', 'Publishing / Scheduling', 65);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function marketing_os_private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from marketing_os.members m where m.user_id = auth.uid() and m.is_active
$$;

create function marketing_os_private.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v uuid;
begin
  v := marketing_os_private.current_member_id();
  if v is null then
    raise exception 'You do not have access to Marketing Desk' using errcode = '42501';
  end if;
  return v;
end;
$$;

create function marketing_os_private.assert_vocab(p_vocabulary text, p_code text, p_label text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_code is null then return; end if;
  if not exists (
    select 1 from marketing_os.vocab_terms v
    where v.vocabulary = p_vocabulary and v.code = p_code and v.is_active
  ) then
    raise exception '% "%" is not an active value', p_label, p_code using errcode = '23514';
  end if;
end;
$$;

-- True only inside the workflow action functions below
create function marketing_os_private.in_workflow_action()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('marketing_os.workflow_action', true), '') = 'on'
$$;

revoke all on all functions in schema marketing_os_private from public;
grant execute on function marketing_os_private.current_member_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Goals (admins create/manage; everyone reads)
-- ---------------------------------------------------------------------------
create table marketing_os.goals (
  id                 uuid primary key default gen_random_uuid(),
  ref                bigint generated always as identity unique,
  title              text not null,
  description        text,
  success_definition text,
  owner_id           uuid not null references marketing_os.members (id),
  start_date         date,
  end_date           date,
  target_quantity    numeric,
  target_unit        text,
  progress_method    text not null default 'task_checklist',
  manual_progress    numeric,
  status             text not null default 'not_started',
  completion_note    text,
  created_by         uuid references marketing_os.members (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint goals_title_not_blank check (length(btrim(title)) > 0),
  constraint goals_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint goals_target_positive check (target_quantity is null or target_quantity > 0),
  constraint goals_progress_method check (progress_method in ('task_checklist', 'accepted_deliverables', 'manual')),
  constraint goals_manual_progress check (manual_progress is null or manual_progress between 0 and 100),
  constraint goals_deliverables_need_target check (progress_method <> 'accepted_deliverables' or target_quantity is not null)
);

-- ---------------------------------------------------------------------------
-- Workflow templates
-- ---------------------------------------------------------------------------
create table marketing_os.workflow_templates (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  description           text,
  default_for_task_type text unique,
  sort_order            integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint workflow_templates_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

create table marketing_os.workflow_template_stages (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references marketing_os.workflow_templates (id) on delete cascade,
  position     integer not null,
  stage_code   text not null,
  is_optional  boolean not null default false,
  constraint workflow_template_stages_position unique (template_id, position)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table marketing_os.tasks (
  id                   uuid primary key default gen_random_uuid(),
  ref                  bigint generated always as identity unique,
  title                text not null,
  brief                text,
  task_type            text not null,
  work_origin          text not null,
  priority             text,
  status               text not null default 'not_started',
  owner_id             uuid not null references marketing_os.members (id),
  reviewer_id          uuid references marketing_os.members (id),
  goal_id              uuid references marketing_os.goals (id) on delete set null,
  counts_toward_goal   boolean not null default false,
  deliverable_format   text,
  channel              text,
  requester            text,
  due_date             date,
  estimated_minutes    integer,
  completion_criteria  text,
  deliverable_url      text,
  blocker_reason       text,
  workflow_template_id uuid references marketing_os.workflow_templates (id),
  created_by           uuid not null references marketing_os.members (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz,
  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_estimate_positive check (estimated_minutes is null or estimated_minutes > 0),
  constraint tasks_url_scheme check (deliverable_url is null or deliverable_url ~* '^https?://'),
  constraint tasks_blocked_has_reason check (status <> 'blocked' or blocker_reason is not null)
);

create index tasks_owner_idx on marketing_os.tasks (owner_id);
create index tasks_goal_idx on marketing_os.tasks (goal_id);
create index tasks_status_idx on marketing_os.tasks (status);
create index tasks_due_idx on marketing_os.tasks (due_date);

create table marketing_os.task_contributors (
  task_id    uuid not null references marketing_os.tasks (id) on delete cascade,
  member_id  uuid not null references marketing_os.members (id),
  added_at   timestamptz not null default now(),
  primary key (task_id, member_id)
);

-- A task's actual workflow (instance of a template)
create table marketing_os.task_stages (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references marketing_os.tasks (id) on delete cascade,
  position        integer not null,
  stage_code      text not null,
  is_optional     boolean not null default false,
  owner_id        uuid references marketing_os.members (id),
  state           text not null default 'pending',
  entered_at      timestamptz,
  ready_at        timestamptz,
  picked_up_at    timestamptz,
  completed_at    timestamptz,
  revision_count  integer not null default 0,
  constraint task_stages_position unique (task_id, position),
  constraint task_stages_state check (state in ('pending', 'active', 'done', 'skipped'))
);

create unique index task_stages_one_active on marketing_os.task_stages (task_id) where state = 'active';

-- Append-only history of everything that happens to a task
create table marketing_os.task_events (
  id             bigint generated always as identity primary key,
  task_id        uuid not null references marketing_os.tasks (id) on delete cascade,
  task_stage_id  uuid references marketing_os.task_stages (id) on delete set null,
  stage_code     text,
  event_type     text not null,
  actor_id       uuid references marketing_os.members (id),
  from_owner_id  uuid references marketing_os.members (id),
  to_owner_id    uuid references marketing_os.members (id),
  from_value     text,
  to_value       text,
  note           text,
  source         marketing_os.audit_source not null default 'user',
  occurred_at    timestamptz not null default now(),
  constraint task_events_type check (event_type in (
    'created', 'status_changed', 'stage_entered', 'picked_up', 'handed_off', 'stage_completed',
    'stage_skipped', 'returned_for_rework', 'blocked', 'unblocked', 'submitted_for_approval',
    'approved', 'changes_requested', 'cancelled', 'reopened', 'comment',
    'owner_changed', 'due_date_changed', 'priority_changed', 'goal_changed'
  ))
);

create index task_events_task_idx on marketing_os.task_events (task_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Event writer (definer; the only way rows get into task_events)
-- ---------------------------------------------------------------------------
create function marketing_os_private.task_event(
  p_task uuid, p_type text, p_stage uuid default null, p_from_owner uuid default null,
  p_to_owner uuid default null, p_from text default null, p_to text default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into marketing_os.task_events
    (task_id, task_stage_id, stage_code, event_type, actor_id, from_owner_id, to_owner_id, from_value, to_value, note, source)
  values
    (p_task, p_stage, (select s.stage_code from marketing_os.task_stages s where s.id = p_stage), p_type,
     marketing_os_private.current_member_id(), p_from_owner, p_to_owner, p_from, p_to, nullif(btrim(p_note), ''),
     case when auth.uid() is null then 'system'::marketing_os.audit_source else 'user'::marketing_os.audit_source end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Goal triggers
-- ---------------------------------------------------------------------------
create function marketing_os_private.goals_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform marketing_os_private.assert_vocab('goal_status', new.status, 'Goal status');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(marketing_os_private.current_member_id(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger goals_before_write before insert or update on marketing_os.goals
  for each row execute function marketing_os_private.goals_before_write();
create trigger goals_touch before update on marketing_os.goals
  for each row execute function marketing_os_private.touch_updated_at();
create trigger goals_audit after insert or update or delete on marketing_os.goals
  for each row execute function marketing_os_private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Task triggers
-- ---------------------------------------------------------------------------
create function marketing_os_private.tasks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := marketing_os_private.current_member_id();
begin
  if auth.uid() is not null then
    if me is null then raise exception 'You do not have access to Marketing Desk' using errcode = '42501'; end if;
    new.created_by := me;          -- cannot create on someone else's behalf
    new.status := 'not_started';   -- status moves only through workflow actions
    new.completed_at := null;
    new.blocker_reason := null;
  end if;
  if not exists (select 1 from marketing_os.members m where m.id = new.owner_id and m.is_active) then
    raise exception 'The task owner must be an active member';
  end if;
  perform marketing_os_private.assert_vocab('task_type', new.task_type, 'Task type');
  perform marketing_os_private.assert_vocab('work_origin', new.work_origin, 'Work origin');
  perform marketing_os_private.assert_vocab('priority', new.priority, 'Priority');
  perform marketing_os_private.assert_vocab('task_status', new.status, 'Task status');
  if new.workflow_template_id is null then
    select t.id into new.workflow_template_id
    from marketing_os.workflow_templates t
    where t.default_for_task_type = new.task_type and t.is_active;
  end if;
  return new;
end;
$$;

create function marketing_os_private.tasks_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin boolean := marketing_os_private.is_admin();
  api_user boolean := auth.uid() is not null;
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if new.status is distinct from old.status
     or new.completed_at is distinct from old.completed_at
     or new.blocker_reason is distinct from old.blocker_reason then
    if api_user and not marketing_os_private.in_workflow_action() then
      raise exception 'Status changes go through the workflow actions (start, hand off, block, submit, approve)'
        using errcode = '42501';
    end if;
  end if;

  if api_user and not admin then
    if old.status = 'done' then
      raise exception 'This task is approved and closed. Ask Sourabh or Tanvi to reopen it.' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id
       or new.due_date is distinct from old.due_date
       or new.priority is distinct from old.priority then
      raise exception 'Only admins (Sourabh, Tanvi) can reassign a task or change its due date or priority'
        using errcode = '42501';
    end if;
    if new.workflow_template_id is distinct from old.workflow_template_id then
      raise exception 'Only admins can change a task''s workflow template' using errcode = '42501';
    end if;
  end if;

  perform marketing_os_private.assert_vocab('task_type', new.task_type, 'Task type');
  perform marketing_os_private.assert_vocab('work_origin', new.work_origin, 'Work origin');
  perform marketing_os_private.assert_vocab('priority', new.priority, 'Priority');
  perform marketing_os_private.assert_vocab('task_status', new.status, 'Task status');
  return new;
end;
$$;

-- Instantiate the workflow and record creation
create function marketing_os_private.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare first_stage uuid;
begin
  insert into marketing_os.task_stages (task_id, position, stage_code, is_optional)
  select new.id, s.position, s.stage_code, s.is_optional
  from marketing_os.workflow_template_stages s
  where s.template_id = new.workflow_template_id;

  perform marketing_os_private.task_event(new.id, 'created', null, null, new.owner_id, null, new.status, null);

  select s.id into first_stage from marketing_os.task_stages s
  where s.task_id = new.id order by s.position limit 1;

  if first_stage is not null then
    update marketing_os.task_stages
       set state = 'active', owner_id = new.owner_id, entered_at = now(), ready_at = now()
     where id = first_stage;
    perform marketing_os_private.task_event(new.id, 'stage_entered', first_stage, null, new.owner_id);
  end if;
  return null;
end;
$$;

-- Record reassignment / deadline / priority / goal changes as task events
create function marketing_os_private.tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    perform marketing_os_private.task_event(new.id, 'owner_changed', null, old.owner_id, new.owner_id);
  end if;
  if new.due_date is distinct from old.due_date then
    perform marketing_os_private.task_event(new.id, 'due_date_changed', null, null, null, old.due_date::text, new.due_date::text);
  end if;
  if new.priority is distinct from old.priority then
    perform marketing_os_private.task_event(new.id, 'priority_changed', null, null, null, old.priority, new.priority);
  end if;
  if new.goal_id is distinct from old.goal_id then
    perform marketing_os_private.task_event(new.id, 'goal_changed', null, null, null, old.goal_id::text, new.goal_id::text);
  end if;
  return null;
end;
$$;

create trigger tasks_before_insert before insert on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_before_insert();
create trigger tasks_before_update before update on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_before_update();
create trigger tasks_touch before update on marketing_os.tasks
  for each row execute function marketing_os_private.touch_updated_at();
create trigger tasks_after_insert after insert on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_after_insert();
create trigger tasks_after_update after update on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_after_update();
create trigger tasks_audit after insert or update or delete on marketing_os.tasks
  for each row execute function marketing_os_private.audit_row_change();

create trigger workflow_templates_touch before update on marketing_os.workflow_templates
  for each row execute function marketing_os_private.touch_updated_at();
create trigger workflow_templates_audit after insert or update or delete on marketing_os.workflow_templates
  for each row execute function marketing_os_private.audit_row_change();

create trigger task_events_append_only before update or delete on marketing_os.task_events
  for each row execute function marketing_os_private.block_audit_mutation();
create trigger task_events_no_truncate before truncate on marketing_os.task_events
  for each statement execute function marketing_os_private.block_audit_mutation();

-- ---------------------------------------------------------------------------
-- Workflow actions (the only way to change status / stages)
-- ---------------------------------------------------------------------------
create function marketing_os_private.load_task_for_action(p_task uuid)
returns marketing_os.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare t marketing_os.tasks;
begin
  perform marketing_os_private.require_member();
  select * into t from marketing_os.tasks where id = p_task for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  perform set_config('marketing_os.workflow_action', 'on', true);
  return t;
end;
$$;

create function marketing_os_private.end_workflow_action()
returns void
language sql
set search_path = ''
as $$
  select set_config('marketing_os.workflow_action', '', true)
$$;

-- Admin, task owner, or owner of the active stage
create function marketing_os_private.can_work_on(t marketing_os.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select marketing_os_private.is_admin()
      or t.owner_id = marketing_os_private.current_member_id()
      or exists (select 1 from marketing_os.task_stages s
                 where s.task_id = t.id and s.state = 'active'
                   and s.owner_id = marketing_os_private.current_member_id())
$$;

create function marketing_os_private.set_task_status(t marketing_os.tasks, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if t.status = p_status then return; end if;
  update marketing_os.tasks
     set status = p_status,
         blocker_reason = case when p_status = 'blocked' then btrim(p_note) else null end,
         completed_at = case when p_status = 'done' then now() else null end
   where id = t.id;
  perform marketing_os_private.task_event(t.id, 'status_changed', null, null, null, t.status, p_status, p_note);
end;
$$;

create function marketing_os.task_pick_up(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  s marketing_os.task_stages;
  me uuid := marketing_os_private.current_member_id();
begin
  if t.status in ('done', 'cancelled') then raise exception 'This task is closed'; end if;
  select * into s from marketing_os.task_stages where task_id = t.id and state = 'active';
  if not found then raise exception 'This task has no active stage'; end if;
  if s.owner_id is distinct from me and not marketing_os_private.is_admin() then
    raise exception 'Only the stage owner can pick this up' using errcode = '42501';
  end if;
  if s.picked_up_at is null then
    update marketing_os.task_stages set picked_up_at = now() where id = s.id;
    perform marketing_os_private.task_event(t.id, 'picked_up', s.id, null, s.owner_id);
  end if;
  if t.status in ('not_started', 'changes_requested') then
    perform marketing_os_private.set_task_status(t, 'in_progress');
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_hand_off(p_task uuid, p_next_owner uuid default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  cur marketing_os.task_stages;
  nxt marketing_os.task_stages;
  next_owner uuid;
begin
  if not marketing_os_private.can_work_on(t) then
    raise exception 'Only the task owner, the stage owner or an admin can hand this off' using errcode = '42501';
  end if;
  if t.status in ('done', 'cancelled', 'blocked', 'in_review') then
    raise exception 'A % task cannot be handed off', replace(t.status, '_', ' ');
  end if;
  select * into cur from marketing_os.task_stages where task_id = t.id and state = 'active';
  if not found then raise exception 'This task has no active stage'; end if;
  select * into nxt from marketing_os.task_stages
   where task_id = t.id and state = 'pending' and position > cur.position
   order by position limit 1;
  if not found then
    raise exception 'This is the last stage. Submit the task for approval instead.';
  end if;
  next_owner := coalesce(p_next_owner, t.owner_id);
  if not exists (select 1 from marketing_os.members m where m.id = next_owner and m.is_active) then
    raise exception 'The next owner must be an active member';
  end if;

  update marketing_os.task_stages set state = 'done', completed_at = now() where id = cur.id;
  perform marketing_os_private.task_event(t.id, 'stage_completed', cur.id, null, null, null, null, p_note);
  update marketing_os.task_stages
     set state = 'active', owner_id = next_owner, entered_at = now(), ready_at = now(),
         picked_up_at = null, completed_at = null
   where id = nxt.id;
  perform marketing_os_private.task_event(t.id, 'handed_off', nxt.id, cur.owner_id, next_owner, cur.stage_code, nxt.stage_code, p_note);
  if t.status in ('not_started', 'changes_requested') then
    perform marketing_os_private.set_task_status(t, 'in_progress');
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_skip_stage(p_task uuid, p_stage uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  s marketing_os.task_stages;
begin
  if not marketing_os_private.can_work_on(t) then
    raise exception 'Only the task owner, the stage owner or an admin can change stages' using errcode = '42501';
  end if;
  select * into s from marketing_os.task_stages where id = p_stage and task_id = t.id;
  if not found or s.state <> 'pending' then raise exception 'Only an upcoming stage can be skipped'; end if;
  update marketing_os.task_stages set state = 'skipped' where id = s.id;
  perform marketing_os_private.task_event(t.id, 'stage_skipped', s.id, null, null, null, null, p_note);
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_return_for_rework(p_task uuid, p_to_stage uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  cur marketing_os.task_stages;
  target marketing_os.task_stages;
begin
  if not marketing_os_private.can_work_on(t) then
    raise exception 'Only the task owner, the stage owner or an admin can return work' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the rework'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'This task is closed'; end if;
  select * into cur from marketing_os.task_stages where task_id = t.id and state = 'active';
  select * into target from marketing_os.task_stages where id = p_to_stage and task_id = t.id;
  if not found or target.state <> 'done' then raise exception 'Choose a completed earlier stage to return to'; end if;
  if cur.id is not null and target.position >= cur.position then raise exception 'Choose an earlier stage'; end if;

  -- stages after the target go back to pending (history stays in task_events)
  update marketing_os.task_stages
     set state = 'pending', picked_up_at = null, completed_at = null
   where task_id = t.id and position > target.position and state in ('active', 'done');
  update marketing_os.task_stages
     set state = 'active', entered_at = now(), ready_at = now(), picked_up_at = null,
         completed_at = null, revision_count = revision_count + 1
   where id = target.id;
  perform marketing_os_private.task_event(t.id, 'returned_for_rework', target.id, cur.owner_id, target.owner_id,
    cur.stage_code, target.stage_code, p_reason);
  if t.status not in ('in_progress', 'blocked') then
    perform marketing_os_private.set_task_status(t, 'in_progress');
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_set_status(p_task uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  admin boolean := marketing_os_private.is_admin();
  me uuid := marketing_os_private.current_member_id();
begin
  if p_status not in ('not_started', 'in_progress', 'blocked', 'cancelled') then
    raise exception 'Use Submit for approval / Approve for review statuses';
  end if;
  if t.status = 'done' and not admin then
    raise exception 'Only admins can reopen an approved task' using errcode = '42501';
  end if;
  if p_status = 'cancelled' and not (admin or t.owner_id = me or t.created_by = me) then
    raise exception 'Only the owner, the creator or an admin can cancel a task' using errcode = '42501';
  end if;
  if p_status <> 'cancelled' and not marketing_os_private.can_work_on(t) then
    raise exception 'Only the task owner, the stage owner or an admin can change status' using errcode = '42501';
  end if;
  if p_status in ('blocked', 'cancelled') and coalesce(btrim(p_note), '') = '' then
    raise exception 'Give a reason';
  end if;

  if t.status = 'blocked' and p_status <> 'blocked' then
    perform marketing_os_private.task_event(t.id, 'unblocked', null, null, null, t.blocker_reason, null, p_note);
  end if;
  if t.status = 'done' then
    perform marketing_os_private.task_event(t.id, 'reopened', null, null, null, null, null, p_note);
    -- reopening resumes at the last stage
    update marketing_os.task_stages set state = 'active', completed_at = null
     where id = (select id from marketing_os.task_stages where task_id = t.id and state = 'done'
                 order by position desc limit 1)
       and not exists (select 1 from marketing_os.task_stages where task_id = t.id and state = 'active');
  end if;
  perform marketing_os_private.set_task_status(t, p_status, p_note);
  if p_status = 'blocked' then
    perform marketing_os_private.task_event(t.id, 'blocked', null, null, null, null, null, p_note);
  elsif p_status = 'cancelled' then
    perform marketing_os_private.task_event(t.id, 'cancelled', null, null, null, null, null, p_note);
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_submit_for_approval(p_task uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
begin
  if not marketing_os_private.can_work_on(t) then
    raise exception 'Only the task owner, the stage owner or an admin can submit this' using errcode = '42501';
  end if;
  if t.status in ('done', 'cancelled', 'blocked', 'in_review') then
    raise exception 'A % task cannot be submitted', replace(t.status, '_', ' ');
  end if;
  perform marketing_os_private.set_task_status(t, 'in_review', p_note);
  perform marketing_os_private.task_event(t.id, 'submitted_for_approval', null, null, null, null, null, p_note);
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_decide(p_task uuid, p_approve boolean, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  active_stage uuid;
begin
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can approve task completion' using errcode = '42501';
  end if;
  if t.status <> 'in_review' then raise exception 'Only a task that is In Review can be approved or returned'; end if;

  if p_approve then
    select id into active_stage from marketing_os.task_stages where task_id = t.id and state = 'active';
    update marketing_os.task_stages set state = 'done', completed_at = now()
     where task_id = t.id and state = 'active';
    update marketing_os.task_stages set state = 'skipped'
     where task_id = t.id and state = 'pending';
    perform marketing_os_private.set_task_status(t, 'done', p_feedback);
    perform marketing_os_private.task_event(t.id, 'approved', active_stage, null, null, null, null, p_feedback);
  else
    if coalesce(btrim(p_feedback), '') = '' then raise exception 'Give feedback when requesting changes'; end if;
    perform marketing_os_private.set_task_status(t, 'changes_requested', p_feedback);
    perform marketing_os_private.task_event(t.id, 'changes_requested', null, null, null, null, null, p_feedback);
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;

create function marketing_os.task_comment(p_task uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write a comment'; end if;
  perform marketing_os_private.task_event(t.id, 'comment', null, null, null, null, null, p_note);
  perform marketing_os_private.end_workflow_action();
end;
$$;

revoke all on all functions in schema marketing_os from public;
revoke all on all functions in schema marketing_os_private from public;
grant execute on function marketing_os_private.current_member_id() to authenticated, service_role;
grant execute on function marketing_os_private.current_member_role() to authenticated, service_role;
grant execute on function marketing_os_private.is_member() to authenticated, service_role;
grant execute on function marketing_os_private.is_admin() to authenticated, service_role;
grant execute on function marketing_os.task_pick_up(uuid) to authenticated;
grant execute on function marketing_os.task_hand_off(uuid, uuid, text) to authenticated;
grant execute on function marketing_os.task_skip_stage(uuid, uuid, text) to authenticated;
grant execute on function marketing_os.task_return_for_rework(uuid, uuid, text) to authenticated;
grant execute on function marketing_os.task_set_status(uuid, text, text) to authenticated;
grant execute on function marketing_os.task_submit_for_approval(uuid, text) to authenticated;
grant execute on function marketing_os.task_decide(uuid, boolean, text) to authenticated;
grant execute on function marketing_os.task_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Goal progress (computed from the goal's declared progress method)
-- ---------------------------------------------------------------------------
create view marketing_os.goal_progress
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
left join marketing_os.tasks t on t.goal_id = g.id
group by g.id;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table marketing_os.goals                    enable row level security;
alter table marketing_os.goals                    force row level security;
alter table marketing_os.workflow_templates       enable row level security;
alter table marketing_os.workflow_templates       force row level security;
alter table marketing_os.workflow_template_stages enable row level security;
alter table marketing_os.workflow_template_stages force row level security;
alter table marketing_os.tasks                    enable row level security;
alter table marketing_os.tasks                    force row level security;
alter table marketing_os.task_contributors        enable row level security;
alter table marketing_os.task_contributors        force row level security;
alter table marketing_os.task_stages              enable row level security;
alter table marketing_os.task_stages              force row level security;
alter table marketing_os.task_events              enable row level security;
alter table marketing_os.task_events              force row level security;

create policy goals_select on marketing_os.goals for select to authenticated
  using (marketing_os_private.is_member());
create policy goals_insert on marketing_os.goals for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy goals_update on marketing_os.goals for update to authenticated
  using (marketing_os_private.is_admin()) with check (marketing_os_private.is_admin());

create policy workflow_templates_select on marketing_os.workflow_templates for select to authenticated
  using (marketing_os_private.is_member());
create policy workflow_templates_insert on marketing_os.workflow_templates for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy workflow_templates_update on marketing_os.workflow_templates for update to authenticated
  using (marketing_os_private.is_admin()) with check (marketing_os_private.is_admin());

create policy workflow_template_stages_select on marketing_os.workflow_template_stages for select to authenticated
  using (marketing_os_private.is_member());
create policy workflow_template_stages_write on marketing_os.workflow_template_stages for all to authenticated
  using (marketing_os_private.is_admin()) with check (marketing_os_private.is_admin());

create policy tasks_select on marketing_os.tasks for select to authenticated
  using (marketing_os_private.is_member());
create policy tasks_insert on marketing_os.tasks for insert to authenticated
  with check (marketing_os_private.is_member());
create policy tasks_update on marketing_os.tasks for update to authenticated
  using (marketing_os_private.is_admin()
         or owner_id = marketing_os_private.current_member_id()
         or created_by = marketing_os_private.current_member_id())
  with check (marketing_os_private.is_member());

create policy task_contributors_select on marketing_os.task_contributors for select to authenticated
  using (marketing_os_private.is_member());
create policy task_contributors_write on marketing_os.task_contributors for all to authenticated
  using (marketing_os_private.is_admin() or exists (
           select 1 from marketing_os.tasks t where t.id = task_id
             and (t.owner_id = marketing_os_private.current_member_id()
                  or t.created_by = marketing_os_private.current_member_id())))
  with check (marketing_os_private.is_admin() or exists (
           select 1 from marketing_os.tasks t where t.id = task_id
             and (t.owner_id = marketing_os_private.current_member_id()
                  or t.created_by = marketing_os_private.current_member_id())));

create policy task_stages_select on marketing_os.task_stages for select to authenticated
  using (marketing_os_private.is_member());
-- stage changes happen only through the workflow action functions

create policy task_events_select on marketing_os.task_events for select to authenticated
  using (marketing_os_private.is_member());

-- ---------------------------------------------------------------------------
-- Privileges (explicit; nothing for anon)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema marketing_os from public, anon;
grant select, insert, update on marketing_os.goals                    to authenticated;
grant select, insert, update on marketing_os.workflow_templates       to authenticated;
grant select, insert, update, delete on marketing_os.workflow_template_stages to authenticated;
grant select, insert, update on marketing_os.tasks                    to authenticated;
grant select, insert, delete on marketing_os.task_contributors        to authenticated;
grant select                 on marketing_os.task_stages              to authenticated;
grant select                 on marketing_os.task_events              to authenticated;
grant select                 on marketing_os.goal_progress            to authenticated;

grant select on marketing_os.goals, marketing_os.tasks, marketing_os.task_stages,
  marketing_os.task_events, marketing_os.workflow_templates, marketing_os.workflow_template_stages,
  marketing_os.task_contributors, marketing_os.goal_progress to service_role;

-- ---------------------------------------------------------------------------
-- Seed workflow templates (Playbook §9 scenarios A–H; stages are the shared
-- vocabulary in Playbook §8 — irrelevant stages can be skipped per task)
-- ---------------------------------------------------------------------------
insert into marketing_os.workflow_templates (code, name, description, default_for_task_type, sort_order) values
  ('strategy',      'Strategy / campaign / series',  'Playbook §9A: brief, research and concepts, strategy review, approval.', 'content_strategy',     10),
  ('script_copy',   'Script or copy',                'Playbook §9B: brief → writing → review → revisions → approval → handoff.', 'content_development',  20),
  ('ai_image',      'AI image generation',           'Bible §6.2: brief/references → prompts & variants → human selection → refinement → approval.', 'ai_image_generation', 30),
  ('ai_video',      'AI video / AI B-roll',          'Playbook §9E: brief → prompt & shot planning → generation → select/check → edit → review → approval.', 'ai_video_generation', 40),
  ('design_asset',  'Static, carousel, banner or leaflet', 'Playbook §9C: brief → concept/copy → design → review → revisions → approval → handoff.', 'graphic_designing', 50),
  ('shoot',         'Production / shoot',            'Plan the shoot, capture footage/assets, hand over to editing.', 'production_shoot',   55),
  ('edit',          'Video edit',                    'Assemble ready footage/assets into the cut, review, approve.', 'editing',            60),
  ('publishing',    'Publishing / scheduling',       'Final check, then schedule or publish the approved asset.', 'publishing_scheduling', 65),
  ('reporting',     'Reporting & analysis',          'Playbook §9H: question → data collection & analysis → review → share.', 'reporting_analysis', 70),
  ('ad_hoc',        'Ad hoc request',                'Playbook §9G: intake/triage → execution → review → approval.', 'ad_hoc',            80),
  ('video_full',    'Video with script, shoot and edit', 'Playbook §9D: end-to-end video in one task.', null, 90),
  ('trend_news',    'Trend / news response',         'Playbook §9F: record source → assess → rapid brief → write → review → publish while relevant.', null, 100);

insert into marketing_os.workflow_template_stages (template_id, position, stage_code, is_optional)
select t.id, s.position, s.stage_code, s.is_optional
from marketing_os.workflow_templates t
join (values
  ('strategy', 1, 'brief_intake', false), ('strategy', 2, 'ideation_research', false),
  ('strategy', 3, 'writing_scripting', true), ('strategy', 4, 'internal_review', false),
  ('strategy', 5, 'revisions', true), ('strategy', 6, 'approval', false),

  ('script_copy', 1, 'brief_intake', false), ('script_copy', 2, 'writing_scripting', false),
  ('script_copy', 3, 'internal_review', false), ('script_copy', 4, 'revisions', true),
  ('script_copy', 5, 'approval', false), ('script_copy', 6, 'scheduling_handoff', true),

  ('ai_image', 1, 'brief_intake', false), ('ai_image', 2, 'asset_creation', false),
  ('ai_image', 3, 'internal_review', false), ('ai_image', 4, 'revisions', true),
  ('ai_image', 5, 'approval', false),

  ('ai_video', 1, 'brief_intake', false), ('ai_video', 2, 'production_planning', false),
  ('ai_video', 3, 'asset_creation', false), ('ai_video', 4, 'internal_review', false),
  ('ai_video', 5, 'editing_assembly', true), ('ai_video', 6, 'final_review', false),
  ('ai_video', 7, 'approval', false), ('ai_video', 8, 'scheduling_handoff', true),

  ('design_asset', 1, 'brief_intake', false), ('design_asset', 2, 'writing_scripting', true),
  ('design_asset', 3, 'asset_creation', false), ('design_asset', 4, 'internal_review', false),
  ('design_asset', 5, 'revisions', true), ('design_asset', 6, 'approval', false),
  ('design_asset', 7, 'scheduling_handoff', true),

  ('shoot', 1, 'brief_intake', false), ('shoot', 2, 'production_planning', false),
  ('shoot', 3, 'asset_creation', false), ('shoot', 4, 'scheduling_handoff', false),

  ('edit', 1, 'brief_intake', false), ('edit', 2, 'editing_assembly', false),
  ('edit', 3, 'internal_review', false), ('edit', 4, 'revisions', true),
  ('edit', 5, 'final_review', false), ('edit', 6, 'approval', false),

  ('publishing', 1, 'brief_intake', false), ('publishing', 2, 'final_review', false),
  ('publishing', 3, 'scheduling_handoff', false),

  ('reporting', 1, 'brief_intake', false), ('reporting', 2, 'ideation_research', false),
  ('reporting', 3, 'internal_review', false), ('reporting', 4, 'scheduling_handoff', false),

  ('ad_hoc', 1, 'brief_intake', false), ('ad_hoc', 2, 'writing_scripting', true),
  ('ad_hoc', 3, 'asset_creation', true), ('ad_hoc', 4, 'internal_review', false),
  ('ad_hoc', 5, 'approval', false),

  ('video_full', 1, 'brief_intake', false), ('video_full', 2, 'writing_scripting', false),
  ('video_full', 3, 'internal_review', false), ('video_full', 4, 'revisions', true),
  ('video_full', 5, 'production_planning', false), ('video_full', 6, 'asset_creation', false),
  ('video_full', 7, 'editing_assembly', false), ('video_full', 8, 'final_review', false),
  ('video_full', 9, 'approval', false), ('video_full', 10, 'scheduling_handoff', true),

  ('trend_news', 1, 'brief_intake', false), ('trend_news', 2, 'ideation_research', false),
  ('trend_news', 3, 'writing_scripting', false), ('trend_news', 4, 'internal_review', false),
  ('trend_news', 5, 'approval', false), ('trend_news', 6, 'scheduling_handoff', false)
) as s(code, position, stage_code, is_optional) on s.code = t.code;
