-- =============================================================================
-- Akidha Marketing Desk — Business Impact layer (decision D-030)
--   * Tasks carry an Expected Business Impact, separate from Brief / Completion
--     criteria. It is mandatory when an admin creates or (re)assigns a task.
--   * Goals carry an Expected Business Outcome, Rationale and Success Measures
--     (mandatory), an optional measurable target, an importance, and a recorded
--     outcome status that is separate from task-completion progress.
--   * AI impact assessments (task / goal / period brief) are stored as
--     proposals with provenance, like AI drafts. They never change a task or goal.
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tasks: expected business impact
-- ---------------------------------------------------------------------------
alter table marketing_os.tasks
  add column impact_outcome      text,
  add column impact_rationale    text,
  add column impact_audience     text,
  add column impact_metrics      text,
  add column impact_evidence     text,
  add column impact_dependencies text,
  add column impact_risks        text,
  add constraint tasks_impact_evidence check
    (impact_evidence is null or impact_evidence in ('hypothesis', 'historical', 'committed'));

create function marketing_os_private.tasks_impact_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_assigning boolean;
begin
  -- blank text is stored as "not given"
  new.impact_outcome      := nullif(btrim(new.impact_outcome), '');
  new.impact_rationale    := nullif(btrim(new.impact_rationale), '');
  new.impact_audience     := nullif(btrim(new.impact_audience), '');
  new.impact_metrics      := nullif(btrim(new.impact_metrics), '');
  new.impact_dependencies := nullif(btrim(new.impact_dependencies), '');
  new.impact_risks        := nullif(btrim(new.impact_risks), '');

  admin_assigning := auth.uid() is not null and marketing_os_private.is_admin()
    and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id);
  if admin_assigning and (new.impact_outcome is null or new.impact_rationale is null or new.impact_audience is null
                          or new.impact_metrics is null or new.impact_evidence is null) then
    raise exception 'Expected business impact is required when an admin creates or assigns a task: outcome, rationale, audience/channel, success metrics and evidence level'
      using errcode = '23514';
  end if;

  -- once given, the impact case can be revised but not emptied
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

create trigger tasks_impact_check before insert or update on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_impact_check();

-- ---------------------------------------------------------------------------
-- Goals: expected business outcome, kept apart from task progress
-- ---------------------------------------------------------------------------
alter table marketing_os.goals
  add column outcome_statement   text,
  add column outcome_rationale   text,
  add column success_measures    text,
  add column importance          text,
  add column outcome_kind        text,
  add column outcome_metric      text,
  add column outcome_baseline    numeric,
  add column outcome_target      numeric,
  add column outcome_unit        text,
  add column outcome_status      text not null default 'not_assessed',
  add column outcome_actual      numeric,
  add column outcome_evidence    text,
  add column outcome_assessed_at timestamptz,
  add column outcome_assessed_by uuid references marketing_os.members (id),
  add constraint goals_importance check (importance is null or importance in ('critical', 'high', 'medium', 'low')),
  add constraint goals_outcome_kind check (outcome_kind is null or outcome_kind in ('measurable', 'qualitative')),
  add constraint goals_outcome_status check (outcome_status in
    ('not_assessed', 'not_started', 'in_progress', 'partially_achieved', 'achieved', 'not_achieved')),
  add constraint goals_measurable_target check
    (outcome_kind is distinct from 'measurable' or (outcome_metric is not null and outcome_target is not null));

create function marketing_os_private.goals_outcome_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.outcome_statement := nullif(btrim(new.outcome_statement), '');
  new.outcome_rationale := nullif(btrim(new.outcome_rationale), '');
  new.success_measures  := nullif(btrim(new.success_measures), '');
  new.outcome_metric    := nullif(btrim(new.outcome_metric), '');
  new.outcome_unit      := nullif(btrim(new.outcome_unit), '');
  new.outcome_evidence  := nullif(btrim(new.outcome_evidence), '');

  if tg_op = 'INSERT' and (new.outcome_statement is null or new.outcome_rationale is null or new.success_measures is null) then
    raise exception 'A goal needs its expected business outcome, business rationale and success measures' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
       (old.outcome_statement is not null and new.outcome_statement is null)
    or (old.outcome_rationale is not null and new.outcome_rationale is null)
    or (old.success_measures is not null and new.success_measures is null)) then
    raise exception 'The business outcome, rationale and success measures can be revised but not removed' using errcode = '23514';
  end if;

  -- who recorded the actual outcome, and when (never inferred from task completion)
  if tg_op = 'INSERT' then
    if new.outcome_status <> 'not_assessed' or new.outcome_actual is not null then
      new.outcome_assessed_at := now();
      new.outcome_assessed_by := marketing_os_private.current_member_id();
    else
      new.outcome_assessed_at := null;
      new.outcome_assessed_by := null;
    end if;
  elsif new.outcome_status is distinct from old.outcome_status
     or new.outcome_actual is distinct from old.outcome_actual
     or new.outcome_evidence is distinct from old.outcome_evidence then
    new.outcome_assessed_at := now();
    new.outcome_assessed_by := marketing_os_private.current_member_id();
  else
    new.outcome_assessed_at := old.outcome_assessed_at;
    new.outcome_assessed_by := old.outcome_assessed_by;
  end if;
  return new;
