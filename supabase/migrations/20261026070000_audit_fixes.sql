-- =============================================================================
-- Akidha Marketing Desk — audit fixes (D-043)
-- 1. A task taken out of a deliverable becomes top-level work, so an admin must
--    give it its own expected business impact (it no longer inherits one).
-- 2. Status changes: a pending request can only be withdrawn (accept/decline is
--    done by an admin); a cancelled task can be reopened only by an admin, and a
--    request that was never accepted cannot be reopened at all.
-- 3. Wording: a deliverable's open "tasks" (not "parts") block its approval.
-- Function bodies only; no table, data or permission changes.
-- Touches ONLY marketing_os and marketing_os_private.
-- =============================================================================

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
    and new.parent_id is null
    and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id
         or old.parent_id is not null);  -- taken out of a deliverable: it no longer inherits an impact case
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

create or replace function marketing_os.task_set_status(p_task uuid, p_status text, p_note text default null)
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
  if t.status = 'requested' and p_status <> 'cancelled' then
    raise exception 'This is a request: an admin accepts or declines it first';
  end if;
  if t.status = 'cancelled' and p_status <> 'cancelled' then
    if not admin then
      raise exception 'Only admins can reopen a cancelled task' using errcode = '42501';
    end if;
    if exists (select 1 from marketing_os.task_stages s where s.task_id = t.id)
       and not exists (select 1 from marketing_os.task_stages s where s.task_id = t.id and s.entered_at is not null) then
      raise exception 'This request was never accepted, so it cannot be reopened. Ask for a new request instead.';
    end if;
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
        raise exception 'This deliverable still has % unfinished task(s). Finish or cancel them first.', open_parts;
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
