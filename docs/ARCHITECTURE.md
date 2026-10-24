# Architecture

Akidha Marketing Desk: internal marketing operations platform (Project Bible v1.0). This document describes what is **built** (Workspace, Calendar, Radar, Opportunities, AI Intelligence, Learning Loop; Performance Planning deferred — D-016) and the agreed target. Anything not built is labelled as such.

## Components

| Layer | Implementation | Status |
|---|---|---|
| Frontend | Vite + React 19 + TypeScript SPA, React Router 7, TanStack Query, Zod; brand palette + Poppins (D-025); Workspace pipeline (D-026) | All modules except Performance Planning built |
| Hosting | Netlify (static `dist/` + Functions), deploy previews per PR | Config in `netlify.toml` |
| Server API | Netlify Functions (TypeScript) under `/api/*` | `/api/health`, `/api/me`, `/api/radar-scan` and `/api/ai-draft` (background, up to 15 min) |
| Database | Supabase Postgres, schema `marketing_os` in the shared "Akidha DB" project | Foundation + Workspace migrations applied; schema exposed |
| Auth | Username + password (Supabase Auth, internal `.invalid` emails), gated by `marketing_os.members` | Built; 4 accounts created |
| AI | Gemini (default) or OpenAI, from the `ai-draft` background function only (D-020, D-024) | Built; needs `GEMINI_API_KEY` |
| Storage | Private bucket `marketing-os` | Phase 1+, not created |
| CI | GitHub Actions: typecheck, unit tests, migration guard, secret scan, build, DB tests | `.github/workflows/ci.yml` |

```
Browser (publishable key + user JWT)
   │  RLS-scoped reads/writes ──────────────► Supabase Data API ─► marketing_os.* (RLS)
   │  sensitive actions (Bearer JWT) ─► Netlify Functions ─► same RLS-scoped client
   │                                         └─► Gemini / OpenAI (server-side key)
```

### Request rules
- The browser only ever holds the **publishable** key and the signed-in user's JWT. `src/lib/config.ts` refuses a service-role key.
- Every server function starts with `requireMember(req, { role? })` (`netlify/lib/auth.ts`): it validates the session with Supabase and the membership row, then queries **as the caller**, so RLS applies on the server too.
- Consequential state changes (approvals, AI-proposal decisions, exports) will be implemented as server functions and/or `security definer` database functions that check the role and write an audit event in the same transaction.
- Errors returned to users never include secrets or stack traces (`netlify/lib/http.ts`).

## Isolation inside the shared Supabase project

The "Akidha DB" project hosts ~30 schemas for other apps and a shared `auth.users`. A read-only inspection on 2026-10-24 found tables in `public` without RLS that `anon`/`authenticated` can read; those belong to other apps and are not changed by this repo (flagged to the owner separately).

1. **Own schema only.** All objects live in `marketing_os`; helpers in `marketing_os_private`. `create schema` without `IF NOT EXISTS` makes the migration fail rather than merge into an existing schema.
2. **Deny by default.** `PUBLIC` and `anon` get nothing (schema, tables or functions). `authenticated` gets explicit per-table grants. Default privileges inside our schemas revoke `PUBLIC` execute on new functions.
3. **RLS enabled and forced on every table.** Every policy requires an active membership (`marketing_os_private.is_member()` / `is_admin()`), so a shared-auth login from another app has no access.
4. **Private helpers.** `security definer` functions with `set search_path = ''`, in a schema that must **not** be added to the Data API's exposed schemas.
5. **Append-only audit log.** `marketing_os.audit_events` is written only by triggers/definer functions; update, delete and truncate are blocked even for the owner.
6. **Service-role key kept off the platform.** It bypasses RLS across every schema in the project, so it is used only by the admin's local `scripts/create-member.mjs` and never set in Netlify (`/api/health` warns if it is). A dedicated least-privilege database role for background jobs (Radar ingestion, Phase 3) will be proposed separately.
7. **Storage isolation (when needed).** A new private bucket with policies matching only that `bucket_id`.
8. **Automated guards.**
   - `scripts/check-migrations.mjs` (CI): rejects references to other schemas, project-wide objects (roles, extensions, publications), grants to `anon`/`public`, missing `ENABLE`/`FORCE ROW LEVEL SECURITY`, and functions without an empty `search_path`.
   - `scripts/test-db.sh` (CI): applies migrations to a throwaway Postgres, **diffs the catalog outside our schemas before/after** (must be identical) and runs the access tests in `supabase/tests/10_rls.test.sql`.
