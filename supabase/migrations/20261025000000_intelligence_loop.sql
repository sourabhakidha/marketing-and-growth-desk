-- =============================================================================
-- Akidha Marketing Desk — Calendar, Content Radar, Content Opportunities,
-- AI Intelligence (draft briefs & scripts), Knowledge base, Learning Loop.
-- Touches ONLY marketing_os / marketing_os_private.
--
-- Decisions (docs/DECISIONS.md D-016 – D-022):
--   * Calendar shows task due dates, task publish dates and goal dates; entries
--     are the records themselves (no calendar-only copies). Publish date follows
--     the same admin-only change rule as due date.
--   * Radar collects from news/search feeds, official sources and Reddit, on a
--     member-triggered scan; every signal keeps URL, published and collected time.
--   * Only admins decide on opportunities and turn them into tasks.
--   * AI drafts briefs and scripts only; drafts are proposals, capped at 30 per
--     person per day (Asia/Kolkata), grounded in the knowledge base.
--   * Anyone records learnings; admins accept or reject them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tasks: publish date + link to the opportunity that produced the work
-- ---------------------------------------------------------------------------
alter table marketing_os.tasks add column publish_date date;
create index tasks_publish_idx on marketing_os.tasks (publish_date);

alter table marketing_os.task_events drop constraint task_events_type;
alter table marketing_os.task_events add constraint task_events_type check (event_type in (
  'created', 'status_changed', 'stage_entered', 'picked_up', 'handed_off', 'stage_completed',
  'stage_skipped', 'returned_for_rework', 'blocked', 'unblocked', 'submitted_for_approval',
  'approved', 'changes_requested', 'cancelled', 'reopened', 'comment',
  'owner_changed', 'due_date_changed', 'priority_changed', 'goal_changed', 'publish_date_changed'
));

