-- TEST ONLY. Workspace business rules and access control (Phase 1).
-- Runs after 10_rls.test.sql, reusing its helpers and fixtures.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function test.uid(name text) returns uuid language sql immutable as $$
  select case name
    when 'admin'       then '00000000-0000-0000-0000-00000000000a'::uuid
    when 'contributor' then '00000000-0000-0000-0000-00000000000c'::uuid
    when 'editor'      then '00000000-0000-0000-0000-00000000000d'::uuid
    when 'outsider'    then '00000000-0000-0000-0000-00000000000e'::uuid
    when 'inactive'    then '00000000-0000-0000-0000-00000000000f'::uuid
  end
$$;

create or replace function test.mid(name text) returns uuid language sql stable as $$
  select id from marketing_os.members where user_id = test.uid(name)
$$;
grant execute on function test.mid(text) to authenticated, anon, service_role;

insert into auth.users (id, email) values (test.uid('editor'), 'editor@example.test');
insert into marketing_os.members (user_id, username, email, display_name, role)
values (test.uid('editor'), 'editor', 'editor@example.test', 'Editor', 'contributor');

create or replace function test.task(p_title text) returns uuid language sql stable as $$
  select id from marketing_os.tasks where title = p_title
$$;
create or replace function test.stage(p_title text, p_code text) returns uuid language sql stable as $$
  select s.id from marketing_os.task_stages s join marketing_os.tasks t on t.id = s.task_id
  where t.title = p_title and s.stage_code = p_code order by s.position limit 1
$$;
grant execute on function test.task(text), test.stage(text, text) to authenticated, anon, service_role;

begin;

-- ---------------------------------------------------------------- creating tasks
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, priority, owner_id, created_by, status, due_date)
  values ('Script 1', 'content_development', 'planned', 'high', test.mid('contributor'), test.mid('admin'), 'done', '2026-11-01')
$q$) is null, 'contributor can create a task');
select test.ok((select created_by = test.mid('contributor') and status = 'not_started'
                from marketing_os.tasks where title = 'Script 1'),
  'creator and initial status are set by the server, not the client');
select test.ok((select w.code from marketing_os.tasks t join marketing_os.workflow_templates w on w.id = t.workflow_template_id
                where t.title = 'Script 1') = 'script_copy', 'default workflow template chosen from task type');
select test.ok((select count(*) from marketing_os.task_stages where task_id = test.task('Script 1')) = 6,
  'workflow stages instantiated from the template');
select test.ok((select state = 'active' and owner_id = test.mid('contributor') and entered_at is not null
                from marketing_os.task_stages where id = test.stage('Script 1', 'brief_intake')),
  'first stage is active and owned by the task owner');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('For editor', 'editing', 'ad_hoc', test.mid('editor'), test.mid('contributor'))
$q$) is null, 'contributor can assign a new task to someone else');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Bad type', 'not_a_type', 'planned', test.mid('contributor'), test.mid('contributor'))
$q$) like '%not an active value%', 'unknown task types are rejected');
select test.ok(test.try('authenticated', 'outsider', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Sneaky', 'ad_hoc', 'planned', test.mid('admin'), test.mid('admin'))
$q$) is not null, 'non-member cannot create tasks');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.tasks') = 0,
  'non-member sees no tasks');
select test.ok(test.try('anon', null, $q$select marketing_os.task_pick_up(test.task('Script 1'))$q$) like 'permission denied%',
  'anon cannot run workflow actions');

-- ---------------------------------------------------------------- editing rules
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set status = 'done' where title = 'Script 1'$q$) like '%workflow actions%',
  'status cannot be edited directly');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set due_date = '2026-12-01' where title = 'Script 1'$q$) like '%Only admins%',
  'owner cannot change the due date');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set owner_id = test.mid('editor') where title = 'Script 1'$q$) like '%Only admins%',
  'owner cannot reassign');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set brief = 'Hook: Papa ki dawai' where title = 'Script 1'$q$) is null,
  'owner can update their own task details');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set due_date = '2026-11-05' where title = 'Script 1'$q$) is null,
  'admin can change the due date');
select test.ok(exists (select 1 from marketing_os.task_events where task_id = test.task('Script 1')
                       and event_type = 'due_date_changed' and to_value = '2026-11-05' and actor_id = test.mid('admin')),
  'due-date change is recorded with actor');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.task_stages set state = 'done'$q$) like 'permission denied%',
  'stages cannot be edited directly');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.task_events (task_id, event_type) values (test.task('Script 1'), 'approved')$q$)
  like 'permission denied%', 'task events cannot be forged');

-- ---------------------------------------------------------------- workflow
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_pick_up(test.task('Script 1'))$q$) is null,
  'owner picks up the first stage');
select test.ok((select status from marketing_os.tasks where title = 'Script 1') = 'in_progress',
  'picking up starts the task');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set status = 'done' where title = 'Script 1'$q$) like '%workflow actions%',
  'direct status edits stay blocked after a workflow action in the same transaction');
select test.ok(test.try('authenticated', 'editor', $q$select marketing_os.task_hand_off(test.task('Script 1'), test.mid('editor'))$q$)
  like '%Only the task owner%', 'unrelated member cannot hand off someone else''s task');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_hand_off(test.task('Script 1'), test.mid('editor'), 'Brief ready')$q$) is null,
  'owner hands off to the next stage');
select test.ok((select state = 'active' and owner_id = test.mid('editor') and ready_at is not null and picked_up_at is null
                from marketing_os.task_stages where id = test.stage('Script 1', 'writing_scripting')),
  'next stage is ready and waiting for pick-up by its owner');
