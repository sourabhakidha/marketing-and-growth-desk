-- TEST ONLY. Calendar, Radar, Opportunities, AI drafts, Knowledge, Learnings.
-- Runs after 10_rls / 20_workspace and reuses their helpers and fixtures.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function test.opp(p_title text) returns uuid language sql stable as $$
  select id from marketing_os.opportunities where title = p_title
$$;
create or replace function test.sig(p_title text) returns uuid language sql stable as $$
  select id from marketing_os.radar_signals where title = p_title
$$;
grant execute on function test.opp(text), test.sig(text) to authenticated, anon, service_role;

begin;

-- ---------------------------------------------------------------- seeds
select test.ok((select count(*) from marketing_os.radar_sources) >= 9, 'radar sources seeded');
select test.ok((select count(*) from marketing_os.knowledge_documents where kind = 'brand_guidelines') = 1, 'brand guidelines loaded');
select test.ok((select count(*) from marketing_os.knowledge_documents where kind = 'script_pattern') >= 40, 'script patterns loaded');
select test.ok(not exists (select 1 from marketing_os.knowledge_documents where kind = 'script_pattern'
  and (content ~ '[0-9]+\s?%' or regexp_replace(content, '₹(500 note|300 T-shirt)', '', 'g') ~ '₹\s?[0-9]')),
  'script patterns carry no medicine prices or savings percentages');

-- ---------------------------------------------------------------- calendar: publish date rule
select test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, publish_date)
  values ('Reel 1', 'editing', 'planned', test.mid('contributor'), test.mid('contributor'), '2026-11-10')$q$);
select test.ok((select publish_date = '2026-11-10' from marketing_os.tasks where title = 'Reel 1'), 'publish date set at creation');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.tasks set publish_date = '2026-11-12' where title = 'Reel 1'$q$) like '%Only admins%',
  'contributor cannot move a publish date');
select test.ok(test.try('authenticated', 'admin', $q$
  update marketing_os.tasks set publish_date = '2026-11-12' where title = 'Reel 1'$q$) is null, 'admin can move a publish date');
select test.ok(exists (select 1 from marketing_os.task_events where event_type = 'publish_date_changed' and to_value = '2026-11-12'),
  'publish-date change is recorded');

-- ---------------------------------------------------------------- radar
select test.ok(test.count_as('authenticated', 'outsider', 'select * from marketing_os.radar_signals') = 0, 'non-member sees no signals');
select test.ok(test.try('anon', null, 'select * from marketing_os.radar_sources') like 'permission denied%', 'anon cannot read radar');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.radar_signals (source_type, source_name, url, fingerprint, title, status, collected_by)
  values ('manual', 'Manual', 'https://example.org/a', 'manual:https://example.org/a', 'Price cap news', 'converted', test.mid('admin'))$q$) is null,
  'member adds a manual signal');
select test.ok((select status = 'new' and collected_by = test.mid('contributor') from marketing_os.radar_signals where title = 'Price cap news'),
  'server sets collector and initial status');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.radar_signals (source_type, source_name, url, fingerprint, title)
  values ('manual', 'Manual', 'https://example.org/a', 'manual:https://example.org/a', 'Duplicate')$q$) like '%duplicate key%',
  'duplicates are rejected by fingerprint');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.radar_signals (source_type, source_name, url, fingerprint, title)
  values ('manual', 'Manual', 'javascript:alert(1)', 'x', 'Bad link')$q$) like '%radar_signals_url%', 'only http(s) links accepted');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.radar_signals set status = 'saved', notes = 'Useful for explainer' where title = 'Price cap news'$q$) is null,
  'member triages a signal');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.radar_signals set url = 'https://evil.example' where title = 'Price cap news'$q$) is null
  and (select url from marketing_os.radar_signals where title = 'Price cap news') = 'https://example.org/a',
  'source URL cannot be rewritten');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.radar_signals set status = 'converted' where title = 'Price cap news'$q$) like '%linked to an opportunity%',
  'converted only through linking');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.radar_sources set is_active = false$q$) is null
  and (select bool_and(is_active) from marketing_os.radar_sources), 'contributor cannot change sources');
