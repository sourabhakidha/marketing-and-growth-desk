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
$q$) is null, 'contributor can request a task');
select test.ok((select created_by = test.mid('contributor') and status = 'requested'
                from marketing_os.tasks where title = 'Script 1'),
  'creator is set by the server and a contributor''s task starts as a request');
select test.ok((select count(*) from marketing_os.task_stages where task_id = test.task('Script 1') and state = 'active') = 0,
  'a request has no active stage until an admin accepts it');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_pick_up(test.task('Script 1'))$q$) is not null
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_set_status(test.task('Script 1'), 'in_progress')$q$) is not null
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_submit_for_approval(test.task('Script 1'))$q$) is not null,
  'no workflow action runs on a request');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_review_request(test.task('Script 1'), true)$q$)
  like '%Only admins%', 'a contributor cannot accept requests');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Script 1'), true)$q$)
  like '%expected business impact%', 'an admin must complete the impact case before accepting');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set impact_outcome = 'More qualified inquiries', impact_rationale = 'Fits the funnel',
    impact_audience = 'Caregivers, Meta', impact_metrics = 'Inquiries per week', impact_evidence = 'hypothesis'
  where title = 'Script 1'$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Script 1'), true, 'Go ahead')$q$) is null,
  'admin completes the impact case and accepts the request "Script 1"');
select test.ok((select status = 'not_started' from marketing_os.tasks where title = 'Script 1')
  and exists (select 1 from marketing_os.task_events where task_id = test.task('Script 1') and event_type = 'request_accepted' and actor_id = test.mid('admin')),
  'acceptance starts the task and is recorded with the admin');
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
  insert into marketing_os.goals (title, owner_id, outcome_statement, outcome_rationale, success_measures) values ('My goal', test.mid('contributor'), 'More qualified inquiries', 'Scripts feed the paid funnel', 'Inquiries per week from scripted ads')$q$)
  like 'new row violates row-level security%', 'contributor cannot create goals');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id, progress_method, target_quantity, target_unit, outcome_statement, outcome_rationale, success_measures)
  values ('Five approved scripts', test.mid('admin'), 'accepted_deliverables', 2, 'scripts', 'More qualified inquiries', 'Scripts feed the paid funnel', 'Inquiries per week from scripted ads')$q$) is null,
  'admin creates a goal');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set goal_id = (select id from marketing_os.goals where title = 'Five approved scripts'),
         counts_toward_goal = true where title = 'Script 1'$q$) is null, 'admin links a task to the goal');
select test.ok((select progress_pct from marketing_os.goal_progress p join marketing_os.goals g on g.id = p.goal_id
                where g.title = 'Five approved scripts') = 50,
  'accepted-deliverable progress = approved counted tasks / target');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id, progress_method, outcome_statement, outcome_rationale, success_measures) values ('Bad', test.mid('admin'), 'accepted_deliverables', 'More qualified inquiries', 'Scripts feed the paid funnel', 'Inquiries per week from scripted ads')$q$)
  like '%goals_deliverables_need_target%', 'deliverable goals need a target quantity');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.goal_progress') = 0,
  'non-member sees no goal progress');

-- ---------------------------------------------------------------- stage held by an admin (D-028)
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Review lock', 'content_development', 'planned', test.mid('contributor'), test.mid('contributor'))$q$) is null,
  'review-lock fixture task created');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set impact_outcome = 'More qualified inquiries', impact_rationale = 'Fits the funnel',
    impact_audience = 'Caregivers, Meta', impact_metrics = 'Inquiries per week', impact_evidence = 'hypothesis'
  where title = 'Review lock'$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Review lock'), true, 'Go ahead')$q$) is null,
  'admin completes the impact case and accepts the request "Review lock"');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('editor'))$q$) is null
  and test.try('authenticated', 'editor', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('admin'), 'Ready for review')$q$) is null,
  'a contributor can hand a stage to an admin for review');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('contributor'))$q$)
  like '%Only the task owner%', 'task owner cannot move a task on while an admin holds the stage');
select test.ok(test.try('authenticated', 'editor', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('editor'))$q$)
  like '%Only the task owner%', 'the previous stage owner cannot move it on either');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_skip_stage(test.task('Review lock'), test.stage('Review lock', 'revisions'), 'skip')$q$) like '%Only the task owner%'
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_submit_for_approval(test.task('Review lock'))$q$) like '%Only the task owner%'
  and test.try('authenticated', 'contributor',
    $q$select marketing_os.task_return_for_rework(test.task('Review lock'), test.stage('Review lock', 'writing_scripting'), 'pull back')$q$) like '%Only the task owner%'
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_set_status(test.task('Review lock'), 'blocked', 'waiting')$q$) like '%Only the task owner%',
  'skip, submit, pull back and block are all held while an admin has the stage');
