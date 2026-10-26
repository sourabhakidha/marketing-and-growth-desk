-- =============================================================================
-- Akidha Marketing Desk — deliverables with parts, and channels (D-038, D-039)
--   * A task is either a normal task or a DELIVERABLE (umbrella, e.g. "Marathi
--     video for Meta ads"). A normal task may be a PART of one deliverable
--     (one level only). Parts keep their own owner, workflow and review.
--   * The deliverable carries the business impact; parts inherit it (not
--     required on parts). A deliverable has no workflow of its own and can be
--     approved only when every part is done or cancelled.
--   * Only admins change which deliverable a task belongs to after creation;
--     anyone can choose it when creating / requesting a task.
--   * Channel: a fixed list for tasks and goals (Social media, Meta ads, BTL,
--     WhatsApp, App, Packaging, Reporting, Other).
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
alter table marketing_os.vocab_terms drop constraint vocab_terms_vocabulary_check;
alter table marketing_os.vocab_terms add constraint vocab_terms_vocabulary_check check (vocabulary in (
  'task_type', 'work_origin', 'task_status', 'goal_status',
  'priority', 'workflow_stage', 'performance_area', 'channel'
));

insert into marketing_os.vocab_terms (vocabulary, code, label, sort_order) values
  ('channel', 'social_media', 'Social media', 10),
  ('channel', 'meta_ads',     'Meta ads',     20),
  ('channel', 'btl',          'BTL',          30),
  ('channel', 'whatsapp',     'WhatsApp',     40),
  ('channel', 'app',          'App',          50),
  ('channel', 'packaging',    'Packaging',    60),
  ('channel', 'reporting',    'Reporting',    70),
  ('channel', 'other',        'Other',        80);

-- existing free-text channels → the list
update marketing_os.tasks set channel = case
    when channel ilike 'meta%' then 'meta_ads'
    when channel ilike 'offline%' or channel ilike 'btl%' then 'btl'
    when channel ilike 'whatsapp%' then 'whatsapp'
    when channel ilike 'app%' then 'app'
    when channel ilike '%instagram%' or channel ilike 'social%' then 'social_media'
    when channel ilike 'packag%' then 'packaging'
    when channel ilike 'report%' then 'reporting'
    else 'other' end
 where channel is not null;

alter table marketing_os.goals add column channel text;

create function marketing_os_private.channel_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.channel is distinct from old.channel then
    perform marketing_os_private.assert_vocab('channel', new.channel, 'Channel');
  end if;
  return new;
end;
$$;
revoke all on function marketing_os_private.channel_check() from public;
create trigger tasks_channel_check before insert or update on marketing_os.tasks
  for each row execute function marketing_os_private.channel_check();
create trigger goals_channel_check before insert or update on marketing_os.goals
  for each row execute function marketing_os_private.channel_check();

-- ---------------------------------------------------------------------------
-- Deliverables and parts
-- ---------------------------------------------------------------------------
alter table marketing_os.tasks
  add column kind      text not null default 'task',
  add column parent_id uuid references marketing_os.tasks (id),
  add constraint tasks_kind check (kind in ('task', 'deliverable')),
  add constraint tasks_not_own_parent check (parent_id is distinct from id),
  add constraint tasks_deliverable_top_level check (kind = 'task' or parent_id is null);
create index tasks_parent_idx on marketing_os.tasks (parent_id);

-- runs after tasks_before_insert (which picks a default workflow)
create function marketing_os_private.tasks_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare p marketing_os.tasks;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'deliverable' then
      new.workflow_template_id := null;   -- an umbrella: progress comes from its parts
    end if;
  else
    if new.kind is distinct from old.kind then
      raise exception 'A task cannot be turned into a deliverable after creation (or back)' using errcode = '42501';
    end if;
    if new.parent_id is distinct from old.parent_id and auth.uid() is not null and not marketing_os_private.is_admin() then
      raise exception 'Only admins (Sourabh, Tanvi) can move a task into or out of a deliverable' using errcode = '42501';
    end if;
  end if;

  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select * into p from marketing_os.tasks where id = new.parent_id;
    if not found or p.kind <> 'deliverable' then raise exception 'A task can only be part of a deliverable'; end if;
    if p.removed_at is not null then raise exception 'That deliverable is in the Recycle Bin'; end if;
  end if;
  return new;
end;
$$;
revoke all on function marketing_os_private.tasks_structure() from public;
create trigger tasks_structure before insert or update on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_structure();

-- Parts inherit the deliverable's expected business impact (D-030 still applies to deliverables and standalone tasks)
create or replace function marketing_os_private.tasks_impact_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_assigning boolean;
begin
  new.impact_outcome      := nullif(btrim(new.impact_outcome), '');
  new.impact_rationale    := nullif(btrim(new.impact_rationale), '');
  new.impact_audience     := nullif(btrim(new.impact_audience), '');
  new.impact_metrics      := nullif(btrim(new.impact_metrics), '');
  new.impact_dependencies := nullif(btrim(new.impact_dependencies), '');
  new.impact_risks        := nullif(btrim(new.impact_risks), '');

  admin_assigning := auth.uid() is not null and marketing_os_private.is_admin()
    and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
    and new.parent_id is null;
  if admin_assigning and (new.impact_outcome is null or new.impact_rationale is null or new.impact_audience is null
                          or new.impact_metrics is null or new.impact_evidence is null) then
    raise exception 'Expected business impact is required when an admin creates or assigns a task: outcome, rationale, audience/channel, success metrics and evidence level'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
       (old.impact_outcome is not null and new.impact_outcome is null)
    or (old.impact_rationale is not null and new.impact_rationale is null)
    or (old.impact_audience is not null and new.impact_audience is null)
    or (old.impact_metrics is not null and new.impact_metrics is null)
    or (old.impact_evidence is not null and new.impact_evidence is null)) then
    raise exception 'Expected business impact can be revised but not removed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function marketing_os.task_review_request(p_task uuid, p_accept boolean, p_note text default null, p_owner uuid default null)
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
    if t.parent_id is null and (t.impact_outcome is null or t.impact_rationale is null or t.impact_audience is null
       or t.impact_metrics is null or t.impact_evidence is null) then
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

-- A deliverable is approved only when all its parts are finished
create or replace function marketing_os.task_decide(p_task uuid, p_approve boolean, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t marketing_os.tasks := marketing_os_private.load_task_for_action(p_task);
  active_stage uuid;
  open_parts integer;
begin
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can approve task completion' using errcode = '42501';
  end if;
  if t.status <> 'in_review' then raise exception 'Only a task that is In Review can be approved or returned'; end if;

  if p_approve then
    if t.kind = 'deliverable' then
      select count(*) into open_parts from marketing_os.tasks p
       where p.parent_id = t.id and p.removed_at is null and p.status not in ('done', 'cancelled');
      if open_parts > 0 then
        raise exception 'This deliverable still has % unfinished part(s). Finish or cancel them first.', open_parts;
      end if;
    end if;
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

-- Goal progress: count each piece of work once (a part counts through its deliverable when both serve the same goal)
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
  and (t.parent_id is null or not exists (
        select 1 from marketing_os.tasks d where d.id = t.parent_id and d.goal_id = g.id and d.removed_at is null))
group by g.id;