select test.ok(test.try('authenticated', 'contributor', $q$select marketing_os.radar_start_scan()$q$) is null, 'member starts a scan');
select test.ok(test.try('authenticated', 'admin', $q$select marketing_os.radar_start_scan()$q$) like '%already running%',
  'one scan at a time');
select test.ok(test.try('authenticated', 'admin', $q$
  select marketing_os.radar_finish_scan((select id from marketing_os.radar_scans limit 1), '[]'::jsonb)$q$) like '%not found%',
  'only the starter finishes a scan');
select test.ok(test.try('authenticated', 'contributor', $q$
  select marketing_os.radar_finish_scan((select id from marketing_os.radar_scans limit 1),
    jsonb_build_array(
      jsonb_build_object('source_id', (select id from marketing_os.radar_sources where kind = 'reddit' limit 1), 'status', 'not_configured', 'fetched', 0, 'inserted', 0),
      jsonb_build_object('source_id', (select id from marketing_os.radar_sources where kind = 'news_search' limit 1), 'status', 'ok', 'fetched', 10, 'inserted', 7)))$q$) is null,
  'scan results recorded');
select test.ok((select status = 'ok' and inserted = 7 and duplicates = 3 from marketing_os.radar_scans limit 1), 'scan totals computed');
select test.ok((select count(*) from marketing_os.radar_sources where last_status = 'not_configured') = 1,
  'a source that is not configured is shown as such, not as empty');

-- ---------------------------------------------------------------- opportunities
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.opportunities (title, content_angle, status, created_by)
  values ('Explain price caps', 'What NPPA price caps mean for chronic patients', 'approved', test.mid('admin'))$q$) is null,
  'contributor proposes an opportunity');
select test.ok((select status = 'considering' and created_by = test.mid('contributor') from marketing_os.opportunities where title = 'Explain price caps'),
  'new opportunities start as Considering, created by the caller');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.opportunity_signals (opportunity_id, signal_id) values (test.opp('Explain price caps'), test.sig('Price cap news'))$q$) is null,
  'signal linked as evidence');
select test.ok((select status from marketing_os.radar_signals where title = 'Price cap news') = 'converted', 'linked signal becomes Converted');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.opportunities set status = 'approved' where title = 'Explain price caps'$q$) like '%decision buttons%',
  'status cannot be edited directly');
select test.ok(test.try('authenticated', 'contributor', $q$
  select marketing_os.opportunity_decide(test.opp('Explain price caps'), 'approved', null)$q$) like '%Only admins%',
  'contributor cannot approve');
select test.ok(test.try('authenticated', 'admin', $q$
  select marketing_os.opportunity_decide(test.opp('Explain price caps'), 'rejected', '')$q$) like '%reason%',
  'rejection needs a reason');
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, opportunity_id)
  values ('From opp', 'content_development', 'planned', test.mid('contributor'), test.mid('contributor'), test.opp('Explain price caps'))$q$)
  like '%Only admins%', 'contributor cannot convert an opportunity');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, opportunity_id)
  values ('From opp', 'content_development', 'planned', test.mid('contributor'), test.mid('admin'), test.opp('Explain price caps'))$q$)
  like '%approved opportunity%', 'an undecided opportunity cannot become a task');
select test.ok(test.try('authenticated', 'admin', $q$
  select marketing_os.opportunity_decide(test.opp('Explain price caps'), 'approved', 'Timely and on-brand')$q$) is null, 'admin approves');
select test.ok((select decided_by = test.mid('admin') and decided_at is not null from marketing_os.opportunities where title = 'Explain price caps'),
  'decision recorded with decider and time');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.opportunities set content_angle = 'changed' where title = 'Explain price caps'$q$) like '%has been decided%',
  'decided opportunities are locked for contributors');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.tasks (title, task_type, work_origin, owner_id, created_by, opportunity_id)
  values ('Explainer script from opp', 'content_development', 'planned', test.mid('contributor'), test.mid('admin'), test.opp('Explain price caps'))$q$) is null,
  'admin turns an approved opportunity into a task');