select test.ok(test.try('authenticated', 'admin',
  $q$select marketing_os.task_return_for_rework(test.task('Review lock'), test.stage('Review lock', 'writing_scripting'), 'Hook too long')$q$) is null,
  'the admin can send it back for revision');
select test.ok(test.try('authenticated', 'editor', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('admin'), 'Revised')$q$) is null,
  'after a revision the stage owner works again and re-submits to the admin');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_hand_off(test.task('Review lock'), test.mid('contributor'), 'Approved')$q$) is null,
  'the admin approves the review by handing it on');
select test.ok(test.try('authenticated', 'contributor',
  $q$select marketing_os.task_skip_stage(test.task('Review lock'), test.stage('Review lock', 'scheduling_handoff'), 'not needed')$q$) is null,
  'once the admin hands it back, the owner can move it again');

-- ---------------------------------------------------------------- business impact (D-030)
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('No impact', 'ad_hoc', 'planned', test.mid('contributor'), test.mid('admin'))$q$) like '%Expected business impact is required%',
  'an admin cannot create a task without its expected business impact');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by,
    impact_outcome, impact_rationale, impact_audience, impact_metrics, impact_evidence)
  values ('With impact', 'ad_hoc', 'planned', test.mid('contributor'), test.mid('admin'),
    'More app installs from caregivers', 'Caregiver ads convert best', 'Caregivers 35-55, Meta', 'Installs per 1k reach', 'historical')$q$) is null,
  'an admin creates a task with its expected business impact');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by,
    impact_outcome, impact_rationale, impact_audience, impact_metrics, impact_evidence)
  values ('Bad evidence', 'ad_hoc', 'planned', test.mid('contributor'), test.mid('admin'), 'x', 'y', 'z', 'm', 'proven')$q$)
  like '%tasks_impact_evidence%', 'evidence level must be hypothesis, historical or committed');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Contributor idea', 'ad_hoc', 'planned', test.mid('contributor'), test.mid('contributor'))$q$) is null,
  'a contributor can still create a task without impact (not forced)');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set owner_id = test.mid('editor') where title = 'Contributor idea'$q$) like '%Expected business impact is required%',
  'an admin assigning a task must give its expected business impact');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set owner_id = test.mid('editor'), impact_outcome = 'Fewer support calls', impact_rationale = 'FAQ gap',
    impact_audience = 'Existing users, app', impact_metrics = 'Support tickets per week', impact_evidence = 'hypothesis'
  where title = 'Contributor idea'$q$) is null, 'assigning with the impact case filled in works');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set impact_outcome = '  ' where title = 'With impact'$q$) like '%revised but not removed%',
  'the impact case cannot be emptied once given');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id) values ('Tasks only', test.mid('admin'))$q$) like '%expected business outcome%',
  'a goal needs its business outcome, rationale and success measures');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.goals (title, owner_id, outcome_statement, outcome_rationale, success_measures, outcome_kind, outcome_metric)
  values ('Measurable without target', test.mid('admin'), 'o', 'r', 's', 'measurable', 'installs')$q$) like '%goals_measurable_target%',
  'a measurable outcome needs a metric and a target');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.goals set outcome_status = 'partially_achieved', outcome_evidence = 'Meta report wk 43'
  where title = 'Five approved scripts'$q$) is null
  and (select outcome_assessed_by = test.mid('admin') and outcome_assessed_at is not null
       from marketing_os.goals where title = 'Five approved scripts'),
  'recording the actual outcome stores who assessed it and when');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.impact_assessments (subject, task_id) values ('task', test.task('With impact'))$q$) is null
  and (select status = 'queued' and created_by = test.mid('contributor') from marketing_os.impact_assessments
       where task_id = test.task('With impact')),
  'a member can request an AI impact assessment; it starts queued and records the requester');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.impact_assessments (subject, goal_id) values ('task', (select id from marketing_os.goals limit 1))$q$)
  like '%impact_assessments_target%', 'an assessment must point at the subject it names');
select test.ok(test.try('authenticated', 'editor', $q$
  update marketing_os.impact_assessments set status = 'ready', output = '{}' where task_id = test.task('With impact')$q$) is null
  and (select status = 'queued' from marketing_os.impact_assessments where task_id = test.task('With impact')),
  'only the requester can fill in an assessment');
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.impact_assessments') = 0,
  'non-member sees no assessments');

