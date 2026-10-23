# Decision log

Decisions confirmed by the product owner (Nayan) for Akidha Marketing OS. Each entry: decision, rationale, impact, follow-up. Newest last. Changing a decision means adding a new entry that supersedes the old one, not editing it.

| ID | Date | Status |
|---|---|---|
| D-001 – D-009 | 2026-10-24 | Confirmed (D-006 superseded by D-008) |

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