-- ---------------------------------------------------------------------------
-- Content Radar
-- ---------------------------------------------------------------------------
create table marketing_os.radar_sources (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  name             text not null,
  config           jsonb not null default '{}'::jsonb,
  evidence_class   text not null default 'news_reporting',
  is_active        boolean not null default true,
  last_scan_at     timestamptz,
  last_success_at  timestamptz,
  last_status      text not null default 'never',
  last_error       text,
  last_item_count  integer,
  created_by       uuid references marketing_os.members (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint radar_sources_kind check (kind in ('news_search', 'rss', 'reddit')),
  constraint radar_sources_status check (last_status in ('never', 'ok', 'empty', 'failed', 'not_configured')),
  constraint radar_sources_evidence check (evidence_class in
    ('official', 'study', 'news_reporting', 'opinion', 'anecdote', 'trend', 'unknown')),
  constraint radar_sources_name_not_blank check (length(btrim(name)) > 0)
);

create table marketing_os.radar_scans (
  id           uuid primary key default gen_random_uuid(),
  started_by   uuid not null references marketing_os.members (id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',
  results      jsonb,
  inserted     integer,
  duplicates   integer,
  constraint radar_scans_status check (status in ('running', 'ok', 'partial', 'failed'))
);

create table marketing_os.radar_signals (
  id              uuid primary key default gen_random_uuid(),
  ref             bigint generated always as identity unique,
  source_id       uuid references marketing_os.radar_sources (id) on delete set null,
  scan_id         uuid references marketing_os.radar_scans (id) on delete set null,
  source_type     text not null,
  source_name     text not null,
  url             text not null,
  fingerprint     text not null unique,
  title           text not null,
  excerpt         text,
  publisher       text,
  published_at    timestamptz,
  collected_at    timestamptz not null default now(),
  topic_tags      text[] not null default '{}',
  region          text not null default 'unknown',
  evidence_class  text not null default 'unknown',
  status          text not null default 'new',
  notes           text,
  collected_by    uuid references marketing_os.members (id),
  updated_at      timestamptz not null default now(),
  constraint radar_signals_source_type check (source_type in ('news_search', 'rss', 'reddit', 'manual')),
  constraint radar_signals_status check (status in ('new', 'reviewed', 'saved', 'dismissed', 'converted')),
  constraint radar_signals_evidence check (evidence_class in
    ('official', 'study', 'news_reporting', 'opinion', 'anecdote', 'trend', 'unknown')),
  constraint radar_signals_url check (url ~* '^https?://'),
  constraint radar_signals_title_not_blank check (length(btrim(title)) > 0)
);

create index radar_signals_collected_idx on marketing_os.radar_signals (collected_at desc);
create index radar_signals_status_idx on marketing_os.radar_signals (status);

-- ---------------------------------------------------------------------------
-- Content Opportunities
-- ---------------------------------------------------------------------------
create table marketing_os.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  ref                 bigint generated always as identity unique,
  title               text not null,
  audience            text,
  audience_tension    text,
  strategic_rationale text,
  content_angle       text,
  suggested_format    text,
  objective           text,
  proof_checks        text,
  priority            text,
  scores              jsonb not null default '{}'::jsonb,
  status              text not null default 'considering',
  next_action         text,
  decision_note       text,
  decided_by          uuid references marketing_os.members (id),
  decided_at          timestamptz,
  created_by          uuid not null references marketing_os.members (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint opportunities_title_not_blank check (length(btrim(title)) > 0),
  constraint opportunities_status check (status in
    ('considering', 'needs_research', 'approved', 'deferred', 'rejected', 'converted')),
  constraint opportunities_priority check (priority is null or priority in ('high', 'medium', 'low')),
  constraint opportunities_objective check (objective is null or objective in
    ('awareness', 'understanding', 'objection_resolution', 'qualified_inquiry', 'conversion', 'retention'))
);

create table marketing_os.opportunity_signals (
  opportunity_id  uuid not null references marketing_os.opportunities (id) on delete cascade,
  signal_id       uuid not null references marketing_os.radar_signals (id),
  linked_by       uuid references marketing_os.members (id),
  linked_at       timestamptz not null default now(),
  primary key (opportunity_id, signal_id)
);

alter table marketing_os.tasks add column opportunity_id uuid references marketing_os.opportunities (id) on delete set null;
create index tasks_opportunity_idx on marketing_os.tasks (opportunity_id);

-- ---------------------------------------------------------------------------
-- Knowledge base (brand guidelines, script patterns, references)
-- ---------------------------------------------------------------------------
create table marketing_os.knowledge_documents (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  title        text not null,
  content      text not null,
  language     text,
  tags         text[] not null default '{}',
  source_note  text,
  is_active    boolean not null default true,
  search       tsvector generated always as
                 (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))) stored,
  created_by   uuid references marketing_os.members (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint knowledge_kind check (kind in ('brand_guidelines', 'script_pattern', 'reference')),
  constraint knowledge_title_not_blank check (length(btrim(title)) > 0),
  constraint knowledge_content_not_blank check (length(btrim(content)) > 0)
);

create index knowledge_search_idx on marketing_os.knowledge_documents using gin (search);

-- ---------------------------------------------------------------------------
-- AI drafts (briefs & scripts) — proposals with provenance
-- ---------------------------------------------------------------------------
create table marketing_os.ai_drafts (
  id                 uuid primary key default gen_random_uuid(),
  ref                bigint generated always as identity unique,
  kind               text not null,
  task_id            uuid references marketing_os.tasks (id) on delete set null,
  opportunity_id     uuid references marketing_os.opportunities (id) on delete set null,
  language           text,
  format             text,
  duration           text,
  instructions       text,
  status             text not null default 'queued',
  output             jsonb,
  model              text,
  knowledge_ids      uuid[] not null default '{}',
  signal_ids         uuid[] not null default '{}',
  prompt_tokens      integer,
  completion_tokens  integer,
  error              text,
  decision_note      text,
  decided_at         timestamptz,
  created_by         uuid not null references marketing_os.members (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  constraint ai_drafts_kind check (kind in ('brief', 'script')),
  constraint ai_drafts_status check (status in ('queued', 'running', 'ready', 'failed', 'accepted', 'discarded'))
);

create index ai_drafts_creator_day_idx on marketing_os.ai_drafts (created_by, created_at);

-- ---------------------------------------------------------------------------
-- Learning Loop
-- ---------------------------------------------------------------------------
create table marketing_os.learnings (
  id              uuid primary key default gen_random_uuid(),
  ref             bigint generated always as identity unique,
  title           text not null,
  learning_class  text not null,
  observation     text not null,
  period_start    date,
  period_end      date,
  evidence        text,
  interpretation  text,
  confidence      text not null default 'unknown',
  limitations     text,
  next_test       text,
  owner_id        uuid references marketing_os.members (id),
  review_date     date,
  task_id         uuid references marketing_os.tasks (id) on delete set null,
  goal_id         uuid references marketing_os.goals (id) on delete set null,
  opportunity_id  uuid references marketing_os.opportunities (id) on delete set null,
  status          text not null default 'pending_review',
  decision_note   text,
  decided_by      uuid references marketing_os.members (id),
  decided_at      timestamptz,
  created_by      uuid not null references marketing_os.members (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint learnings_title_not_blank check (length(btrim(title)) > 0),
  constraint learnings_observation_not_blank check (length(btrim(observation)) > 0),
  constraint learnings_class check (learning_class in
    ('marketing_outcome', 'audience', 'production_process', 'management_decision', 'ai_quality')),
  constraint learnings_confidence check (confidence in ('low', 'medium', 'high', 'unknown')),
  constraint learnings_status check (status in ('pending_review', 'accepted', 'rejected', 'superseded')),
  constraint learnings_period check (period_end is null or period_start is null or period_end >= period_start)
);

-- ---------------------------------------------------------------------------
-- Triggers: server-owned fields, decision rules, limits
-- ---------------------------------------------------------------------------
create function marketing_os_private.in_decision_action()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('marketing_os.decision_action', true), '') = 'on'
$$;

create function marketing_os_private.set_decision_action(p_on boolean)
returns void
language sql
set search_path = ''
as $$
  select set_config('marketing_os.decision_action', case when p_on then 'on' else '' end, true)
$$;

-- radar_signals: creator/collected time owned by the server; status 'converted' only via links
create function marketing_os_private.radar_signals_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.collected_by := marketing_os_private.require_member();
      new.collected_at := now();
      if new.status not in ('new', 'saved') then new.status := 'new'; end if;
    end if;
  else
    new.id := old.id; new.ref := old.ref; new.url := old.url; new.fingerprint := old.fingerprint;
    new.source_id := old.source_id; new.scan_id := old.scan_id; new.source_type := old.source_type;
    new.source_name := old.source_name; new.published_at := old.published_at;
    new.collected_at := old.collected_at; new.collected_by := old.collected_by;
    if new.status = 'converted' and old.status <> 'converted' and not marketing_os_private.in_decision_action() then
      raise exception 'A signal becomes Converted when it is linked to an opportunity';
    end if;
  end if;
  return new;
end;
$$;

create trigger radar_signals_before_write before insert or update on marketing_os.radar_signals
  for each row execute function marketing_os_private.radar_signals_before_write();
create trigger radar_signals_touch before update on marketing_os.radar_signals
  for each row execute function marketing_os_private.touch_updated_at();

create trigger radar_sources_touch before update on marketing_os.radar_sources
  for each row execute function marketing_os_private.touch_updated_at();
create trigger radar_sources_audit after insert or update or delete on marketing_os.radar_sources
  for each row execute function marketing_os_private.audit_row_change();

-- opportunities: decisions only through opportunity_decide()
create function marketing_os_private.opportunities_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := marketing_os_private.require_member();
      new.status := 'considering';
      new.decided_by := null; new.decided_at := null; new.decision_note := null;
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at; new.ref := old.ref;
    if (new.status is distinct from old.status or new.decided_by is distinct from old.decided_by
        or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note)
       and auth.uid() is not null and not marketing_os_private.in_decision_action() then
      raise exception 'Use the decision buttons to approve, defer, reject or request research';
    end if;
    if auth.uid() is not null and not marketing_os_private.is_admin()
       and old.status in ('approved', 'rejected', 'converted') and not marketing_os_private.in_decision_action() then
      raise exception 'This opportunity has been decided. Ask Sourabh or Tanvi to change it.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunities_before_write before insert or update on marketing_os.opportunities
  for each row execute function marketing_os_private.opportunities_before_write();
create trigger opportunities_touch before update on marketing_os.opportunities
  for each row execute function marketing_os_private.touch_updated_at();
create trigger opportunities_audit after insert or update or delete on marketing_os.opportunities
  for each row execute function marketing_os_private.audit_row_change();

-- linking a signal marks it converted
create function marketing_os_private.opportunity_signals_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform marketing_os_private.set_decision_action(true);
  update marketing_os.radar_signals set status = 'converted' where id = new.signal_id and status <> 'converted';
  perform marketing_os_private.set_decision_action(false);
  return null;
end;
$$;

create function marketing_os_private.opportunity_signals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then new.linked_by := marketing_os_private.require_member(); end if;
  new.linked_at := now();
  return new;
end;
$$;

create trigger opportunity_signals_before_insert before insert on marketing_os.opportunity_signals
  for each row execute function marketing_os_private.opportunity_signals_before_insert();
create trigger opportunity_signals_after_insert after insert on marketing_os.opportunity_signals
  for each row execute function marketing_os_private.opportunity_signals_after_insert();

-- knowledge
create trigger knowledge_documents_touch before update on marketing_os.knowledge_documents
  for each row execute function marketing_os_private.touch_updated_at();
create trigger knowledge_documents_audit after insert or update or delete on marketing_os.knowledge_documents
  for each row execute function marketing_os_private.audit_row_change();

create function marketing_os_private.knowledge_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then new.created_by := marketing_os_private.require_member(); end if;
  return new;
end;
$$;
create trigger knowledge_before_insert before insert on marketing_os.knowledge_documents
  for each row execute function marketing_os_private.knowledge_before_insert();

-- AI drafts: owner, daily cap (30 per person per India calendar day), immutable provenance
create function marketing_os_private.ai_drafts_before_write()
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
    new.decided_at := null; new.decision_note := null;
    select count(*) into used from marketing_os.ai_drafts d
     where d.created_by = new.created_by
       and (d.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
    if used >= 30 then
      raise exception 'Daily AI limit reached (30 drafts per person per day). It resets at midnight IST.'
        using errcode = '54000';
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at; new.ref := old.ref;
    new.kind := old.kind; new.task_id := old.task_id; new.opportunity_id := old.opportunity_id;
    if old.status in ('accepted', 'discarded') and new.status is distinct from old.status then
      raise exception 'This draft has already been decided';
    end if;
    if new.status in ('accepted', 'discarded') and new.status is distinct from old.status then
      if old.status <> 'ready' then raise exception 'Only a ready draft can be accepted or discarded'; end if;
      new.decided_at := now();
      new.output := old.output; new.model := old.model;
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_drafts_before_write before insert or update on marketing_os.ai_drafts
  for each row execute function marketing_os_private.ai_drafts_before_write();
create trigger ai_drafts_touch before update on marketing_os.ai_drafts
  for each row execute function marketing_os_private.touch_updated_at();

create function marketing_os_private.ai_drafts_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform marketing_os_private.log_event('ai_drafts', new.id::text, 'ai_draft_requested', null,
      jsonb_build_object('kind', new.kind, 'task_id', new.task_id, 'opportunity_id', new.opportunity_id));
  elsif new.status is distinct from old.status and new.status in ('ready', 'failed', 'accepted', 'discarded') then
    perform marketing_os_private.log_event('ai_drafts', new.id::text, 'ai_draft_' || new.status,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'model', new.model, 'note', new.decision_note));
  end if;
  return null;
end;
$$;
create trigger ai_drafts_audit after insert or update on marketing_os.ai_drafts
  for each row execute function marketing_os_private.ai_drafts_audit();

-- learnings
create function marketing_os_private.learnings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := marketing_os_private.require_member();
      new.status := 'pending_review';
      new.decided_by := null; new.decided_at := null; new.decision_note := null;
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at; new.ref := old.ref;
    if (new.status is distinct from old.status or new.decided_by is distinct from old.decided_by
        or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note)
       and auth.uid() is not null and not marketing_os_private.in_decision_action() then
      raise exception 'Use Accept / Reject to review a learning';
    end if;
    if auth.uid() is not null and not marketing_os_private.is_admin() and old.status <> 'pending_review' then
      raise exception 'This learning has been reviewed. Ask Sourabh or Tanvi to change it.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger learnings_before_write before insert or update on marketing_os.learnings
  for each row execute function marketing_os_private.learnings_before_write();
create trigger learnings_touch before update on marketing_os.learnings
  for each row execute function marketing_os_private.touch_updated_at();
create trigger learnings_audit after insert or update or delete on marketing_os.learnings
  for each row execute function marketing_os_private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Tasks: publish date rule + opportunity conversion (replaces Phase 1 bodies)
-- ---------------------------------------------------------------------------
create or replace function marketing_os_private.tasks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := marketing_os_private.current_member_id();
begin
  if auth.uid() is not null then
    if me is null then raise exception 'You do not have access to Marketing Desk' using errcode = '42501'; end if;
    new.created_by := me;
    new.status := 'not_started';
    new.completed_at := null;
    new.blocker_reason := null;
  end if;
  if not exists (select 1 from marketing_os.members m where m.id = new.owner_id and m.is_active) then
    raise exception 'The task owner must be an active member';
  end if;
  if new.opportunity_id is not null then
    if auth.uid() is not null and not marketing_os_private.is_admin() then
      raise exception 'Only admins (Sourabh, Tanvi) can turn an opportunity into work' using errcode = '42501';
    end if;
    if not exists (select 1 from marketing_os.opportunities o
                   where o.id = new.opportunity_id and o.status in ('approved', 'converted')) then
      raise exception 'Only an approved opportunity can be turned into a task';
    end if;
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

create or replace function marketing_os_private.tasks_before_update()
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
       or new.publish_date is distinct from old.publish_date
       or new.priority is distinct from old.priority then
      raise exception 'Only admins (Sourabh, Tanvi) can reassign a task or change its due date, publish date or priority'
        using errcode = '42501';
    end if;
    if new.workflow_template_id is distinct from old.workflow_template_id then
      raise exception 'Only admins can change a task''s workflow template' using errcode = '42501';
    end if;
    if new.opportunity_id is distinct from old.opportunity_id then
      raise exception 'Only admins can change the opportunity a task came from' using errcode = '42501';
    end if;
  end if;

  perform marketing_os_private.assert_vocab('task_type', new.task_type, 'Task type');
  perform marketing_os_private.assert_vocab('work_origin', new.work_origin, 'Work origin');
  perform marketing_os_private.assert_vocab('priority', new.priority, 'Priority');
  perform marketing_os_private.assert_vocab('task_status', new.status, 'Task status');
  return new;
end;
$$;

create or replace function marketing_os_private.tasks_after_update()
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
  if new.publish_date is distinct from old.publish_date then
    perform marketing_os_private.task_event(new.id, 'publish_date_changed', null, null, null, old.publish_date::text, new.publish_date::text);
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

-- converting an opportunity: first task created from it marks it converted
create function marketing_os_private.tasks_mark_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opportunity_id is not null then
    perform marketing_os_private.set_decision_action(true);
    update marketing_os.opportunities
       set status = 'converted', decided_by = coalesce(decided_by, marketing_os_private.current_member_id()),
           decided_at = coalesce(decided_at, now())
     where id = new.opportunity_id and status = 'approved';
    perform marketing_os_private.set_decision_action(false);
  end if;
  return null;
end;
$$;
create trigger tasks_mark_opportunity after insert on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_mark_opportunity();

-- ---------------------------------------------------------------------------
-- Actions (RPC)
-- ---------------------------------------------------------------------------
create function marketing_os.opportunity_decide(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o marketing_os.opportunities;
begin
  perform marketing_os_private.require_member();
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can decide on opportunities' using errcode = '42501';
  end if;
  if p_decision not in ('considering', 'needs_research', 'approved', 'deferred', 'rejected') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select * into o from marketing_os.opportunities where id = p_id for update;
  if not found then raise exception 'Opportunity not found'; end if;
  if o.status = 'converted' then raise exception 'This opportunity is already in production'; end if;
  if p_decision in ('rejected', 'deferred', 'needs_research') and coalesce(btrim(p_note), '') = '' then
    raise exception 'Give a short reason';
  end if;
  perform marketing_os_private.set_decision_action(true);
  update marketing_os.opportunities
     set status = p_decision, decision_note = nullif(btrim(p_note), ''),
         decided_by = marketing_os_private.current_member_id(), decided_at = now()
   where id = p_id;
  perform marketing_os_private.set_decision_action(false);
end;
$$;

create function marketing_os.learning_decide(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform marketing_os_private.require_member();
  if not marketing_os_private.is_admin() then
    raise exception 'Only admins (Sourabh, Tanvi) can accept or reject learnings' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected', 'superseded', 'pending_review') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  if p_decision in ('rejected', 'superseded') and coalesce(btrim(p_note), '') = '' then
    raise exception 'Give a short reason';
  end if;
  perform marketing_os_private.set_decision_action(true);
  update marketing_os.learnings
     set status = p_decision, decision_note = nullif(btrim(p_note), ''),
         decided_by = marketing_os_private.current_member_id(), decided_at = now()
   where id = p_id;
  if not found then raise exception 'Learning not found'; end if;
  perform marketing_os_private.set_decision_action(false);
end;
$$;

create function marketing_os.radar_start_scan()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := marketing_os_private.require_member(); v uuid;
begin
  if exists (select 1 from marketing_os.radar_scans s
             where s.status = 'running' and s.started_at > now() - interval '5 minutes') then
    raise exception 'A scan is already running. Try again in a few minutes.';
  end if;
  insert into marketing_os.radar_scans (started_by) values (me) returning id into v;
  return v;
end;
$$;

-- p_results: [{"source_id": uuid, "status": "ok|empty|failed|not_configured", "error": text, "fetched": int, "inserted": int}]
create function marketing_os.radar_finish_scan(p_scan uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  r jsonb;
  ins integer := 0; dup integer := 0; ok_count integer := 0; fail_count integer := 0;
begin
  if not exists (select 1 from marketing_os.radar_scans s where s.id = p_scan and s.started_by = me and s.status = 'running') then
    raise exception 'Scan not found or already finished';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update marketing_os.radar_sources
       set last_scan_at = now(),
           last_status = coalesce(r ->> 'status', 'failed'),
           last_error = left(r ->> 'error', 500),
           last_item_count = nullif(r ->> 'fetched', '')::integer,
           last_success_at = case when r ->> 'status' in ('ok', 'empty') then now() else last_success_at end
     where id = (r ->> 'source_id')::uuid;
    ins := ins + coalesce((r ->> 'inserted')::integer, 0);
    dup := dup + greatest(coalesce((r ->> 'fetched')::integer, 0) - coalesce((r ->> 'inserted')::integer, 0), 0);
    if r ->> 'status' in ('ok', 'empty') then ok_count := ok_count + 1;
    elsif r ->> 'status' = 'failed' then fail_count := fail_count + 1; end if;
  end loop;
  update marketing_os.radar_scans
     set finished_at = now(), results = p_results, inserted = ins, duplicates = dup,
         status = case when fail_count = 0 then 'ok' when ok_count = 0 then 'failed' else 'partial' end
   where id = p_scan;
end;
$$;

create function marketing_os.knowledge_search(p_query text, p_kind text default 'script_pattern', p_limit integer default 4)
returns table (id uuid, title text, content text, language text, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  select k.id, k.title, k.content, k.language,
         ts_rank(k.search, websearch_to_tsquery('simple', coalesce(p_query, ''))) as rank
  from marketing_os.knowledge_documents k
  where k.is_active and k.kind = p_kind
  order by rank desc, k.created_at
  limit least(greatest(coalesce(p_limit, 4), 1), 10)
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
grant execute on function marketing_os.opportunity_decide(uuid, text, text) to authenticated;
grant execute on function marketing_os.learning_decide(uuid, text, text) to authenticated;
grant execute on function marketing_os.radar_start_scan() to authenticated;
grant execute on function marketing_os.radar_finish_scan(uuid, jsonb) to authenticated;
grant execute on function marketing_os.knowledge_search(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table marketing_os.radar_sources        enable row level security;
alter table marketing_os.radar_sources        force row level security;
alter table marketing_os.radar_scans          enable row level security;
alter table marketing_os.radar_scans          force row level security;
alter table marketing_os.radar_signals        enable row level security;
alter table marketing_os.radar_signals        force row level security;
alter table marketing_os.opportunities        enable row level security;
alter table marketing_os.opportunities        force row level security;
alter table marketing_os.opportunity_signals  enable row level security;
alter table marketing_os.opportunity_signals  force row level security;
alter table marketing_os.knowledge_documents  enable row level security;
alter table marketing_os.knowledge_documents  force row level security;
alter table marketing_os.ai_drafts            enable row level security;
alter table marketing_os.ai_drafts            force row level security;
alter table marketing_os.learnings            enable row level security;
alter table marketing_os.learnings            force row level security;

create policy radar_sources_select on marketing_os.radar_sources for select to authenticated
  using (marketing_os_private.is_member());
create policy radar_sources_insert on marketing_os.radar_sources for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy radar_sources_update on marketing_os.radar_sources for update to authenticated
  using (marketing_os_private.is_admin()) with check (marketing_os_private.is_admin());

create policy radar_scans_select on marketing_os.radar_scans for select to authenticated
  using (marketing_os_private.is_member());

create policy radar_signals_select on marketing_os.radar_signals for select to authenticated
  using (marketing_os_private.is_member());
create policy radar_signals_insert on marketing_os.radar_signals for insert to authenticated
  with check (marketing_os_private.is_member());
create policy radar_signals_update on marketing_os.radar_signals for update to authenticated
  using (marketing_os_private.is_member()) with check (marketing_os_private.is_member());

create policy opportunities_select on marketing_os.opportunities for select to authenticated
  using (marketing_os_private.is_member());
create policy opportunities_insert on marketing_os.opportunities for insert to authenticated
  with check (marketing_os_private.is_member());
create policy opportunities_update on marketing_os.opportunities for update to authenticated
  using (marketing_os_private.is_admin() or created_by = marketing_os_private.current_member_id())
  with check (marketing_os_private.is_member());

create policy opportunity_signals_select on marketing_os.opportunity_signals for select to authenticated
  using (marketing_os_private.is_member());
create policy opportunity_signals_insert on marketing_os.opportunity_signals for insert to authenticated
  with check (marketing_os_private.is_member());

create policy knowledge_select on marketing_os.knowledge_documents for select to authenticated
  using (marketing_os_private.is_member());
create policy knowledge_insert on marketing_os.knowledge_documents for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy knowledge_update on marketing_os.knowledge_documents for update to authenticated
  using (marketing_os_private.is_admin()) with check (marketing_os_private.is_admin());

create policy ai_drafts_select on marketing_os.ai_drafts for select to authenticated
  using (marketing_os_private.is_member());
create policy ai_drafts_insert on marketing_os.ai_drafts for insert to authenticated
  with check (marketing_os_private.is_member());
create policy ai_drafts_update on marketing_os.ai_drafts for update to authenticated
  using (created_by = marketing_os_private.current_member_id())
  with check (created_by = marketing_os_private.current_member_id());

create policy learnings_select on marketing_os.learnings for select to authenticated
  using (marketing_os_private.is_member());
create policy learnings_insert on marketing_os.learnings for insert to authenticated
  with check (marketing_os_private.is_member());
create policy learnings_update on marketing_os.learnings for update to authenticated
  using (marketing_os_private.is_admin() or created_by = marketing_os_private.current_member_id())
  with check (marketing_os_private.is_member());

-- ---------------------------------------------------------------------------
-- Privileges (explicit; nothing for anon)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema marketing_os from public, anon;
grant select, insert, update on marketing_os.radar_sources       to authenticated;
grant select                 on marketing_os.radar_scans         to authenticated;
grant select, insert, update on marketing_os.radar_signals       to authenticated;
grant select, insert, update on marketing_os.opportunities       to authenticated;
grant select, insert         on marketing_os.opportunity_signals to authenticated;
grant select, insert, update on marketing_os.knowledge_documents to authenticated;
grant select, insert, update on marketing_os.ai_drafts           to authenticated;
grant select, insert, update on marketing_os.learnings           to authenticated;

grant select on marketing_os.radar_sources, marketing_os.radar_scans, marketing_os.radar_signals,
  marketing_os.opportunities, marketing_os.opportunity_signals, marketing_os.knowledge_documents,
  marketing_os.ai_drafts, marketing_os.learnings to service_role;

-- ---------------------------------------------------------------------------
-- Seed Radar sources (admins can edit or switch off any of these)
-- Google News RSS, India edition; "official" queries are restricted to
-- government domains. Reddit sources need REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.
-- ---------------------------------------------------------------------------
insert into marketing_os.radar_sources (kind, name, config, evidence_class) values
  ('news_search', 'News: generic & substitute medicines India',
     '{"query": "generic medicines India OR substitute medicines India", "region": "IN"}', 'news_reporting'),
  ('news_search', 'News: medicine prices & affordability',
     '{"query": "medicine prices India patients OR drug price cap India", "region": "IN"}', 'news_reporting'),
  ('news_search', 'News: Jan Aushadhi',
     '{"query": "Jan Aushadhi", "region": "IN"}', 'news_reporting'),
  ('news_search', 'News: chronic care (diabetes, BP, heart)',
     '{"query": "diabetes OR hypertension OR cholesterol patients India medicines", "region": "IN"}', 'news_reporting'),
  ('news_search', 'News: online pharmacy regulation',
     '{"query": "online pharmacy India OR e-pharmacy rules India", "region": "IN"}', 'news_reporting'),
  ('news_search', 'Official: NPPA / CDSCO / Health Ministry',
     '{"query": "NPPA OR CDSCO OR \"not of standard quality\" OR \"health ministry\" medicines site:gov.in OR site:nic.in", "region": "IN"}', 'official'),
  ('news_search', 'Official: PIB health & pharmaceuticals',
     '{"query": "site:pib.gov.in medicines OR pharmaceuticals OR health", "region": "IN"}', 'official'),
  ('reddit', 'Reddit: r/india — medicines',
     '{"subreddit": "india", "query": "generic medicine OR medicine price OR pharmacy"}', 'anecdote'),
  ('reddit', 'Reddit: r/AskIndia — medicines',
     '{"subreddit": "AskIndia", "query": "medicine OR generic OR pharmacy"}', 'anecdote');