select test.ok((select status from marketing_os.opportunities where title = 'Explain price caps') = 'converted',
  'opportunity becomes Converted once work exists');

-- ---------------------------------------------------------------- knowledge
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.knowledge_documents (kind, title, content) values ('reference', 'x', 'y')$q$)
  like 'new row violates row-level security%', 'contributor cannot add knowledge');
select test.ok(test.try('authenticated', 'admin', $q$
  insert into marketing_os.knowledge_documents (kind, title, content) values ('reference', 'Claim wording', 'Approved phrasing…')$q$) is null,
  'admin adds a reference document');
select test.ok(test.count_as('authenticated', 'contributor',
  $q$select * from marketing_os.knowledge_search('papa or family or prescription', 'script_pattern', 3)$q$) = 3,
  'knowledge search returns the requested number of patterns');
select test.ok(test.count_as('authenticated', 'outsider',
  $q$select * from marketing_os.knowledge_search('papa', 'script_pattern', 3)$q$) = 0, 'non-member gets no knowledge');

-- ---------------------------------------------------------------- AI drafts
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.ai_drafts (kind, task_id, instructions, status, output, created_by)
  values ('script', test.task('Explainer script from opp'), '45s Hinglish', 'accepted', '{"fake": true}', test.mid('admin'))$q$) is null,
  'member requests a draft');
select test.ok((select status = 'queued' and output is null and created_by = test.mid('contributor') from marketing_os.ai_drafts limit 1),
  'draft starts queued with no client-supplied output or owner');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.ai_drafts set status = 'accepted'$q$) like '%Only a ready draft%', 'only a ready draft can be accepted');
select test.ok(test.try('authenticated', 'editor', $q$
  update marketing_os.ai_drafts set status = 'running'$q$) is null
  and (select status from marketing_os.ai_drafts limit 1) = 'queued', 'other members cannot touch my draft');
select test.ok(exists (select 1 from marketing_os.audit_events where entity_type = 'ai_drafts' and event_type = 'ai_draft_requested'),
  'draft request is audited');
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', test.uid('editor'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..30 loop
    insert into marketing_os.ai_drafts (kind, created_by) values ('brief', test.mid('editor'));
  end loop;
  reset role;
end $$;
select test.ok(test.try('authenticated', 'editor', $q$
  insert into marketing_os.ai_drafts (kind, created_by) values ('brief', test.mid('editor'))$q$) like '%Daily AI limit%',
  'daily limit of 30 drafts per person');

-- ---------------------------------------------------------------- learnings
select test.ok(test.try('authenticated', 'contributor', $q$
  insert into marketing_os.learnings (title, learning_class, observation, status, created_by)
  values ('Hook length', 'production_process', 'Scripts returned twice for long hooks', 'accepted', test.mid('admin'))$q$) is null,
  'member records a learning');
select test.ok((select status = 'pending_review' and created_by = test.mid('contributor') from marketing_os.learnings where title = 'Hook length'),
  'learnings start pending review');
select test.ok(test.try('authenticated', 'contributor', $q$
  select marketing_os.learning_decide((select id from marketing_os.learnings where title = 'Hook length'), 'accepted', null)$q$)
  like '%Only admins%', 'contributor cannot accept learnings');
select test.ok(test.try('authenticated', 'admin', $q$
  select marketing_os.learning_decide((select id from marketing_os.learnings where title = 'Hook length'), 'accepted', 'Matches workflow data')$q$) is null,
  'admin accepts a learning');
select test.ok(test.try('authenticated', 'contributor', $q$
  update marketing_os.learnings set observation = 'edited' where title = 'Hook length'$q$) like '%has been reviewed%',
  'reviewed learnings are locked for contributors');

select test.ok(test.try('anon', null, $q$select marketing_os.knowledge_search('x')$q$) like 'permission denied%', 'anon cannot search knowledge');

rollback;

\echo 'All intelligence-loop tests passed'