9. **Project-wide settings need separate approval.** Exposing `marketing_os` in the Data API (Settings → API → Exposed schemas) is the one project-level change Phase 0 needs. Disabling public sign-ups would affect other apps and is **not** required: membership gates access regardless.

## Data model

| Table | Purpose |
|---|---|
| `members` | Who can use the app and their role (`admin` / `contributor`). Deactivate, never delete. |
| `vocab_terms` | Controlled vocabularies: task_type, work_origin, task_status, goal_status, priority, workflow_stage, performance_area. |
| `audit_events` | Append-only history: actor, source (user/system/automation/ai_approved), entity, event, old/new values. |
| `goals` | Outcome, owner, timeframe, progress method (checklist / accepted deliverables / manual), target, status. Admin-managed. |
| `tasks` | One unit of work: type, origin, status, priority, owner, reviewer, optional goal (0..1), due date, estimate, brief, completion criteria, deliverable link. `ref` gives the T-number. |
| `workflow_templates`, `workflow_template_stages` | Reusable stage sequences (12 seeded from Playbook §9), default per task type. |
| `task_stages` | The task's own workflow instance: stage owner, state, entered / ready / picked-up / completed times, revision count. One active stage at a time. |
| `task_events` | Append-only task history: hand-offs, pick-ups, returns (with reason), blocks, approvals, reassignment, due-date and priority changes, comments. |
| `task_contributors` | Optional supporting people on a task. |
| `goal_progress` (view) | Progress per goal, computed from its declared method. |
| `radar_sources`, `radar_scans`, `radar_signals` | Radar configuration, scan runs and collected signals (URL, published/collected time, topics, region, evidence class, status). |
| `opportunities`, `opportunity_signals` | Proposed content opportunities, 7-dimension scores, admin decisions; links to supporting signals. Tasks carry `opportunity_id`. |
| `knowledge_documents` | Brand guidelines, script patterns, references (full-text search) used to ground AI drafts. |
| `ai_drafts` | Draft requests and outputs with provenance (model, knowledge and signal IDs, tokens), review flags and decision. |
| `learnings` | Recorded learnings with evidence, confidence, limitations, next test and admin review. |

### Workflow actions (database functions, called via `supabase.rpc`)
`task_pick_up`, `task_hand_off`, `task_skip_stage`, `task_return_for_rework`, `task_set_status` (in progress / blocked / cancelled / reopen), `task_submit_for_approval`, `task_decide` (admin approve or request changes), `task_comment`, `opportunity_decide`, `learning_decide`, `radar_start_scan`, `radar_finish_scan`; `knowledge_search` (invoker rights).
Task status can only change through these functions; each checks membership and permissions and writes a `task_events` row in the same transaction. Direct edits to status, stages or history are rejected by the database.

### Permissions (D-010 – D-012)
| Action | Admin (Sourabh, Tanvi) | Contributor (Nikita, Saail) |
|---|---|---|
| Create task, assign owner at creation | ✓ | ✓ |
| Edit own task details | ✓ | ✓ (owner or creator) |
| Reassign / change due date, priority, template | ✓ | ✗ |
| Pick up, hand off, return, block, submit | ✓ | task owner or current stage owner |
| Approve completion / request changes / reopen | ✓ | ✗ |
| Create / manage goals | ✓ | ✗ (view, link tasks) |

| Decide opportunities, create tasks from them | ✓ | ✗ (propose, score) |
| Edit Radar sources / knowledge base | ✓ | ✗ (view, scan, add signals) |
| Accept / reject learnings | ✓ | ✗ (record) |
| AI drafts | ✓ (30/day) | ✓ (30/day) |

Timestamps are stored as `timestamptz` (UTC) and rendered in Asia/Kolkata.

## Environment variables

See `.env.example`. Browser variables are prefixed `VITE_` and must be public values. `OPENAI_API_KEY` and any future secrets are server-only. `SUPABASE_SERVICE_ROLE_KEY` lives only in the admin's `.env.local`.
