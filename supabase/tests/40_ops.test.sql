-- TEST ONLY. Daily Ops (D-046): planning, punch-in/out and who may see whose day.
-- Runs after 10_rls / 20_workspace and reuses their helpers and fixtures.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- a second admin, to test admin-to-admin access (granted one way only)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.test');
insert into marketing_os.members (user_id, username, email, display_name, role, is_active)
values ('00000000-0000-0000-0000-0000000000a2', 'admin2', 'admin2@example.test', 'Admin Two', 'admin', true);

create or replace function test.try_uid(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql; exception when others then get stacked diagnostics msg = message_text; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return msg;
end $$;
create or replace function test.count_uid(p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from (%s) q', p_sql) into n;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return n;
end $$;
grant execute on function test.try_uid(uuid, text), test.count_uid(uuid, text) to authenticated, anon, service_role;

begin;

-- admin may see admin2 (granted); admin2 may not see admin
insert into marketing_os.ops_viewers (viewer_id, subject_id)
select a.id, b.id from marketing_os.members a join marketing_os.members b on b.username = 'admin2' where a.username = 'admin';

-- ---------------------------------------------------------------- planning
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_set_hours(test.mid('contributor'), marketing_os_private.ist_today(), '10:00', '18:00')$q$) is null
  and test.try('authenticated', 'contributor', $q$select marketing_os.ops_plan_save(null, test.mid('contributor'), marketing_os_private.ist_today(), test.task('Marathi image 1'), null, '11:00', '12:00')$q$) is null,
  'a member sets working hours and plans a task block inside them');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_plan_save(null, test.mid('contributor'), marketing_os_private.ist_today(), null, 'Early call', '09:00', '10:30')$q$) like '%inside the working hours%'
  and test.try('authenticated', 'contributor', $q$select marketing_os.ops_plan_save(null, test.mid('contributor'), marketing_os_private.ist_today(), null, 'Sync', '11:30', '12:30')$q$) like '%overlaps%'
  and test.try('authenticated', 'contributor', $q$select marketing_os.ops_set_hours(test.mid('contributor'), marketing_os_private.ist_today() - 1, '10:00', '18:00')$q$) like '%Past days%',
  'blocks must fit the hours and not overlap; past days are a record');

-- ---------------------------------------------------------------- punch in / out, stamped by the server
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_punch_in(test.task('Marathi image 1'), null)$q$) is null
  and (select checked_in_at is not null from marketing_os.work_days where member_id = test.mid('contributor') and day = marketing_os_private.ist_today())
  and test.try('authenticated', 'contributor', $q$select marketing_os.ops_check_in()$q$) like '%already checked in%',
  'punching in on a task checks the member in');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_punch_in(test.task('Marathi image 1'), null)$q$) is null
  and (select count(*) from marketing_os.task_sessions where member_id = test.mid('contributor') and ended_at is null) = 1
  and (select count(*) from marketing_os.task_sessions where member_id = test.mid('contributor') and ended_by = 'switch') = 1,
  'punching in again ends the previous session: one open session at a time');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_check_out()$q$) is null
  and (select count(*) from marketing_os.task_sessions where member_id = test.mid('contributor') and ended_at is null) = 0,
  'checking out ends the open session');
select test.ok(test.try('authenticated', 'contributor', $q$insert into marketing_os.work_days (member_id, day) values (test.mid('contributor'), current_date + 5)$q$) like 'permission denied%'
  and test.try('authenticated', 'contributor', $q$update marketing_os.task_sessions set started_at = now() - interval '3 hours'$q$) like 'permission denied%',
  'times cannot be written or edited directly');

-- ---------------------------------------------------------------- who sees whose day
select test.ok(test.count_as('authenticated', 'admin', $q$select * from marketing_os.task_sessions where member_id = test.mid('contributor')$q$) > 0,
  'an admin sees a contributor''s records');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.ops_plan_save(null, test.mid('contributor'), marketing_os_private.ist_today(), null, 'Review', '15:00', '15:30')$q$) is null
  and (select suggested and accepted_at is null from marketing_os.plan_items where title = 'Review'),
  'an admin''s change to a contributor''s day is a suggestion');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.ops_plan_accept(marketing_os_private.ist_today())$q$) is null
  and (select accepted_at is not null from marketing_os.plan_items where title = 'Review'),
  'the member accepts suggestions');
select test.ok(test.try_uid('00000000-0000-0000-0000-0000000000a2', $q$select marketing_os.ops_set_hours(test.mid('admin2'), marketing_os_private.ist_today(), '09:00', '17:00')$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.ops_set_hours(test.mid('admin'), marketing_os_private.ist_today(), '09:00', '17:00')$q$) is null,
  'admins plan their own days');
select test.ok(test.count_as('authenticated', 'admin', $q$select * from marketing_os.work_days where member_id = test.mid('admin2')$q$) = 1
  and test.count_uid('00000000-0000-0000-0000-0000000000a2', $q$select * from marketing_os.work_days where member_id = test.mid('admin')$q$) = 0
  and test.try_uid('00000000-0000-0000-0000-0000000000a2', $q$select marketing_os.ops_set_hours(test.mid('admin'), marketing_os_private.ist_today() + 1, '09:00', '17:00')$q$) like '%cannot plan%',
  'admin-to-admin access is granted one way only');
select test.ok(test.count_as('authenticated', 'contributor', $q$select * from marketing_os.work_days where member_id <> test.mid('contributor')$q$) = 0
  and test.count_as('authenticated', 'contributor', $q$select * from marketing_os.ops_viewers$q$) = 0
  and test.try('authenticated', 'contributor', $q$select marketing_os.ops_set_hours(test.mid('admin'), marketing_os_private.ist_today() + 1, '09:00', '17:00')$q$) like '%cannot plan%',
  'a contributor sees and plans only their own day');
select test.ok(test.try('anon', null, 'select * from marketing_os.task_sessions') like 'permission denied%'
  and test.try('anon', null, 'select marketing_os.ops_check_in()') like 'permission denied%',
  'signed-out visitors get nothing');

commit;

\echo 'All Daily Ops tests passed'