select test.ok((select state = 'done' and completed_at is not null
                from marketing_os.task_stages where id = test.stage('Script 1', 'brief_intake')),
  'previous stage completed with timestamp');
select test.ok(test.try('authenticated', 'editor', $q$select marketing_os.task_pick_up(test.task('Script 1'))$q$) is null,
  'stage owner picks up');
select test.ok(test.try('authenticated', 'editor',
  $q$select marketing_os.task_hand_off(test.task('Script 1'), test.mid('contributor'))$q$) is null,
  'stage owner can hand off');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_skip_stage(test.task('Script 1'), test.stage('Script 1', 'revisions'), 'No revisions needed')$q$) is null,
  'an upcoming optional stage can be skipped');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_return_for_rework(test.task('Script 1'), test.stage('Script 1', 'writing_scripting'), '')$q$)
  like '%reason%', 'rework needs a reason');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_return_for_rework(test.task('Script 1'), test.stage('Script 1', 'writing_scripting'), 'Hook too long')$q$) is null,
  'work can be returned to an earlier stage');
select test.ok((select revision_count = 1 and state = 'active' from marketing_os.task_stages
                where id = test.stage('Script 1', 'writing_scripting')), 'rework increments the revision count');
select test.ok((select state from marketing_os.task_stages where id = test.stage('Script 1', 'internal_review')) = 'pending',
  'later stages go back to pending');
select test.ok((select count(*) from marketing_os.task_events where task_id = test.task('Script 1')
                and event_type in ('handed_off', 'picked_up', 'returned_for_rework')) >= 4,
  'history keeps every hand-off, pick-up and return');

select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_set_status(test.task('Script 1'), 'blocked', '')$q$) like '%reason%',
  'blocking needs a reason');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_set_status(test.task('Script 1'), 'blocked', 'Waiting for product prices')$q$) is null,
  'owner can block with a reason');
select test.ok((select blocker_reason from marketing_os.tasks where title = 'Script 1') = 'Waiting for product prices',
  'blocker reason stored');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_set_status(test.task('Script 1'), 'in_progress', 'Prices received')$q$) is null,
  'owner can unblock');

-- ---------------------------------------------------------------- approval
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_submit_for_approval(test.task('Script 1'), 'Ready')$q$) is null,
  'owner submits for approval');
select test.ok((select status from marketing_os.tasks where title = 'Script 1') = 'in_review', 'task is In Review');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_decide(test.task('Script 1'), true, null)$q$) like '%Only admins%',
  'contributor cannot approve completion');
select test.ok(test.try('authenticated', 'admin',
  $q$select marketing_os.task_decide(test.task('Script 1'), false, null)$q$) like '%feedback%',
  'requesting changes needs feedback');
select test.ok(test.try('authenticated', 'admin',
  $q$select marketing_os.task_decide(test.task('Script 1'), false, 'Add the doctor-verified line')$q$) is null,
  'admin requests changes');
select test.ok((select status from marketing_os.tasks where title = 'Script 1') = 'changes_requested',
  'task shows Changes Requested');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_submit_for_approval(test.task('Script 1'), 'Fixed')$q$) is null, 'owner resubmits');
select test.ok(test.try('authenticated', 'admin',
  $q$select marketing_os.task_decide(test.task('Script 1'), true, 'Good to go')$q$) is null, 'admin approves');
select test.ok((select status = 'done' and completed_at is not null from marketing_os.tasks where title = 'Script 1'),
  'approved task is Done with completion time');
select test.ok(not exists (select 1 from marketing_os.task_stages where task_id = test.task('Script 1') and state in ('active', 'pending')),
  'no stage left open after approval');
select test.ok(exists (select 1 from marketing_os.task_events where task_id = test.task('Script 1')
                       and event_type = 'approved' and actor_id = test.mid('admin') and note = 'Good to go'),
  'approval recorded with reviewer and feedback');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set brief = 'changed' where title = 'Script 1'$q$) like '%approved and closed%',
  'contributor cannot edit an approved task');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_set_status(test.task('Script 1'), 'in_progress', 'again')$q$) like '%Only admins%',
  'contributor cannot reopen');

-- ---------------------------------------------------------------- goals
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.goals (title, owner_id) values ('My goal', test.mid('contributor'))$q$)
  like 'new row violates row-level security%', 'contributor cannot create goals');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id, progress_method, target_quantity, target_unit)
  values ('Five approved scripts', test.mid('admin'), 'accepted_deliverables', 2, 'scripts')$q$) is null,
  'admin creates a goal');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set goal_id = (select id from marketing_os.goals where title = 'Five approved scripts'),
         counts_toward_goal = true where title = 'Script 1'$q$) is null, 'admin links a task to the goal');
select test.ok((select progress_pct from marketing_os.goal_progress p join marketing_os.goals g on g.id = p.goal_id
                where g.title = 'Five approved scripts') = 50,
  'accepted-deliverable progress = approved counted tasks / target');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id, progress_method) values ('Bad', test.mid('admin'), 'accepted_deliverables')$q$)
  like '%goals_deliverables_need_target%', 'deliverable goals need a target quantity');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.goal_progress') = 0,
  'non-member sees no goal progress');

-- ---------------------------------------------------------------- append-only history
select test.ok(test.try('postgres', null, 'update marketing_os.task_events set note = $$x$$') like '%append-only%',
  'task history cannot be edited, even by the owner');

commit;

\echo 'All workspace tests passed'
