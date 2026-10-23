-- =============================================================================
-- Akidha Marketing OS — Phase 0 foundation
-- -----------------------------------------------------------------------------
-- Scope: creates ONLY the `marketing_os` and `marketing_os_private` schemas and
-- objects inside them. It does not alter any other schema, role, bucket or
-- project-wide setting in the shared Supabase project.
--
-- Isolation model (see docs/ARCHITECTURE.md §Isolation):
--   * deny by default: nothing is granted to PUBLIC or `anon`
--   * `authenticated` gets explicit grants, and every table has RLS enabled
--     and forced; every policy requires an active row in marketing_os.members
--   * a shared-auth login alone grants nothing in this schema
--   * helper functions live in `marketing_os_private`, which must NOT be added
--     to the Data API's exposed schemas
--
-- `create schema` (without IF NOT EXISTS) is deliberate: the migration fails
-- loudly instead of silently mixing with a pre-existing schema of that name.
-- =============================================================================

create schema marketing_os;
create schema marketing_os_private;

comment on schema marketing_os is
  'Akidha Marketing OS (internal marketing & growth platform). Owned by the marketing-and-growth-desk repo; do not modify from other apps.';
comment on schema marketing_os_private is
  'Private helpers for marketing_os. Never expose via the Data API.';

-- ---------------------------------------------------------------------------
-- Schema-level privileges: deny by default
-- ---------------------------------------------------------------------------
revoke all on schema marketing_os from public;
revoke all on schema marketing_os_private from public;

grant usage on schema marketing_os to authenticated, service_role;
-- RLS policies run as the caller, so `authenticated` needs USAGE here to call
-- the helper functions below. EXECUTE is granted per function, nothing else.
grant usage on schema marketing_os_private to authenticated, service_role;

-- Functions are executable by PUBLIC by default in Postgres; remove that for
-- every function created in these schemas from now on.
alter default privileges in schema marketing_os revoke execute on functions from public;
alter default privileges in schema marketing_os_private revoke execute on functions from public;
alter default privileges in schema marketing_os revoke all on tables from public;
alter default privileges in schema marketing_os revoke all on sequences from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type marketing_os.app_role as enum ('admin', 'contributor');

create type marketing_os.audit_source as enum ('user', 'system', 'automation', 'ai_approved');

-- ---------------------------------------------------------------------------
-- Members: the ONLY thing that grants access to this app
-- ---------------------------------------------------------------------------
create table marketing_os.members (
  id            uuid primary key default gen_random_uuid(),
  -- `on delete set null` so that another app deleting a shared auth user is
  -- never blocked by this schema; the member row stays for audit history.
  user_id       uuid unique references auth.users (id) on delete set null,
  -- People sign in with username + password (decision D-008). Supabase Auth
  -- still needs an email internally, so `email` holds a non-deliverable
  -- address derived from the username (<username>@marketing-os.invalid).
  username      text not null,
  email         text not null,
  display_name  text not null,
  role          marketing_os.app_role not null default 'contributor',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint members_username_format check (username ~ '^[a-z][a-z0-9_.-]{1,29}$'),
  constraint members_email_lower check (email = lower(email)),
  constraint members_display_name_not_blank check (length(btrim(display_name)) > 0)
);

create unique index members_email_key on marketing_os.members (email);
create unique index members_username_key on marketing_os.members (username);

comment on table marketing_os.members is
  'Marketing OS membership. A Supabase Auth account without an active row here has no access.';

-- ---------------------------------------------------------------------------
-- Controlled vocabularies (configurable by admins; never hard-coded in views)
-- ---------------------------------------------------------------------------
create table marketing_os.vocab_terms (
  id           uuid primary key default gen_random_uuid(),
  vocabulary   text not null,
  code         text not null,
  label        text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint vocab_terms_vocabulary_check check (vocabulary in (
    'task_type', 'work_origin', 'task_status', 'goal_status',
    'priority', 'workflow_stage', 'performance_area'
  )),
  constraint vocab_terms_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint vocab_terms_unique unique (vocabulary, code)
);

comment on table marketing_os.vocab_terms is
  'Controlled vocabularies (task type, work origin, status, stage, …). Deactivate rather than delete.';

-- ---------------------------------------------------------------------------
-- Audit log: append-only
-- ---------------------------------------------------------------------------
create table marketing_os.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid,
  source         marketing_os.audit_source not null default 'user',
  entity_type    text not null,
  entity_id      text not null,
  event_type     text not null,
  old_value      jsonb,
  new_value      jsonb,
  details        jsonb
);

