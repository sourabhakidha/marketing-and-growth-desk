-- =============================================================================
-- Akidha Marketing Desk — Daily Ops (D-046)
--   * Each member plans a workday: working hours (from / to), and blocks of
--     work scheduled inside those hours (a task, or another activity).
--   * Check-in / check-out for the day and punch-in / punch-out on a task are
--     stamped by the server (now()); nobody can type or edit a time.
--   * Admins can suggest or change the plan of the people they may see; such
--     blocks are marked as suggested until the member accepts them.
--   * Privacy: a member sees only their own day. An admin also sees every
--     contributor. Further admin-to-admin access is granted row by row in
--     ops_viewers (seeded: Sourabh may see Tanvi; Tanvi may not see Sourabh).
--     The tables are read-only to the app; every write goes through the
--     functions below, which apply the same rule.
--   * Nothing here is deleted: a removed plan block is marked removed.
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

-- ---------------------------------------------------------------- tables
create table marketing_os.ops_viewers (
  viewer_id  uuid not null references marketing_os.members (id),
  subject_id uuid not null references marketing_os.members (id),
  created_at timestamptz not null default now(),
  primary key (viewer_id, subject_id),
  constraint ops_viewers_not_self check (viewer_id <> subject_id)
);

create table marketing_os.work_days (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references marketing_os.members (id),
  day             date not null,
  planned_start   time,
  planned_end     time,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  plan_changed_by uuid references marketing_os.members (id),
  plan_changed_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint work_days_one_per_day unique (member_id, day),
  constraint work_days_hours check (planned_start is null or planned_end is null or planned_end > planned_start),
  constraint work_days_checkout check (checked_out_at is null or (checked_in_at is not null and checked_out_at >= checked_in_at))
);

create table marketing_os.plan_items (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references marketing_os.members (id),
  day         date not null,
  task_id     uuid references marketing_os.tasks (id),
  title       text,
  starts_at   time not null,
  ends_at     time not null,
  suggested   boolean not null default false,   -- set by someone else (an admin); the member accepts it
  accepted_at timestamptz,
  created_by  uuid not null references marketing_os.members (id),
  updated_by  uuid references marketing_os.members (id),
  removed_at  timestamptz,
  removed_by  uuid references marketing_os.members (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint plan_items_span check (ends_at > starts_at),
  constraint plan_items_what check (task_id is not null or length(btrim(coalesce(title, ''))) > 0)
);
create index plan_items_member_day on marketing_os.plan_items (member_id, day);

create table marketing_os.task_sessions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references marketing_os.members (id),
  task_id      uuid not null references marketing_os.tasks (id),
  plan_item_id uuid references marketing_os.plan_items (id),
  day          date not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  ended_by     text,
  note         text,
  constraint task_sessions_end check (ended_at is null or ended_at >= started_at),
  constraint task_sessions_ended_by check (ended_by is null or ended_by in ('punch_out', 'switch', 'check_out', 'auto'))
);
create unique index task_sessions_one_open on marketing_os.task_sessions (member_id) where ended_at is null;
create index task_sessions_member_day on marketing_os.task_sessions (member_id, day);

-- ---------------------------------------------------------------- helpers
create function marketing_os_private.ist_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