end;
$$;

create trigger goals_outcome_check before insert or update on marketing_os.goals
  for each row execute function marketing_os_private.goals_outcome_check();

-- ---------------------------------------------------------------------------
-- AI impact assessments (proposals; never applied automatically)
-- ---------------------------------------------------------------------------
create table marketing_os.impact_assessments (
  id                 uuid primary key default gen_random_uuid(),
  ref                bigint generated always as identity unique,
  subject            text not null,
  task_id            uuid references marketing_os.tasks (id) on delete cascade,
  goal_id            uuid references marketing_os.goals (id) on delete cascade,
  period_kind        text,
  period_from        date,
  period_to          date,
  input              jsonb,
  status             text not null default 'queued',
  output             jsonb,
  model              text,
  prompt_tokens      integer,
  completion_tokens  integer,
  error              text,
  created_by         uuid not null references marketing_os.members (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  constraint impact_assessments_subject check (subject in ('task', 'goal', 'brief')),
  constraint impact_assessments_target check (
       (subject = 'task'  and task_id is not null and goal_id is null)
    or (subject = 'goal'  and goal_id is not null and task_id is null)
    or (subject = 'brief' and task_id is null and goal_id is null and period_from is not null and period_to is not null
        and period_to >= period_from and input is not null)),
  constraint impact_assessments_period_kind check (period_kind is null or period_kind in ('daily', 'weekly', 'monthly', 'custom')),
  constraint impact_assessments_status check (status in ('queued', 'running', 'ready', 'failed'))
);

create index impact_assessments_task_idx on marketing_os.impact_assessments (task_id, created_at desc);
create index impact_assessments_goal_idx on marketing_os.impact_assessments (goal_id, created_at desc);
create index impact_assessments_creator_day_idx on marketing_os.impact_assessments (created_by, created_at);

-- requester, daily cap (60 per person per India day), immutable request
create function marketing_os_private.impact_assessments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare used integer;
begin
  if tg_op = 'INSERT' then
    new.created_by := marketing_os_private.require_member();
    new.status := 'queued';
    new.output := null; new.model := null; new.error := null; new.completed_at := null;
    new.prompt_tokens := null; new.completion_tokens := null;
    select count(*) into used from marketing_os.impact_assessments a
     where a.created_by = new.created_by
       and (a.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
    if used >= 60 then
      raise exception 'Daily AI assessment limit reached (60 per person per day). It resets at midnight IST.'
        using errcode = '54000';
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at; new.ref := old.ref;
    new.subject := old.subject; new.task_id := old.task_id; new.goal_id := old.goal_id;
    new.period_kind := old.period_kind; new.period_from := old.period_from; new.period_to := old.period_to;
    new.input := old.input;
    if old.status in ('ready', 'failed') then
      raise exception 'This assessment is finished; request a new one instead';
    end if;
  end if;
  return new;
end;
$$;

create trigger impact_assessments_before_write before insert or update on marketing_os.impact_assessments
  for each row execute function marketing_os_private.impact_assessments_before_write();
create trigger impact_assessments_touch before update on marketing_os.impact_assessments
  for each row execute function marketing_os_private.touch_updated_at();

create function marketing_os_private.impact_assessments_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform marketing_os_private.log_event('impact_assessments', new.id::text, 'impact_assessment_requested', null,
      jsonb_build_object('subject', new.subject, 'task_id', new.task_id, 'goal_id', new.goal_id,
                         'period_from', new.period_from, 'period_to', new.period_to));
  elsif new.status is distinct from old.status and new.status in ('ready', 'failed') then
    perform marketing_os_private.log_event('impact_assessments', new.id::text, 'impact_assessment_' || new.status,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'model', new.model));
  end if;
  return null;
end;
$$;
create trigger impact_assessments_audit after insert or update on marketing_os.impact_assessments
  for each row execute function marketing_os_private.impact_assessments_audit();

alter table marketing_os.impact_assessments enable row level security;
alter table marketing_os.impact_assessments force row level security;

create policy impact_assessments_select on marketing_os.impact_assessments for select to authenticated
  using (marketing_os_private.is_member());
create policy impact_assessments_insert on marketing_os.impact_assessments for insert to authenticated
  with check (marketing_os_private.is_member());
-- only the requester's own server call fills in the result
create policy impact_assessments_update on marketing_os.impact_assessments for update to authenticated
  using (created_by = marketing_os_private.current_member_id())
  with check (created_by = marketing_os_private.current_member_id());

revoke all on marketing_os.impact_assessments from public, anon;
grant select, insert, update on marketing_os.impact_assessments to authenticated;
grant select on marketing_os.impact_assessments to service_role;

revoke all on function marketing_os_private.tasks_impact_check() from public;
revoke all on function marketing_os_private.goals_outcome_check() from public;
revoke all on function marketing_os_private.impact_assessments_before_write() from public;
revoke all on function marketing_os_private.impact_assessments_audit() from public;
