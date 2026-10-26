-- =============================================================================
-- Akidha Marketing Desk — task requests (decision D-033)
--   * A contributor's new task is a REQUEST (status "requested"): its workflow
--     does not start until an admin accepts it (with its expected business
--     impact filled in) or declines it with a reason.
--   * Visibility is unchanged: every member still sees all work. The Team / Me
--     switch in the app only narrows what is shown.
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

insert into marketing_os.vocab_terms (vocabulary, code, label, sort_order)
values ('task_status', 'requested', 'Requested', 5);

alter table marketing_os.task_events drop constraint task_events_type;
alter table marketing_os.task_events add constraint task_events_type check (event_type in (
  'created', 'status_changed', 'stage_entered', 'picked_up', 'handed_off', 'stage_completed',
  'stage_skipped', 'returned_for_rework', 'blocked', 'unblocked', 'submitted_for_approval',
  'approved', 'changes_requested', 'cancelled', 'reopened', 'comment',
  'owner_changed', 'due_date_changed', 'priority_changed', 'goal_changed', 'publish_date_changed',
  'request_accepted', 'request_declined'
));

-- ---------------------------------------------------------------------------
-- Requests: a contributor's new task starts as "requested"
-- (runs after tasks_before_insert, which sets "not_started")
-- ---------------------------------------------------------------------------
create function marketing_os_private.tasks_request_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not marketing_os_private.is_admin() then
    new.status := 'requested';
  end if;
  return new;
end;
$$;
revoke all on function marketing_os_private.tasks_request_gate() from public;

create trigger tasks_request_gate before insert on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_request_gate();

-- Instantiate the workflow; a request's first stage waits for acceptance
create or replace function marketing_os_private.tasks_after_insert()
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

  if new.status = 'requested' then return null; end if;

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

-- No workflow action runs on a request; it is accepted or declined first.
-- (Cancelling — withdrawing a request — keeps its own owner/creator/admin rule.)
create or replace function marketing_os_private.can_work_on(t marketing_os.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
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

create function marketing_os.task_review_request(p_task uuid, p_accept boolean, p_note text default null, p_owner uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  new_owner uuid;
  first_stage uuid;
begin
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can accept or decline task requests' using errcode = '42501';
  end if;
  if t.status <> 'requested' then raise exception 'This task is not waiting for acceptance'; end if;

  if p_accept then
    if t.impact_outcome is null or t.impact_rationale is null or t.impact_audience is null
       or t.impact_metrics is null or t.impact_evidence is null then
      raise exception 'Fill in the expected business impact before accepting (edit the task first)' using errcode = '23514';
    end if;
    new_owner := coalesce(p_owner, t.owner_id);
    if not exists (select 1 from marketing_os.members m where m.id = new_owner and m.is_active) then
      raise exception 'The owner must be an active member';
    end if;
    if new_owner is distinct from t.owner_id then
      update marketing_os.tasks set owner_id = new_owner where id = t.id;
    end if;
    perform marketing_os_private.set_task_status(t, 'not_started', p_note);
    perform marketing_os_private.task_event(t.id, 'request_accepted', null, null, new_owner, null, null, p_note);
    select s.id into first_stage from marketing_os.task_stages s where s.task_id = t.id order by s.position limit 1;
    if first_stage is not null then
      update marketing_os.task_stages
         set state = 'active', owner_id = new_owner, entered_at = now(), ready_at = now()
       where id = first_stage;
      perform marketing_os_private.task_event(t.id, 'stage_entered', first_stage, null, new_owner);
    end if;
  else
    if coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for declining'; end if;
    perform marketing_os_private.set_task_status(t, 'cancelled', p_note);
    perform marketing_os_private.task_event(t.id, 'request_declined', null, null, null, null, null, p_note);
  end if;
  perform marketing_os_private.end_workflow_action();
end;
$$;
revoke all on function marketing_os.task_review_request(uuid, boolean, text, uuid) from public;
grant execute on function marketing_os.task_review_request(uuid, boolean, text, uuid) to authenticated;
