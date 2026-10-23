-- TEST ONLY. Access-control tests for the marketing_os schema.
-- Run by scripts/test-db.sh against a throwaway database (never production).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create schema if not exists test;

-- Fixed test identities
create or replace function test.uid(name text) returns uuid language sql immutable as $$
  select case name
    when 'admin'       then '00000000-0000-0000-0000-00000000000a'::uuid
    when 'contributor' then '00000000-0000-0000-0000-00000000000c'::uuid
    when 'outsider'    then '00000000-0000-0000-0000-00000000000e'::uuid
    when 'inactive'    then '00000000-0000-0000-0000-00000000000f'::uuid
  end
$$;

-- Run `sql` as the given API role / user; returns the error message or NULL
create or replace function test.try(p_role text, p_user text, p_sql text)
returns text language plpgsql as $$
declare msg text;
begin
  perform set_config('request.jwt.claims',
    coalesce(json_build_object('sub', test.uid(p_user), 'role', p_role)::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics msg = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return msg;
end $$;

create or replace function test.count_as(p_role text, p_user text, p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    coalesce(json_build_object('sub', test.uid(p_user), 'role', p_role)::text, ''), true);
  execute format('set local role %I', p_role);
  execute format('select count(*) from (%s) q', p_sql) into n;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return n;
end $$;

create or replace function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Fixtures (as superuser)
insert into auth.users (id, email) values
  (test.uid('admin'), 'admin@example.test'),
  (test.uid('contributor'), 'contributor@example.test'),
  (test.uid('outsider'), 'outsider@example.test'),
  (test.uid('inactive'), 'inactive@example.test');

insert into marketing_os.members (user_id, username, email, display_name, role, is_active) values
  (test.uid('admin'), 'admin', 'admin@example.test', 'Admin', 'admin', true),
  (test.uid('contributor'), 'contributor', 'contributor@example.test', 'Contributor', 'contributor', true),
  (test.uid('inactive'), 'inactive', 'inactive@example.test', 'Former', 'contributor', false);

begin;

-- ---------------------------------------------------------------- anon
select test.ok(test.try('anon', null, 'select * from marketing_os.members') like 'permission denied%',
  'anon cannot read members');
select test.ok(test.try('anon', null, 'select * from marketing_os.vocab_terms') like 'permission denied%',
  'anon cannot read vocab_terms');
select test.ok(test.try('anon', null, 'select marketing_os_private.is_admin()') like 'permission denied%',
  'anon cannot execute private helpers');

-- ---------------------------------------------------------------- signed in, not a member
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.members') = 0,
  'shared-auth user without membership sees no members');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.vocab_terms') = 0,
  'non-member sees no vocabularies');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.audit_events') = 0,
  'non-member sees no audit events');
select test.ok(test.try('authenticated', 'outsider',
  $q$insert into marketing_os.members (user_id, username, email, display_name, role)
     values (test.uid('outsider'), 'outsider', 'outsider@example.test', 'Me', 'admin')$q$)
  like 'new row violates row-level security%',
  'non-member cannot grant themselves membership');

-- ---------------------------------------------------------------- inactive member
select test.ok(test.count_as('authenticated', 'inactive', 'select * from marketing_os.vocab_terms') = 0,
  'inactive member has no access to data');
select test.ok(test.count_as('authenticated', 'inactive', 'select * from marketing_os.members') = 1,
  'inactive member can see only their own membership row');

-- ---------------------------------------------------------------- contributor
select test.ok(test.count_as('authenticated', 'contributor', 'select * from marketing_os.members') = 3,
  'contributor can see the team');
select test.ok(test.count_as('authenticated', 'contributor', 'select * from marketing_os.vocab_terms') > 0,
  'contributor can read vocabularies');
select test.ok(test.try('authenticated', 'contributor',
  $q$insert into marketing_os.vocab_terms (vocabulary, code, label) values ('priority','urgent','Urgent')$q$)
  like 'new row violates row-level security%',
  'contributor cannot add vocabulary terms');
select test.try('authenticated', 'contributor',
  $q$update marketing_os.members set role = 'admin' where user_id = test.uid('contributor')$q$);
select test.ok((select role from marketing_os.members where user_id = test.uid('contributor')) = 'contributor',
  'contributor cannot promote themselves');
select test.ok(test.try('authenticated', 'contributor',
  $q$insert into marketing_os.audit_events (entity_type, entity_id, event_type) values ('x','1','forged')$q$)
  like 'permission denied%',
  'contributor cannot write audit events directly');
select test.ok(test.try('authenticated', 'contributor',
  'delete from marketing_os.members') like 'permission denied%',
  'members cannot be deleted through the API');

-- ---------------------------------------------------------------- admin
select test.ok(test.try('authenticated', 'admin',
  $q$insert into marketing_os.vocab_terms (vocabulary, code, label, sort_order) values ('priority','urgent','Urgent', 5)$q$) is null,
  'admin can add a vocabulary term');
select test.ok(exists (
  select 1 from marketing_os.audit_events
  where entity_type = 'vocab_terms' and event_type = 'created'
    and actor_user_id = test.uid('admin') and source = 'user'
    and new_value ->> 'code' = 'urgent'),
  'admin change is audited with actor and source');
select test.ok(test.try('authenticated', 'admin',
  $q$update marketing_os.members set is_active = false where user_id = test.uid('admin')$q$)
  like '%at least one active admin%',
  'last active admin cannot be deactivated');
select test.ok(test.try('authenticated', 'admin',
  $q$update marketing_os.members set role = 'admin' where user_id = test.uid('contributor')$q$) is null,
  'admin can promote a contributor');
select test.ok(test.try('authenticated', 'admin',
  $q$update marketing_os.members set role = 'contributor' where user_id = test.uid('admin')$q$) is null,
  'an admin can step down once another admin exists');
select test.ok(test.try('authenticated', 'admin',
  $q$insert into marketing_os.vocab_terms (vocabulary, code, label) values ('priority','x','X')$q$)
  like 'new row violates row-level security%',
  'demoted admin immediately loses admin rights');

-- ---------------------------------------------------------------- audit is append-only
select test.ok(test.try('postgres', null, 'update marketing_os.audit_events set event_type = $$tampered$$')
  like '%append-only%', 'audit events cannot be edited, even by the owner');
select test.ok(test.try('postgres', null, 'delete from marketing_os.audit_events')
  like '%append-only%', 'audit events cannot be deleted, even by the owner');

select test.ok(test.try('postgres', null,
  $q$insert into marketing_os.members (username, email, display_name) values ('Bad Name', 'x@y.z', 'X')$q$)
  like '%members_username_format%', 'usernames must be lowercase without spaces');

-- ---------------------------------------------------------------- service role
select test.ok(test.count_as('service_role', null, 'select * from marketing_os.members') = 3,
  'service_role (admin script) can read members');

rollback;

\echo 'All marketing_os access tests passed'