-- ---------------------------------------------------------------- task requests (D-033)
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Decline me', 'ad_hoc', 'planned', test.mid('contributor'), test.mid('contributor'))$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Decline me'), false, '')$q$) like '%reason%',
  'declining a request needs a reason');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Decline me'), false, 'Not this month')$q$) is null
  and (select status = 'cancelled' from marketing_os.tasks where title = 'Decline me')
  and exists (select 1 from marketing_os.task_events where task_id = test.task('Decline me') and event_type = 'request_declined' and note = 'Not this month'),
  'a declined request is cancelled with its reason recorded');
-- ---------------------------------------------------------------- recycle bin (D-035)
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.task_remove(test.task('With impact'), 'mine')$q$)
  like '%Only admins%', 'a contributor cannot delete a task, even their own');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_remove(test.task('With impact'), '  ')$q$)
  like '%reason%', 'deleting needs a reason');
select test.ok(test.try('authenticated', 'admin', $q$update marketing_os.tasks set removed_at = now() where title = 'With impact'$q$)
  like '%Recycle Bin%', 'the bin columns change only through the bin actions');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_remove(test.task('With impact'), 'Duplicate of Script 1')$q$) is null
  and (select removed_at is not null and removed_by = test.mid('admin') and removed_reason = 'Duplicate of Script 1'
       from marketing_os.tasks where title = 'With impact'),
  'an admin moves a task to the Recycle Bin with who, when and why');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_pick_up(test.task('With impact'))$q$) like '%Recycle Bin%'
  and test.try('authenticated', 'admin', $q$select marketing_os.task_comment(test.task('With impact'), 'hi')$q$) like '%Recycle Bin%',
  'no workflow action or comment runs on a task in the bin, not even for admins');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_restore(test.task('With impact'))$q$) is null
  and (select removed_at is null from marketing_os.tasks where title = 'With impact'),
  'an admin restores it');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_purge(test.task('With impact'))$q$)
  like '%Recycle Bin%', 'only a task in the bin can be deleted permanently');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_remove(test.task('With impact'), 'Duplicate')$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.task_purge(test.task('With impact'))$q$) is null
  and (select purged_at is not null from marketing_os.tasks where title = 'With impact')
  and exists (select 1 from marketing_os.task_events where task_id = test.task('With impact')),
  'deleting permanently hides it from the desk but keeps the row and its history in the database');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_restore(test.task('With impact'))$q$) is not null,
  'a permanently deleted task cannot be restored from the desk');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.goal_remove((select id from marketing_os.goals where title = 'Five approved scripts'), 'Merged')$q$) is null
  and test.try('authenticated', 'contributor', $q$select marketing_os.goal_restore((select id from marketing_os.goals where title = 'Five approved scripts'))$q$) like '%Only admins%'
  and test.try('authenticated', 'admin', $q$select marketing_os.goal_restore((select id from marketing_os.goals where title = 'Five approved scripts'))$q$) is null,
  'goals use the same bin: admin deletes and restores, contributors cannot');

-- ---------------------------------------------------------------- deliverables, parts, channels (D-038, D-039)
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, kind, channel,
    impact_outcome, impact_rationale, impact_audience, impact_metrics, impact_evidence)
  values ('Marathi video', 'content_development', 'planned', test.mid('admin'), test.mid('admin'), 'deliverable', 'meta_ads',
    'More Marathi-speaking installs', 'Regional ads convert', 'Maharashtra, Meta', 'Installs per 1k reach', 'historical')$q$) is null
  and (select workflow_template_id is null from marketing_os.tasks where title = 'Marathi video')
  and (select count(*) from marketing_os.task_stages where task_id = test.task('Marathi video')) = 0,
  'a deliverable is an umbrella with no workflow of its own');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id)
  values ('Marathi script', 'content_development', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi video'))$q$) is null,
  'an admin adds a part without repeating the impact case (it is inherited)');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id)
  values ('Part of a part', 'editing', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi script'))$q$)
  like '%only be part of a deliverable%', 'only one level: a part cannot have parts');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id)
  values ('Marathi edit', 'editing', 'planned', test.mid('editor'), test.mid('contributor'), test.task('Marathi video'))$q$) is null
  and (select status = 'requested' from marketing_os.tasks where title = 'Marathi edit')
  and test.try('authenticated', 'admin', $q$select marketing_os.task_review_request(test.task('Marathi edit'), true)$q$) is null,
  'a contributor requests a part; an admin accepts it without an impact case of its own');