/** May the caller see (and plan) this member's Daily Ops? Themselves; an admin for any contributor; or a granted viewer. */
create function marketing_os_private.can_view_ops(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select marketing_os_private.current_member_id() is not null and (
    p_member = marketing_os_private.current_member_id()
    or (marketing_os_private.is_admin() and (
         exists (select 1 from marketing_os.members m where m.id = p_member and m.role = 'contributor')
      or exists (select 1 from marketing_os.ops_viewers v
                 where v.viewer_id = marketing_os_private.current_member_id() and v.subject_id = p_member))))
$$;

/** Ends a member's session left open on an earlier day: at that day's check-out, else at its midnight. */
create function marketing_os_private.close_stale_sessions(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update marketing_os.task_sessions s
     set ended_at = greatest(s.started_at, least(
           coalesce((select w.checked_out_at from marketing_os.work_days w where w.member_id = s.member_id and w.day = s.day), 'infinity'::timestamptz),
           ((s.day + 1)::timestamp at time zone 'Asia/Kolkata'))),
         ended_by = 'auto'
   where s.member_id = p_member and s.ended_at is null and s.day < marketing_os_private.ist_today();
end;
$$;

create function marketing_os_private.ensure_work_day(p_member uuid, p_day date)
returns marketing_os.work_days
language plpgsql
security definer
set search_path = ''
as $$
declare w marketing_os.work_days;
begin
  insert into marketing_os.work_days (member_id, day) values (p_member, p_day)
  on conflict (member_id, day) do nothing;
  select * into w from marketing_os.work_days x where x.member_id = p_member and x.day = p_day;
  return w;
end;
$$;

-- ---------------------------------------------------------------- the day: hours, check-in, check-out
create function marketing_os.ops_set_hours(p_member uuid, p_day date, p_start time, p_end time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  w marketing_os.work_days;
begin
  if not marketing_os_private.can_view_ops(p_member) then
    raise exception 'You cannot plan this person''s day' using errcode = '42501';
  end if;
  if p_day < marketing_os_private.ist_today() then raise exception 'Past days cannot be re-planned'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'Working hours need a start before the end'; end if;
  if exists (select 1 from marketing_os.plan_items i where i.member_id = p_member and i.day = p_day and i.removed_at is null
             and (i.starts_at < p_start or i.ends_at > p_end)) then
    raise exception 'Some planned blocks fall outside these hours. Move or remove them first.';
  end if;
  w := marketing_os_private.ensure_work_day(p_member, p_day);
  update marketing_os.work_days
     set planned_start = p_start, planned_end = p_end, plan_changed_by = me, plan_changed_at = now(), updated_at = now()
   where id = w.id;
end;
$$;

create function marketing_os.ops_check_in()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  w marketing_os.work_days;
begin
  perform marketing_os_private.close_stale_sessions(me);
  w := marketing_os_private.ensure_work_day(me, marketing_os_private.ist_today());
  if w.checked_in_at is not null and w.checked_out_at is null then
    raise exception 'You are already checked in';
  end if;
  -- checking in again after checking out re-opens the day (the first check-in time is kept)
  update marketing_os.work_days
     set checked_in_at = coalesce(checked_in_at, now()), checked_out_at = null, updated_at = now()
   where id = w.id;
  return now();
end;
$$;

create function marketing_os.ops_check_out()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  w marketing_os.work_days;
begin
  select * into w from marketing_os.work_days x where x.member_id = me and x.day = marketing_os_private.ist_today();
  if not found or w.checked_in_at is null then raise exception 'You have not checked in today'; end if;
  if w.checked_out_at is not null then raise exception 'You have already checked out'; end if;
  update marketing_os.task_sessions set ended_at = now(), ended_by = 'check_out'
   where member_id = me and ended_at is null;
  update marketing_os.work_days set checked_out_at = now(), updated_at = now() where id = w.id;
  return now();
end;
$$;

-- ---------------------------------------------------------------- punch in / out on a task
create function marketing_os.ops_punch_in(p_task uuid, p_plan_item uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  t marketing_os.tasks;
  w marketing_os.work_days;
  sid uuid;
begin
  select * into t from marketing_os.tasks x where x.id = p_task;
  if not found or t.removed_at is not null then raise exception 'Task not found'; end if;
  if t.kind = 'deliverable' and exists (select 1 from marketing_os.tasks p where p.parent_id = t.id and p.removed_at is null) then
    raise exception 'Punch in on one of this deliverable''s tasks instead';
  end if;
  if t.status in ('done', 'cancelled', 'requested') then
    raise exception 'This task is % — it cannot be worked on now', replace(t.status, '_', ' ');
  end if;
  if p_plan_item is not null and not exists (select 1 from marketing_os.plan_items i where i.id = p_plan_item and i.member_id = me and i.removed_at is null) then
    raise exception 'That planned block is not yours';
  end if;
  perform marketing_os_private.close_stale_sessions(me);
  -- punching in checks you in for the day if needed
  w := marketing_os_private.ensure_work_day(me, marketing_os_private.ist_today());
  if w.checked_in_at is null or w.checked_out_at is not null then
    update marketing_os.work_days set checked_in_at = coalesce(checked_in_at, now()), checked_out_at = null, updated_at = now() where id = w.id;
  end if;
  update marketing_os.task_sessions set ended_at = now(), ended_by = 'switch'
   where member_id = me and ended_at is null;
  insert into marketing_os.task_sessions (member_id, task_id, plan_item_id, day)
  values (me, p_task, p_plan_item, marketing_os_private.ist_today())
  returning id into sid;
  return sid;
end;
$$;

create function marketing_os.ops_punch_out(p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := marketing_os_private.require_member();
begin
  update marketing_os.task_sessions
     set ended_at = now(), ended_by = 'punch_out', note = nullif(btrim(coalesce(p_note, '')), '')
   where member_id = me and ended_at is null;
  if not found then raise exception 'You are not punched in on a task'; end if;
end;
$$;

-- ---------------------------------------------------------------- the plan
create function marketing_os.ops_plan_save(
  p_id uuid, p_member uuid, p_day date, p_task uuid, p_title text, p_start time, p_end time)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  w marketing_os.work_days;
  item marketing_os.plan_items;
  t marketing_os.tasks;
  out_id uuid;
begin
  if not marketing_os_private.can_view_ops(p_member) then
    raise exception 'You cannot plan this person''s day' using errcode = '42501';
  end if;
  if p_day < marketing_os_private.ist_today() then raise exception 'Past days cannot be re-planned'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'A block needs a start before its end'; end if;
  if p_task is null and length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'Choose a task or name the activity'; end if;
  if p_task is not null then
    select * into t from marketing_os.tasks x where x.id = p_task;
    if not found or t.removed_at is not null then raise exception 'Task not found'; end if;
    if t.status in ('done', 'cancelled') then raise exception 'That task is already closed'; end if;
  end if;
  select * into w from marketing_os.work_days x where x.member_id = p_member and x.day = p_day;
  if not found or w.planned_start is null then raise exception 'Set the working hours for the day first'; end if;
  if p_start < w.planned_start or p_end > w.planned_end then
    raise exception 'Blocks must fit inside the working hours (% – %)', to_char(w.planned_start, 'HH24:MI'), to_char(w.planned_end, 'HH24:MI');
  end if;
  if exists (select 1 from marketing_os.plan_items i where i.member_id = p_member and i.day = p_day and i.removed_at is null
             and i.id is distinct from p_id and i.starts_at < p_end and i.ends_at > p_start) then
    raise exception 'This overlaps another planned block';
  end if;

  if p_id is null then
    insert into marketing_os.plan_items (member_id, day, task_id, title, starts_at, ends_at, suggested, created_by)
    values (p_member, p_day, p_task, nullif(btrim(coalesce(p_title, '')), ''), p_start, p_end, p_member <> me, me)
    returning id into out_id;
  else
    select * into item from marketing_os.plan_items i where i.id = p_id;
    if not found or item.removed_at is not null or item.member_id <> p_member then raise exception 'Planned block not found'; end if;
    if item.day < marketing_os_private.ist_today() then raise exception 'Past days cannot be re-planned'; end if;
    update marketing_os.plan_items
       set day = p_day, task_id = p_task, title = nullif(btrim(coalesce(p_title, '')), ''), starts_at = p_start, ends_at = p_end,
           -- a change by someone else is a suggestion again; the member's own change accepts it
           suggested = case when p_member <> me then true else item.suggested end,
           accepted_at = case when p_member <> me then null when item.suggested then coalesce(item.accepted_at, now()) else item.accepted_at end,
           updated_by = me, updated_at = now()
     where id = p_id;
    out_id := p_id;
  end if;
  return out_id;
end;
$$;

create function marketing_os.ops_plan_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  item marketing_os.plan_items;
begin
  select * into item from marketing_os.plan_items i where i.id = p_id;
  if not found or item.removed_at is not null then raise exception 'Planned block not found'; end if;
  if not marketing_os_private.can_view_ops(item.member_id) then raise exception 'You cannot plan this person''s day' using errcode = '42501'; end if;
  if item.day < marketing_os_private.ist_today() then raise exception 'Past days cannot be re-planned'; end if;
  update marketing_os.plan_items set removed_at = now(), removed_by = me, updated_at = now() where id = p_id;
end;
$$;

create function marketing_os.ops_plan_accept(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := marketing_os_private.require_member();
  n integer;
begin
  update marketing_os.plan_items set accepted_at = now(), updated_at = now()
   where member_id = me and day = p_day and suggested and accepted_at is null and removed_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- access
alter table marketing_os.ops_viewers   enable row level security;
alter table marketing_os.ops_viewers   force row level security;
alter table marketing_os.work_days     enable row level security;
alter table marketing_os.work_days     force row level security;
alter table marketing_os.plan_items    enable row level security;
alter table marketing_os.plan_items    force row level security;
alter table marketing_os.task_sessions enable row level security;
alter table marketing_os.task_sessions force row level security;

create policy ops_viewers_select on marketing_os.ops_viewers for select to authenticated
  using (viewer_id = marketing_os_private.current_member_id());
create policy work_days_select on marketing_os.work_days for select to authenticated
  using (marketing_os_private.can_view_ops(member_id));
create policy plan_items_select on marketing_os.plan_items for select to authenticated
  using (marketing_os_private.can_view_ops(member_id));
create policy task_sessions_select on marketing_os.task_sessions for select to authenticated
  using (marketing_os_private.can_view_ops(member_id));

-- read-only to the app: every change goes through the functions above
grant select on marketing_os.ops_viewers, marketing_os.work_days, marketing_os.plan_items, marketing_os.task_sessions to authenticated;
grant select on marketing_os.ops_viewers, marketing_os.work_days, marketing_os.plan_items, marketing_os.task_sessions to service_role;

revoke all on function marketing_os_private.ist_today() from public;
revoke all on function marketing_os_private.can_view_ops(uuid) from public;
revoke all on function marketing_os_private.close_stale_sessions(uuid) from public;
revoke all on function marketing_os_private.ensure_work_day(uuid, date) from public;
grant execute on function marketing_os_private.can_view_ops(uuid) to authenticated, service_role;
grant execute on function marketing_os_private.ist_today() to authenticated, service_role;

revoke all on function marketing_os.ops_set_hours(uuid, date, time, time) from public;
revoke all on function marketing_os.ops_check_in() from public;
revoke all on function marketing_os.ops_check_out() from public;
revoke all on function marketing_os.ops_punch_in(uuid, uuid) from public;
revoke all on function marketing_os.ops_punch_out(text) from public;
revoke all on function marketing_os.ops_plan_save(uuid, uuid, date, uuid, text, time, time) from public;
revoke all on function marketing_os.ops_plan_remove(uuid) from public;
revoke all on function marketing_os.ops_plan_accept(date) from public;
grant execute on function marketing_os.ops_set_hours(uuid, date, time, time) to authenticated;
grant execute on function marketing_os.ops_check_in() to authenticated;
grant execute on function marketing_os.ops_check_out() to authenticated;
grant execute on function marketing_os.ops_punch_in(uuid, uuid) to authenticated;
grant execute on function marketing_os.ops_punch_out(text) to authenticated;
grant execute on function marketing_os.ops_plan_save(uuid, uuid, date, uuid, text, time, time) to authenticated;
grant execute on function marketing_os.ops_plan_remove(uuid) to authenticated;
grant execute on function marketing_os.ops_plan_accept(date) to authenticated;

-- ---------------------------------------------------------------- the one admin-to-admin grant asked for
-- Sourabh may see Tanvi's Daily Ops and performance; Tanvi may not see Sourabh's.
insert into marketing_os.ops_viewers (viewer_id, subject_id)
select v.id, s.id
from marketing_os.members v
join marketing_os.members s on s.username = 'tanvi'
where v.username = 'sourabh'
on conflict do nothing;
