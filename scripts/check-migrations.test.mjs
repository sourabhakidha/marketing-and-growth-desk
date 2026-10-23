import { describe, expect, it } from "vitest";
import { findViolations } from "./check-migrations.mjs";

const ok = `
create table marketing_os.things (id uuid primary key);
alter table marketing_os.things enable row level security;
alter table marketing_os.things force row level security;
create function marketing_os_private.f() returns uuid language sql set search_path = '' as $$ select auth.uid() $$;`;

describe("migration guard", () => {
  it("accepts schema-local changes", () => expect(findViolations(ok)).toEqual([]));
  it("rejects changes to other schemas", () => {
    expect(findViolations("alter table public.orders add column x int;").join()).toMatch(/public\.orders/);
    expect(findViolations("grant select on all tables in schema crm to authenticated;").join()).toMatch(/crm|another schema/);
  });
  it("rejects project-wide objects and unsafe grants", () => {
    expect(findViolations("create role app_user;").join()).toMatch(/project-wide/);
    expect(findViolations("alter default privileges grant select on tables to authenticated;").join()).toMatch(/DEFAULT PRIVILEGES/);
    expect(findViolations("grant select on marketing_os.things to anon;").join()).toMatch(/anon/);
  });
  it("requires RLS enabled and forced on new tables", () => {
    const problems = findViolations("create table marketing_os.x (id int);").join();
    expect(problems).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(problems).toMatch(/FORCE ROW LEVEL SECURITY/);
  });
  it("rejects functions without an empty search_path", () => {
    expect(findViolations("create function marketing_os.f() returns int language sql set search_path = public as $$ select 1 $$;").join())
      .toMatch(/search_path/);
  });
  it("ignores comments and string literals", () => {
    expect(findViolations(ok + "\n-- public.orders\n select 'crm.leads';")).toEqual([]);
  });
});

describe("migration guard aliases", () => {
  it("allows table aliases and row variables but still flags other schemas", () => {
    const sql = `create function marketing_os.f(p uuid) returns void language plpgsql set search_path = '' as $$
      declare t marketing_os.tasks;
      begin
        select * into t from marketing_os.tasks where id = p;
        update marketing_os.task_stages s set state = 'done' where s.task_id = t.id;
        perform 1 from public.orders o where o.id = t.id;
      end $$;`;
    const problems = findViolations(sql).join();
    expect(problems).toMatch(/public\.orders/);
    expect(problems).not.toMatch(/references (t\.id|s\.task_id)/);
  });
});
