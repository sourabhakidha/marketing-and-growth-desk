# Decision log

Decisions confirmed by the product owner (Nayan) for Akidha Marketing Desk (formerly "Marketing OS"). Each entry: decision, rationale, impact, follow-up. Newest last. Changing a decision means adding a new entry that supersedes the old one, not editing it.

| ID | Date | Status |
|---|---|---|
| D-001 – D-015 | 2026-10-24 | Confirmed (D-006 superseded by D-008; D-005 palette refined by D-014) |

## D-001 · Repository
- **Decision:** `marketing-and-growth-desk` (GitHub `sourabhakidha/marketing-and-growth-desk`) is the repository for the platform.
- **Impact:** All code, migrations and docs live here. The source documents (Project Bible, Playbook, brand guidelines) remain in the Claude "Marketing Desk" project; see `docs/source/README.md`.

## D-002 · Stack
- **Decision:** Vite + React + TypeScript SPA; Netlify hosting and Netlify Functions for server-side work; Supabase (Postgres + Auth) in the existing "Akidha DB" project; OpenAI API called only from server functions; GitHub for version control and CI.
- **Rationale:** Product owner delegated the frontend choice ("whatever suits best"). An SPA plus a small serverless API keeps the deploy simple, and all secrets stay server-side.

## D-003 · Database isolation
- **Decision:** Dedicated schema `marketing_os` (+ non-exposed `marketing_os_private`) in the shared Supabase project, using the deny-by-default model in `docs/ARCHITECTURE.md` §Isolation.
- **Impact:** No changes to any other schema, role, bucket or project setting without a separate, explicit approval. Enforced by `scripts/check-migrations.mjs` and the catalog-diff check in `scripts/test-db.sh`.

## D-004 · Conflicting vocabularies between Project Bible v1.0 and the Playbook
- **Decision:** Conflicts accepted by the product owner; where the two documents differ, the **Team Roles, Work Types, Goals & Workflow Playbook** values are used as the initial seed:
  - Task types: 8, including **AI Video Generation**.
  - Task statuses: Not Started, In Progress, In Review, Changes Requested, Blocked, Done, Cancelled.
  - Work origins: Planned, BAU / Recurring, Ad Hoc, Trend / News / Industry Moment, AI Suggested (approved).
  - Goal statuses: Not Started, On Track, At Risk, Achieved, Not Achieved, Cancelled.
- **Rationale:** The Playbook was issued after the Bible, is more specific on these topics, and its list is a superset where they differ (AI Video Generation, Trend/News).
- **Impact:** Bible §20 acceptance criterion "Task types dropdown has exactly seven types" is superseded: the list has eight. All vocabularies are rows in `marketing_os.vocab_terms`, so admins can change them later without code changes.
- **Follow-up:** If a Bible value should win for any list, record a new decision and update the seed via a new migration.

## D-005 · Platform UI palette
- **Decision:** The internal platform uses the Bible §16.1 direction (forest green, warm parchment, saffron). Akidha brand purple/teal remains the palette for customer-facing creative.
- **Rationale:** Conflict accepted; the Bible addresses the platform UI specifically, the brand guidelines address customer-facing material.

## D-006 · Authentication (superseded by D-008)
- **Decision:** Email + password, with a **unique password per person**. Accounts are created by an admin with `npm run member:create`, which generates a unique random temporary password shown once; the person changes it under Account.
- **Constraints:** Supabase Auth is shared by other Akidha apps. A person who already has an account there keeps their existing password (the script never changes it). Having a login grants nothing in Marketing OS without an active row in `marketing_os.members`.
- **Follow-up:** Team emails needed to create accounts (see `docs/OPEN_QUESTIONS.md`).

## D-007 · Roles
- **Decision:** Two app roles: `admin` (Sourabh, Tanvi) and `contributor` (Nikita, Saail). Only admins manage members and vocabularies; task-completion approval by admins will be enforced server-side in Phase 1.

## D-008 · Username + password login, no email logins
- **Decision:** Each person signs in with a **username and their own unique password**; no email is used or shown. Accounts: `sourabh` (admin), `tanvi` (admin), `nikita` (contributor), `saail` (contributor). Name spelling confirmed as **Sourabh**.
- **How:** Supabase Auth requires an email internally, so each username maps to a non-deliverable address `<username>@marketing-os.invalid` (reserved `.invalid` domain). No emails are ever sent; password reset is done by an admin, not by email.
- **Impact:** Supersedes D-006. `marketing_os.members` has a `username` column. Forgotten passwords: an admin issues a new one (`npm run member:create -- --username <u> --reset-password`).

## D-009 · Phase 0 applied to production
- **Decision:** Migration `marketing_os_foundation` applied to "Akidha DB" on 2026-10-24 with the product owner's approval; four accounts created.
- **Evidence:** Catalog fingerprint of everything outside `marketing_os`/`marketing_os_private` identical before and after (1,729 objects). RLS checks on production: contributor sees team but is not admin; admin is admin; a non-member sees 0 rows; `anon` has no schema access. Security Advisor: no findings for `marketing_os`.

## D-010 · Who creates and assigns tasks
- **Decision:** Every member can create a task and assign it to anyone. After creation, only admins (Sourabh, Tanvi) can reassign a task or change its due date, priority or workflow template. Owners and creators update the other details of their own tasks.
- **Enforcement:** database trigger + RLS (not only the UI); every reassignment / due-date / priority change is recorded in task history with the actor.
- **Resolves:** Q-02 (task part).

## D-011 · Completion approval
- **Decision:** All tasks need admin approval to become Done. The owner (or current stage owner) submits for approval; an admin approves or requests changes with feedback. Contributors cannot mark Done or reopen an approved task.
- **Resolves:** Q-03.

## D-012 · Goals
- **Decision:** Only admins create and manage goals; contributors see goals and link their tasks to them. Each goal declares a progress method: linked-task checklist, accepted-deliverable count (needs a target, counts only approved tasks marked as deliverables), or manually verified.
- **Resolves:** Q-02 (goal part).

## D-013 · Production/Shoot and Publishing/Scheduling are task types
- **Decision:** Added task types "Production / Shoot" and "Publishing / Scheduling" (10 task types in total), each with its own default workflow.
- **Resolves:** Q-04. Supersedes the 8-type list in D-004 for this point.

## D-014 · Name and visual direction
- **Decision:** The product is called **Akidha Marketing Desk** in the UI and documents. The palette is warm and sober: walnut/umber on warm paper, with muted sage, ochre and brick for states (refines D-005).
- **Impact:** The database schema keeps its technical name `marketing_os` (renaming it would require changing the exposed-schema setting and every query for no user benefit).

## D-015 · Workspace (Phase 1) applied to production
- **Decision:** Migration `workspace` applied 2026-10-24: goals, tasks, workflow templates (12), per-task stages, append-only task events, and workflow actions (pick up, hand off, skip, return for rework, block/unblock, cancel/reopen, submit, approve / request changes, comment).
- **Evidence:** 83 local database tests pass (access + business rules). Catalog fingerprint outside our schemas unchanged (1,729 objects). On production, a rolled-back end-to-end run (contributor creates → picks up → hands off → submits; admin approves) produced the expected statuses and 10 history events; nothing was left behind. `anon` can execute nothing and read nothing.
- **Advisor note (accepted):** Supabase flags the workflow-action functions as "SECURITY DEFINER callable by signed-in users". This is intentional — they are the only path for status/stage changes and each checks membership and permissions itself; the private helper functions are not exposed through the Data API.