create index audit_events_entity_idx on marketing_os.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_occurred_idx on marketing_os.audit_events (occurred_at desc);

comment on table marketing_os.audit_events is
  'Append-only audit trail. Written only by security-definer functions/triggers.';

-- ---------------------------------------------------------------------------
-- Private helpers (security definer, empty search_path)
-- ---------------------------------------------------------------------------
create function marketing_os_private.current_member_role()
returns marketing_os.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from marketing_os.members m
  where m.user_id = auth.uid()
    and m.is_active
$$;

create function marketing_os_private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select marketing_os_private.current_member_role() is not null
$$;

create function marketing_os_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(marketing_os_private.current_member_role() = 'admin', false)
$$;

create function marketing_os_private.log_event(
  p_entity_type text,
  p_entity_id   text,
  p_event_type  text,
  p_old_value   jsonb default null,
  p_new_value   jsonb default null,
  p_details     jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into marketing_os.audit_events
    (actor_user_id, source, entity_type, entity_id, event_type, old_value, new_value, details)
  values
    (auth.uid(),
     case when auth.uid() is null then 'system'::marketing_os.audit_source
          else 'user'::marketing_os.audit_source end,
     p_entity_type, p_entity_id, p_event_type, p_old_value, p_new_value, p_details);
end;
$$;

-- Generic row-change audit trigger
create function marketing_os_private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform marketing_os_private.log_event(tg_table_name, new.id::text, 'created', null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
      perform marketing_os_private.log_event(tg_table_name, new.id::text, 'updated', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform marketing_os_private.log_event(tg_table_name, old.id::text, 'deleted', to_jsonb(old), null);
    return old;
  end if;
  return null;
end;
$$;

create function marketing_os_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Never allow the last active admin to be removed or demoted
create function marketing_os_private.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.is_active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.is_active
         and (new.role <> 'admin' or not new.is_active)) then
    if not exists (
      select 1 from marketing_os.members m
      where m.role = 'admin' and m.is_active and m.id <> old.id
    ) then
      raise exception 'Marketing OS must keep at least one active admin';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Audit log is append-only, even for the table owner
create function marketing_os_private.block_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'marketing_os.audit_events is append-only';
end;
$$;

-- Function privileges: only what RLS evaluation needs
revoke all on all functions in schema marketing_os_private from public;
grant execute on function marketing_os_private.current_member_role() to authenticated, service_role;
grant execute on function marketing_os_private.is_member() to authenticated, service_role;
grant execute on function marketing_os_private.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger members_touch before update on marketing_os.members
  for each row execute function marketing_os_private.touch_updated_at();
create trigger members_keep_admin before update or delete on marketing_os.members
  for each row execute function marketing_os_private.keep_one_admin();
create trigger members_audit after insert or update or delete on marketing_os.members
  for each row execute function marketing_os_private.audit_row_change();

create trigger vocab_terms_touch before update on marketing_os.vocab_terms
  for each row execute function marketing_os_private.touch_updated_at();
create trigger vocab_terms_audit after insert or update or delete on marketing_os.vocab_terms
  for each row execute function marketing_os_private.audit_row_change();

create trigger audit_events_append_only before update or delete on marketing_os.audit_events
  for each row execute function marketing_os_private.block_audit_mutation();
create trigger audit_events_no_truncate before truncate on marketing_os.audit_events
  for each statement execute function marketing_os_private.block_audit_mutation();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table marketing_os.members      enable row level security;
alter table marketing_os.members      force row level security;
alter table marketing_os.vocab_terms  enable row level security;
alter table marketing_os.vocab_terms  force row level security;
alter table marketing_os.audit_events enable row level security;
alter table marketing_os.audit_events force row level security;

-- members: any active member can see the team; only admins change it.
-- A signed-in non-member can see only their own (inactive) row, if any, so
-- the UI can explain "access disabled" instead of "unknown user".
create policy members_select on marketing_os.members
  for select to authenticated
  using (marketing_os_private.is_member() or user_id = auth.uid());
create policy members_insert on marketing_os.members
  for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy members_update on marketing_os.members
  for update to authenticated
  using (marketing_os_private.is_admin())
  with check (marketing_os_private.is_admin());
-- no delete policy: deactivate members instead (keeps audit history intact)

create policy vocab_terms_select on marketing_os.vocab_terms
  for select to authenticated
  using (marketing_os_private.is_member());
create policy vocab_terms_insert on marketing_os.vocab_terms
  for insert to authenticated
  with check (marketing_os_private.is_admin());
create policy vocab_terms_update on marketing_os.vocab_terms
  for update to authenticated
  using (marketing_os_private.is_admin())
  with check (marketing_os_private.is_admin());

create policy audit_events_select on marketing_os.audit_events
  for select to authenticated
  using (marketing_os_private.is_member());
-- no insert/update/delete policies: writes happen only via log_event()

-- ---------------------------------------------------------------------------
-- Table privileges (explicit; nothing for anon)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema marketing_os from public, anon;
grant select, insert, update on marketing_os.members     to authenticated;
grant select, insert, update on marketing_os.vocab_terms to authenticated;
grant select                 on marketing_os.audit_events to authenticated;

-- service_role is used only by the local admin script (scripts/create-member.mjs)
grant select, insert, update on marketing_os.members     to service_role;
grant select, insert, update on marketing_os.vocab_terms to service_role;
grant select                 on marketing_os.audit_events to service_role;

-- ---------------------------------------------------------------------------
-- Seed vocabularies
-- Source: Team Roles, Work Types, Goals & Workflow Playbook (§4, §5, §6, §8),
-- adopted where it conflicts with Project Bible v1.0 — see docs/DECISIONS.md D-004.
-- Priority and performance areas from Project Bible §2.3 / §7.2.
-- ---------------------------------------------------------------------------
insert into marketing_os.vocab_terms (vocabulary, code, label, sort_order) values
  ('task_type', 'content_strategy',     'Content Strategy',      10),
  ('task_type', 'content_development',  'Content Development',   20),
  ('task_type', 'ai_image_generation',  'AI Image Generation',   30),
  ('task_type', 'ai_video_generation',  'AI Video Generation',   40),
  ('task_type', 'graphic_designing',    'Graphic Designing',     50),
  ('task_type', 'editing',              'Editing',               60),
  ('task_type', 'reporting_analysis',   'Reporting & Analysis',  70),
  ('task_type', 'ad_hoc',               'Ad Hoc',                80),

  ('work_origin', 'planned',       'Planned',                     10),
  ('work_origin', 'bau',           'BAU / Recurring',             20),
  ('work_origin', 'ad_hoc',        'Ad Hoc',                      30),
  ('work_origin', 'trend_news',    'Trend / News / Industry Moment', 40),
  ('work_origin', 'ai_suggested',  'AI Suggested (approved)',     50),

  ('task_status', 'not_started',       'Not Started',       10),
  ('task_status', 'in_progress',       'In Progress',       20),
  ('task_status', 'in_review',         'In Review',         30),
  ('task_status', 'changes_requested', 'Changes Requested', 40),
  ('task_status', 'blocked',           'Blocked',           50),
  ('task_status', 'done',              'Done',              60),
  ('task_status', 'cancelled',         'Cancelled',         70),

  ('goal_status', 'not_started',  'Not Started',   10),
  ('goal_status', 'on_track',     'On Track',      20),
  ('goal_status', 'at_risk',      'At Risk',       30),
  ('goal_status', 'achieved',     'Achieved',      40),
  ('goal_status', 'not_achieved', 'Not Achieved',  50),
  ('goal_status', 'cancelled',    'Cancelled',     60),

  ('priority', 'high',   'High',   10),
  ('priority', 'medium', 'Medium', 20),
  ('priority', 'low',    'Low',    30),

  ('workflow_stage', 'brief_intake',        'Brief / Intake',                     10),
  ('workflow_stage', 'ideation_research',   'Ideation / Research',                20),
  ('workflow_stage', 'writing_scripting',   'Writing / Scripting',                30),
  ('workflow_stage', 'internal_review',     'Internal Review',                    40),
  ('workflow_stage', 'revisions',           'Revisions',                          50),
  ('workflow_stage', 'production_planning', 'Production Planning',                60),
  ('workflow_stage', 'asset_creation',      'Asset Generation / Design / Shoot',  70),
  ('workflow_stage', 'editing_assembly',    'Editing / Assembly',                 80),
  ('workflow_stage', 'final_review',        'Final Review',                       90),
  ('workflow_stage', 'approval',            'Approval',                          100),
  ('workflow_stage', 'scheduling_handoff',  'Scheduling / Publishing / Handoff', 110),
  ('workflow_stage', 'completed',           'Completed',                         120),

  ('performance_area', 'performance_marketing', 'Performance Marketing', 10),
  ('performance_area', 'social_media',          'Social Media',          20),
  ('performance_area', 'btl',                   'BTL (Below-the-Line)',  30),
  ('performance_area', 'other',                 'Other',                 40);
