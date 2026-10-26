-- =============================================================================
-- Akidha Marketing Desk — how a task runs: workflow or standalone (D-041)
--   * Goal → Deliverable → Task. A task's own steps (task_stages) now come
--     either from a workflow template (as before) or from an explicit list of
--     steps chosen at creation:
--       - "Use a workflow" with irrelevant steps left out (work can start later
--         in the sequence when earlier work already exists), or
--       - "Standalone task": a single step (e.g. Design) that starts directly.
--   * tasks.initial_stages is read once, at creation; it cannot be changed later
--     (the task's stages, history and timings are the record from then on).
--   * Shorter, plainer step names for the shared step list.
-- Existing tasks and their stages are untouched.
-- Touches ONLY marketing_os / marketing_os_private.
-- =============================================================================

alter table marketing_os.tasks add column initial_stages text[];

create function marketing_os_private.tasks_initial_stages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare code text;
begin
  if tg_op = 'UPDATE' then
    new.initial_stages := old.initial_stages;   -- a creation-time instruction only
    return new;
  end if;
  if new.kind = 'deliverable' then
    new.initial_stages := null;                 -- deliverables have no steps of their own
    return new;
  end if;
  if new.initial_stages is not null then
    if cardinality(new.initial_stages) = 0 then
      raise exception 'Choose at least one step for the task' using errcode = '23514';
    end if;
    if cardinality(new.initial_stages) <> (select count(distinct c) from unnest(new.initial_stages) as u(c)) then
      raise exception 'A step can appear only once' using errcode = '23514';
    end if;
    foreach code in array new.initial_stages loop
      if code = 'completed' then raise exception '"Completed" is not a working step' using errcode = '23514'; end if;
      perform marketing_os_private.assert_vocab('workflow_stage', code, 'Step');
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function marketing_os_private.tasks_initial_stages() from public;
create trigger tasks_initial_stages before insert or update on marketing_os.tasks
  for each row execute function marketing_os_private.tasks_initial_stages();

-- Instantiate the steps: the chosen list when given, else the workflow template
create or replace function marketing_os_private.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare first_stage uuid;
begin
  if new.initial_stages is not null then
    insert into marketing_os.task_stages (task_id, position, stage_code, is_optional)
    select new.id, u.ord::integer, u.code, false
    from unnest(new.initial_stages) with ordinality as u(code, ord);
  else
    insert into marketing_os.task_stages (task_id, position, stage_code, is_optional)
    select new.id, s.position, s.stage_code, s.is_optional
    from marketing_os.workflow_template_stages s
    where s.template_id = new.workflow_template_id;
  end if;

  perform marketing_os_private.task_event(new.id, 'created', null, null, new.owner_id, null, new.status, null);

  if new.status = 'requested' then return null; end if;

  select s.id into first_stage from marketing_os.task_stages s
  where s.task_id = new.id order by s.position limit 1;

  if first_stage is not null then
    update marketing_os.task_stages
       set state = 'active', owner_id = new.owner_id, entered_at = now(), ready_at = now()
     where id = first_stage;
    perform marketing_os_private.task_event(new.id, 'stage_entered', first_stage, null, new.owner_id);
  end if;
  return null;
end;
$$;

-- Plainer step names (codes unchanged, so history and templates are unaffected)
update marketing_os.vocab_terms set label = v.label
from (values
  ('brief_intake', 'Brief'), ('ideation_research', 'Ideation'), ('writing_scripting', 'Writing'),
  ('internal_review', 'Review'), ('revisions', 'Revisions'), ('production_planning', 'Planning'),
  ('asset_creation', 'Design / Production'), ('editing_assembly', 'Editing'), ('final_review', 'Final review'),
  ('approval', 'Approval'), ('scheduling_handoff', 'Publishing')
) as v(code, label)
where marketing_os.vocab_terms.vocabulary = 'workflow_stage' and marketing_os.vocab_terms.code = v.code;