select test.ok(test.try('authenticated', 'contributor', $q$update marketing_os.tasks set parent_id = null where title = 'Marathi script'$q$)
  like '%Only admins%', 'only admins move tasks into or out of a deliverable');
select test.ok(test.try('authenticated', 'admin', $q$update marketing_os.tasks set parent_id = test.task('Marathi video') where title = 'For editor'$q$) is null,
  'an admin groups an existing task under a deliverable');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.task_submit_for_approval(test.task('Marathi video'))$q$) is null
  and test.try('authenticated', 'admin', $q$select marketing_os.task_decide(test.task('Marathi video'), true)$q$) like '%unfinished part%',
  'a deliverable cannot be approved while parts are unfinished');
select test.ok(test.try('authenticated', 'admin', $q$update marketing_os.tasks set kind = 'deliverable' where title = 'Marathi script'$q$)
  like '%cannot be turned into a deliverable%', 'kind is fixed after creation');
select test.ok(test.try('authenticated', 'admin', $q$update marketing_os.tasks set channel = 'billboards' where title = 'Marathi script'$q$)
  like '%not an active value%'
  and test.try('authenticated', 'admin', $q$update marketing_os.goals set channel = 'whatsapp' where title = 'Five approved scripts'$q$) is null,
  'channels come from the fixed list, for tasks and goals');

-- ---------------------------------------------------------------- how a task runs (D-041)
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id, initial_stages)
  values ('Marathi image 1', 'graphic_designing', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi video'),
          array['asset_creation'])$q$) is null
  and (select array_agg(stage_code order by position) from marketing_os.task_stages where task_id = test.task('Marathi image 1')) = array['asset_creation']
  and (select state = 'active' from marketing_os.task_stages where task_id = test.task('Marathi image 1')),
  'a standalone task runs a single chosen step and starts there');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id, initial_stages)
  values ('Script from idea', 'content_development', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi video'),
          array['writing_scripting', 'internal_review'])$q$) is null
  and (select array_agg(stage_code order by position) from marketing_os.task_stages where task_id = test.task('Script from idea'))
      = array['writing_scripting', 'internal_review'],
  'a workflow can leave out steps that are already done');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id, initial_stages)
  values ('Bad steps', 'editing', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi video'), array['editing_assembly', 'editing_assembly'])$q$)
  like '%only once%'
  and test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, parent_id, initial_stages)
  values ('Bad steps 2', 'editing', 'planned', test.mid('contributor'), test.mid('admin'), test.task('Marathi video'), array['dancing'])$q$)
  like '%not an active value%',
  'steps must be real and not repeated');
select test.ok((select label from marketing_os.vocab_terms where vocabulary = 'workflow_stage' and code = 'asset_creation') = 'Design / Production',
  'step names are short and plain');

-- ---------------------------------------------------------------- regression: ordinary edits pass the bin guard
select test.ok(test.try('authenticated', 'contributor', $q$update marketing_os.tasks set brief = 'edited after the bin existed' where title = 'Marathi script'$q$) is null
  and test.try('authenticated', 'admin', $q$update marketing_os.goals set description = 'edited' where title = 'Five approved scripts'$q$) is null,
  'members can still save ordinary edits to tasks and goals (the bin guard runs with owner rights)');

-- ---------------------------------------------------------------- audit fixes (D-043)
select test.ok(test.try('authenticated', 'admin', $q$update marketing_os.tasks set parent_id = null where title = 'Marathi image 1'$q$)
  like '%business impact is required%',
  'a task taken out of a deliverable needs its own business impact (it no longer inherits one)');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by)
  values ('Audit request', 'content_development', 'planned', test.mid('contributor'), test.mid('contributor'))$q$) is null
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_set_status(test.task('Audit request'), 'in_progress')$q$)
      like '%accepts or declines it first%'
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_set_status(test.task('Audit request'), 'cancelled', 'not needed')$q$) is null
  and test.try('authenticated', 'contributor', $q$select marketing_os.task_set_status(test.task('Audit request'), 'not_started')$q$)
      like '%Only admins can reopen%'
  and test.try('authenticated', 'admin', $q$select marketing_os.task_set_status(test.task('Audit request'), 'not_started')$q$)
      like '%never accepted%',
  'a request cannot be started before acceptance, and a withdrawn request cannot be reopened');

-- ---------------------------------------------------------------- append-only history
select test.ok(test.try('postgres', null, 'update marketing_os.task_events set note = $$x$$') like '%append-only%',
  'task history cannot be edited, even by the owner');

commit;

\echo 'All workspace tests passed'
