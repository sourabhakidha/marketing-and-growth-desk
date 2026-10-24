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

## D-016 · Performance Planning deferred
- **Decision:** Performance Planning is not built in this round; it stays visible in the navigation as "later". Everything else from the Bible module list is built.
- **Impact:** No targets/actuals tables yet; Q-14 (performance data sources) stays open.

## D-017 · Calendar
- **Decision:** The Calendar shows task due dates, task publish dates and goal start/end dates. Entries are the records themselves — moving a date in the Calendar changes the task or goal. Tasks gain a `publish_date`; like the due date, only admins change it after creation, and every change is recorded in task history.
- **Load hint:** a day where one person has 3+ open tasks due is marked "load" — a prompt to check, not a capacity calculation.

## D-018 · Content Radar sources and scanning
- **Decision:** Radar collects from (1) news & search feeds (Google News RSS, India edition), (2) official Indian sources (queries restricted to gov.in / nic.in / pib.gov.in), (3) Reddit (r/india, r/AskIndia; needs Reddit app credentials). Scans run when a member presses **Scan now**; there is no schedule and no new secret or service role.
- **Rules:** every signal keeps source, URL, published time (when the source gives one) and collected time; duplicates are removed by URL fingerprint; an evidence class is recorded (public posts = anecdote). Members can also add a link by hand. Admins edit or switch off sources. A source that is not configured or fails shows that status — never "no news".

## D-019 · Content Opportunities
- **Decision:** Anyone can propose an opportunity (from a signal or from scratch) and score it on seven dimensions. Only admins decide (consider / needs research / approve / defer / reject; a reason is required for the last three) and only admins turn an approved opportunity into a task. The first task created marks it Converted; linking a signal marks the signal Converted.

## D-020 · AI Intelligence scope and limits
- **Decision:** AI drafts **briefs and scripts only**. Drafts are proposals: they never change a task, an opportunity or the knowledge base on their own. A person copies a draft, adds it to a task as a comment, marks it used, or discards it.
- **Limit:** 30 drafts per person per day (India calendar day), enforced by the database.
- **Implementation:** OpenAI is called only from a Netlify background function with a server-side key; output must match a fixed JSON schema (hook options, structure, script, on-screen text, CTA, claims requiring review, assumptions, patterns and evidence used). A rule-based check adds review flags for numbers, prices and absolute claims. Model name comes from `OPENAI_MODEL`.

## D-021 · Knowledge base
- **Decision:** AI drafting is grounded in (a) the AI-Ready Brand Guidelines (full working text) and (b) 47 pattern summaries of the Jul–Sep 2026 Scripts Master. Pattern entries carry no prices, savings figures or operational claims and are marked "pattern only — re-verify every claim". Admins can add, edit or switch off entries; references can be added later.

## D-022 · Learning Loop
- **Decision:** Anyone records a learning (observation, period, evidence, interpretation, confidence, limitations, next test, owner, review date, linked records). Admins accept or reject it (reason required to reject). Process insights (wait time before pick-up, stage time, rework) are computed only from recorded workflow timestamps; missing data is shown as "no data", never zero.

## D-023 · Intelligence loop applied to production
- **Decision:** Migrations `intelligence_loop` and `knowledge_seed` applied 2026-10-24.
- **Evidence:** catalog fingerprint of everything outside our schemas identical before and after (2,441 objects at this date; other apps had added objects since D-015). Knowledge content checksum on production equals the local build (48 documents). 9 Radar sources seeded. Rolled-back production check: `anon` denied; contributor can propose an opportunity but cannot decide it or edit the knowledge base; admin decision works; nothing was left behind. All 18 tables have RLS enabled and forced; no grants to `anon`. Advisor: only the accepted "SECURITY DEFINER callable by signed-in users" notice for the action functions (see D-015).

## D-024 · AI provider: Google Gemini (free tier), switchable
- **Decision:** AI drafts run on Google Gemini using an AI Studio API key on the free tier, to avoid paid API costs. OpenAI stays supported; the provider is chosen with `AI_PROVIDER` (`gemini` | `openai`; without it, Gemini is used when `GEMINI_API_KEY` is set). Changes the provider part of D-020; scope, the 30-per-day limit, the fixed output format and review flags are unchanged.
- **Data rule:** on the free tier the provider may use and review what is sent. Requests contain brand guidelines, script patterns, task/opportunity text and public signals only. **Never put customer or patient names, phone numbers or prescriptions into briefs or draft instructions** (warning shown on the draft form).
- **Limits:** free-tier request limits apply; when hit, the draft fails with a "free-tier limit reached" message and can be requested again later.
- **Model:** `GEMINI_MODEL` (default `gemini-2.5-flash` if unset; set the exact ID shown in AI Studio).

## D-025 · Brand palette and typography for the whole platform
- **Decision:** Marketing Desk uses Akidha's brand palette everywhere (supersedes D-005's "brand colours for creative only" and D-014's warm walnut palette; the name "Marketing Desk" from D-014 stands). Primary: purple `#583286`, deep purple `#743186`, teal `#0AA6B5`, mint `#1EC8B9`, white. Support (accents for meaningful distinctions only): cyan `#00ECFF`, coral `#FF5000`, magenta `#FF00E7`, green `#00FF11`. Typeface: Poppins (bundled with the app; Inter/system fallback; Latin + Devanagari).
- **Colour values:** the values above were supplied by the product owner and replace the provisional ones in the AI-Ready Brand Guidelines document (#512A86, #7B3186, #00A6AD, #2EB7A6), which should be updated to match.
- **Accessibility rule:** teal, mint, cyan, coral, magenta and green fail contrast as text on white, so they are used only as fills, borders and accents. Text uses derived ink shades with ≥ 4.5:1 contrast: teal `#08707A`, coral `#B83A00` (blocked / danger), magenta `#A3009A` (changes requested / attention), green `#0B7A1A` (done). Primary actions are solid purple with white text (9.5:1). Status is always written as text; colour is secondary.

## D-026 · Workspace pipeline view
- **Decision:** The Workspace opens on a **Pipeline**: the shared workflow-stage vocabulary (Playbook §8) as connected, numbered nodes with a purple-to-teal progression, task counts, waiting / blocked / in-review counts, and compact cards (title, type, priority, status, next-step owner, due date). Views: Pipeline | Status board | List | Calendar, sharing one set of filters (owner, type, priority, due, goal, status, search, my work). Goals, Activity log and Exports remain.
- **Task panel:** selecting a task opens a side panel with the same content and actions as the task page (brief, deliverable, people, workflow with wait/stage times from recorded timestamps, history, comments, all workflow actions).
- **Drag and drop:** a card can be dropped only on **its own next pending stage**, and only by someone who can hand it off; the drop opens the normal hand-off confirmation (next owner, note). Any other drop is refused with the reason (skip optional stages, return for rework, submit, unblock and approve stay explicit actions in the panel). The database re-checks every action, so the view cannot bypass approvals or business rules.
- **Status vs stage:** kept separate — a blocked task stays in its stage and shows its recorded reason; Done (approved) work sits after the last stage.
- **Not built:** task-to-task dependencies (Q-23).
