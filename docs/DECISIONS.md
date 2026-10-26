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

## D-027 · Workspace Flow view (mapping and lags)
- **Decision:** Work stages, task types, workflows and goals are mapped in a **Flow** view inside the Workspace (Pipeline | Status board | List | Calendar | Flow), not a separate module: it reads the same tasks and stages and uses the same filters, so it can be narrowed to one goal, owner or type.
- **Contents:** headline medians (idea → done, task cycle, start wait, hand-off wait, approval wait); an idea-to-execution chain (signals used → opportunities → decided → approved → tasks → started → submitted → done → publish date) with the median lag on every hop; a by-task-type table (default workflow, open/done, cycle, waits, rework rate, slowest stage); a task type × stage matrix (stage time, wait, or working time); a map of each task type to its workflow stages (optional stages marked) and linked goals; and a goals table (task types, where open work sits, median cycle, oldest open).
- **Learning Loop:** Process insights no longer has its own per-stage timing table; it links to Flow and keeps approval outcomes, rework reasons and blockers.
- **Rules:** computed only from recorded timestamps and task history; every figure shows its sample size; missing data is "no data", never zero. After a return for rework a stage's timestamps restart, so stage timings cover the latest pass (rework is counted separately). No schema change.

## D-028 · A stage handed to an admin stays with the admins
- **Decision:** When a contributor (e.g. Saail, Nikita) hands a stage to an admin (Sourabh, Tanvi) — typically Internal Review — the task stays there until an admin decides: **approve** (hand it on to the next stage) or **request revision** (return it for rework). Until then neither the task owner nor earlier stage owners can hand off, skip, submit, return, block or unblock it. Editing details and cancelling keep their existing rules.
- **Enforcement:** database (`can_work_on`, migration `admin_held_stages`) and mirrored in the UI: the task panel shows "With <admin> for <stage>", the Pipeline refuses drags with the reason, and an admin holding a review stage sees "Approve → <next stage>" and "Request revision".
- **Overview:** "Your work awaiting approval" / "Tasks awaiting your approval" now include tasks sitting in a review stage (Internal Review, Final Review, Approval), not only tasks submitted for final approval. Contributors see their own work (owned, created or worked on) in review with someone else; admins see work submitted or held by an admin for review. Review work handed to an admin is listed there instead of under "Waiting for you to pick up".

## D-029 · Date ranges and CSV export in every section
- **Decision:** One shared date picker across Workspace (Pipeline, Status board, List, Calendar, Flow), Goals, Activity log, Exports, Radar, Opportunities, AI drafts and the Learning Loop. Presets: All time, Today, Yesterday, Last 7 / 30 days, This / Last week, This / Last month, This / Last quarter, Custom dates. India calendar dates, weeks start Monday, both ends inclusive. The period is kept in the link (`?range=…&from=…&to=…&on=…`).
- **What the dates apply to:** chosen per section where there is more than one date — tasks: created / open during / approved / due / publishing; goals: active during / created; signals: collected / published; opportunities: created / decided; learnings: recorded / observation period / review date / decided. Radar keeps its previous default of the last 30 days; everything else defaults to all time.
- **Export:** every section has **Export CSV**, which downloads exactly what is shown (filters + period), with the same columns as the Exports page. File names carry the section and period, for example tasks for 12–18 Oct 2026, exported on 25 Oct. The Exports page takes the same period and states which date each file uses. CSV only (Excel opens it); no Excel library.
- **Row limit fixed:** Supabase returns at most 1,000 rows per request; full exports, the Activity log, Flow and other lists now fetch page by page, so older records are no longer silently cut off.
- **Retention:** nothing in Marketing Desk is deleted (no delete paths for records; task history and the audit log are append-only), so any past period can be viewed or exported again.

## D-030 · Business impact layer for tasks and goals, and the Impact Brief
- **Tasks:** a new **Expected business impact** section, separate from Brief / Context and Completion criteria: intended business outcome, rationale, target audience / channel, success metrics, evidence level (hypothesis, historical evidence, committed target), plus optional dependencies and risks. **Mandatory when an admin creates or reassigns a task** (enforced in the database); contributors may fill it in but are not forced. Once given it can be revised but not emptied. Tasks can still stand alone without a goal.
- **Goals:** **Expected business outcome, Business rationale and Success measures are mandatory** on create (database-enforced; existing goals are asked for them when next edited). Optional importance (critical / high / medium / low). Target type: measurable (metric, unit, baseline, target — target required) or qualitative. A separate **actual outcome** record (status, actual value, evidence) stores who recorded it and when. Goal cards show **task completion** (existing progress method) and **business outcome** as two separate bars; task completion never marks an outcome achieved.
- **Roll-ups and flags (computed, no AI):** per goal — open/done work, open effort, expected-impact mix of linked tasks, risks and dependencies from linked tasks, and flags for: no outcome defined, no supporting work, important outcome without work, thin support, overloaded (≥ 8 open tasks or ≥ 40 open estimated hours), unclear contributors, tasks without an impact case, blocked work, past end date, all tasks done but outcome not recorded as achieved.
- **AI assessments (proposals only):** "Assess with AI" on tasks (expected impact, strategic alignment, evidence strength, goal contribution, missing information, risks, recommended action) and goals (strategic importance, clarity, measurability, feasibility, expected impact, supporting work, per-task contribution, gaps, risks, actions). Every rating carries its reasoning; unknown ratings fall back to "unclear"; the model is told to use only supplied facts, never invent targets, and never present predictions as results; replies citing tasks that were not supplied are dropped. Stored in `impact_assessments` with model and time; 60 per person per day; they never change a task or goal. Runs on the existing AI provider (D-024) via `/api/impact-assess`.
- **Impact Brief (new section):** Daily / Weekly / Monthly (or any period): highest expected-impact tasks and goals with reasons, business outcomes vs task completion, capacity by objective and by person, low-impact or poorly justified work, neglected goals, blockers, risks, and rule-based recommended actions for admins; optional AI brief that narrates the same figures. CSV export.
- **Exports:** task and goal CSVs include the impact and outcome fields.

## D-031 · Visual redesign and top navigation
- **Decision:** The left sidebar is replaced by a sticky top navigation bar (modules inline, overflow into "More", account menu with Team, Vocabularies, Account, Sign out; a full-width menu sheet on phones). Primary purple stays exactly #583286 with white surfaces and a subtle purple-to-white page gradient; #743186 is used sparingly for depth; teal / mint only as accents. Text contrast rules from D-025 are unchanged. Restyle only — no features, routes or data access changed.

## D-032 · Admin-held stages and business impact applied to production
- **Decision:** Migrations `admin_held_stages` (D-028) and `business_impact` (D-030) applied to "Akidha DB" on 2026-10-25 with the product owner's approval, before the matching frontend is deployed.
- **Evidence:** catalog fingerprint of everything outside `marketing_os` / `marketing_os_private` identical before and after (2,345 objects). Rolled-back production check as real members: admin task without impact refused; admin task with impact created; goal without outcome refused; goal with outcome created; AI assessment queued with the requester recorded; contributor pick-up still works. Nothing left behind. `impact_assessments` has RLS enabled and forced; `anon` cannot read it. Advisor: only the accepted "SECURITY DEFINER callable by signed-in users" notice (D-015), no new findings.
- **Known gap until deploy:** on the currently deployed site (old screens), admins cannot create or reassign tasks and nobody can create goals, because those screens lack the now-required fields. Contributors and all other features are unaffected. Deploying this version closes the gap.
- **Correction (2026-10-25):** palette limited to the four Akidha colours (#583286, #743186, #0AA6B5, #1EC8B9) and white; neutrals are light tints of #583286, and #743186 is the hover/pressed shade of primary buttons. Only very light purple-to-teal fades into white remain (page top, top-bar hairline, popup header); dark or saturated gradients were replaced by solid brand colour. The invented logo mark and favicon were removed; the brand is a text-only wordmark ("Akidha Marketing Desk") until the official logo is supplied. Status colours stay as decided in D-025.

## D-033 · Contributors request tasks; admins accept or decline
- **Decision:** A task created by a contributor (Nikita, Saail) is a **request** (status "Requested"). Its workflow does not start: no stage is active and no workflow action runs. An admin (Sourabh, Tanvi) **accepts** it — choosing the owner and having completed the expected business impact (D-030) — which starts the first stage, or **declines** it with a required reason (it becomes Cancelled). The requester can edit or withdraw a request. Admin-created tasks start immediately as before. Supersedes the contributor part of D-010.
- **Enforcement:** database (`tasks_request_gate`, `can_work_on`, `task_review_request`); events `request_accepted` / `request_declined` record who decided and why.
- **UI:** contributors see "+ Request task" and "Send request"; admins get "Task requests to review" on the Overview and Accept / Decline in the task panel; requests appear in a "Requested" column at the start of the Pipeline and are not counted as open work in the Impact Brief.

## D-034 · Team / Me view switch; visibility unchanged
- **Decision:** Everyone keeps seeing all work (no access change). A **Team / Me** switch in the top bar, for admins and contributors alike, narrows every section to the signed-in person's own work: tasks they own, created or requested, review, or hold / held a stage of; goals they own or work on; their own signals, opportunities, learnings, drafts and activity. Applies to the Overview, Workspace views (Pipeline, Board, List, Calendar, Flow), Goals, Activity log, Radar, Opportunities, AI drafts, Learning Loop, Impact Brief and exports (file names get "-mine"). Remembered per browser. Replaces the "My work" checkbox and "Only my drafts".
- **Applied to production (2026-10-25):** migration `task_requests` on "Akidha DB" with the product owner's approval. Catalog fingerprint outside our schemas unchanged (2,345 objects); `anon` cannot run `task_review_request`. Rolled-back check as Nikita and Tanvi: contributor task becomes a request with no active stage; pick-up and contributor acceptance refused; acceptance requires the impact case, then starts the first stage; decline cancels with the reason; admin-created tasks start directly. Nothing left behind. Until this version is deployed, contributor tasks created on the old live site wait as requests.

## D-035 · Recycle Bin: delete and delete permanently (admins only)
- **Decision:** Nothing is ever deleted from the database. Sourabh and Tanvi can **Delete** a task (task panel) or a goal (goal card) with a reason: it moves to the **Recycle Bin** (Workspace → Recycle Bin, admins only) and disappears from every desk view, export and count. From the Bin they can **Restore** it, or **Delete permanently** (typing its T-n / G-n to confirm), which removes it from Marketing Desk entirely — not shown anywhere, not restorable from the desk — while the row, its history and the audit log stay in the database. Contributors cannot delete, restore or purge (they can withdraw their own requests, D-033). A deleted goal's tasks stay on the desk.
- **Enforcement:** columns `removed_at/by/reason`, `purged_at/by` on tasks and goals, changeable only through `task_/goal_ remove / restore / purge` (admin check, reason required, purge only from the Bin); no workflow action runs on a task in the Bin; goal progress counts only tasks on the desk.

## D-036 · Look: fresh lavender-to-white background, neutral hairlines
- **Decision:** The page background is a fresh, light lavender (#583286 family, very light) fading into white. Every box, card and table is white with a single thin neutral border (no purple or coloured linings, no accent strips); shadows are neutral and soft. Colour is kept for meaning only (primary buttons, active tabs, status chips, data). Supersedes the purple-to-teal tint tried earlier the same day.
- **Applied to production (2026-10-25):** migrations `recycle_bin` and `bin_blocks_actions` on "Akidha DB" with the product owner's approval. Additive only (new columns, functions, guard triggers; goal progress view recreated to skip binned tasks). Catalog fingerprint outside our schemas unchanged (2,345 objects); `anon` cannot run the bin functions. Rolled-back check as Saail and Sourabh: contributor cannot delete and cannot set the bin columns directly; admin deletes to the Bin (who/why recorded), no workflow action or comment runs on a binned task even for admins, restore works, delete-permanently keeps the row and cannot be restored from the desk, goals delete/restore. Nothing left behind.

## D-037 · Passwords set by admins for contributors
- **Decision (2026-10-26):** At the product owner's request, new passwords were set for all four accounts (agreed privately; not recorded here). Contributors (Nikita, Saail) cannot change their own password in the app — the Account page tells them to ask an admin. Admins (Sourabh, Tanvi) can change theirs, and should replace the initial one soon. Set directly on the four Marketing Desk login accounts (bcrypt, as Supabase Auth stores them); each verified by signing in.
- **Known limit:** the "contributors cannot change" rule is enforced in the app only — Supabase Auth has no per-user switch to stop a signed-in user from changing their own password through its API. Supersedes the "personal random password" part of D-008.

## D-038 · Deliverables with parts, and the journey view
- **Decision:** A task is either a normal task or a **deliverable** — an umbrella for what the business gets (e.g. "Marathi video for Meta ads"). A normal task can be a **part** of one deliverable (one level only). Parts keep their own owner, workflow, hand-offs and review; the deliverable has no workflow of its own.
- **Importance flows down, status rolls up:** the deliverable carries the business impact (parts inherit it — not required on parts), goal and deadline (publish date, else due date). Its progress, risk (blocked / at risk / on track, with reasons: blocked, overdue, due after the deliverable's date, date passed, awaiting acceptance) and next step come from its parts. It can be approved only when every part is done or cancelled (database-enforced). Goal progress counts a part through its deliverable when both serve the same goal (no double counting); workload counts parts, not deliverables.
- **Approvals:** parts get a one-click **Sign off** by an admin; the deliverable gets the full approval.
- **Requests:** contributors can request both deliverables and parts (D-033 applies).
- **Grouping:** admins can group existing tasks under a deliverable; only admins move tasks into or out of one after creation.
- **Views:** Workspace → **Deliverables** (cards with progress, risk, reasons, next part); on a deliverable, the **journey** (a timeline row per part from recorded stage times — waiting vs working, rework, part due dates, the deliverable date, today); on a part, a **Part of** strip with its siblings; Pipeline cards show "↳ deliverable"; Overview shows **Deliverables at risk**.
- **Next stages (not built yet):** order between parts with a critical path, and deliverable templates.

## D-039 · Channel list for tasks and goals
- **Decision:** Channel is a dropdown for tasks and goals: Social media, Meta ads, BTL, WhatsApp, App, Packaging, Reporting, Other (vocabulary `channel`, database-checked). Existing free-text values were mapped (Meta ad → Meta ads, Offline → BTL, other values → Other). Tasks can be filtered by channel; exports show the channel name.
- **Applied to production (2026-10-26):** migration `deliverables_and_channels` on "Akidha DB" with the product owner's approval. Catalog fingerprint outside our schemas unchanged (2,345 objects). Existing channels converted: 2 Meta ads, 1 BTL, 2 Other (3 empty). Rolled-back check as Tanvi and Nikita: a deliverable gets no workflow; an admin adds a part without its own impact case; a contributor's part becomes a request and cannot be regrouped by them; accepting the part needs no own impact case; a deliverable with open parts cannot be approved; channels outside the list are refused. Nothing left behind.

## D-040 · Simpler Workspace and navigation
- **Decision:** The Workspace has three views of the same work — **Board**, **Table**, **Timeline** — replacing Pipeline, Deliverables, Status board, List, Calendar (in Workspace) and Flow (supersedes the view parts of D-026 and D-038).
  - **Board:** five plain phases (Requested → To do → In progress → In review → Done); the workflow stage is a chip on the card ("Writing / Scripting · 2/5"); blocked, changes requested, waiting pick-up and rework are flags. "In review" includes work with an admin in a review stage. Drag-and-drop hand-off is retired; actions stay in the task panel.
  - **Table:** sortable; group rows collapse; admins get bulk actions (assign, due date, move into a deliverable, delete to the Bin) — each change goes through the same rules as a single edit.
  - **Timeline:** a bar per task from creation to due date, filled with stage progress; publish dates, overdue and today marked; a **Month** toggle shows the classic calendar.
  - **Group by** (Deliverable / Owner / Goal / Channel / Type) is shared by all three; grouping by deliverable shows each deliverable's status and progress in its band.
  - **One compact filter bar:** search, a Filters popover (owner, type, channel, priority, due, goal, status, period) with removable tags, saved views (Due this week, Overdue, Blocked, Awaiting approval, Requests) and Export of what is shown.
- **Task panel** in tabs: Overview, Workflow (Journey for deliverables), Impact & AI, History.
- **Overview = "My day":** only the "needs you" cards that have something in them (or "All clear"), then the Board; tasks open in the side panel in place.
- **Navigation:** Overview · Workspace · Goals · Ideas (Radar + Opportunities) · AI · Insights (Impact Brief, Flow, Learnings, Process, Activity, Exports). Recycle Bin is in the account menu (admins). Old links redirect to their new homes.

## D-041 · Goal → Deliverable → Task, and how a task runs
- **Hierarchy:** a **goal** (business outcome) contains **deliverables** (concrete outputs, e.g. "5 Marathi video scripts"), which contain **tasks** (ideation, writing, design, editing…). Stored as before: a deliverable's goal link, a task's deliverable (parent) link — no data was moved. Existing tasks outside a deliverable remain, shown as "Tasks not in a deliverable" (or under their goal when linked directly).
- **Progress rolls up:** deliverable = done tasks ÷ tasks (cancelled excluded; an approved deliverable is 100%); goal = average of its deliverables, shown with "x of y deliverables done". Labelled as work progress — never proof that the business outcome was achieved (that stays the goal's recorded outcome, D-030).
- **How a task runs (chosen at creation):** **Use a workflow** — pick a workflow (default for the type of work) and untick steps that aren't needed, so work can start later in the sequence; or **Standalone task** — a single step (e.g. Design) that starts right away. Stored as the task's own steps (`initial_stages`, read once at creation; database-checked). Steps can still be skipped later from the task.
- **Workspace:** header with date range and **+ Create new** (Goal · Deliverable · Task; contributors request deliverables and tasks). Tabs: **Goals** (default; goal cards with their deliverables — each deliverable expands into columns for the steps its tasks actually run, then Done), **Deliverables**, **Tasks** (board), **Calendar** (month, with a Timeline toggle), **List** (table). One toolbar: search, owner, type, priority, status, More (channel, due, goal, deliverable), Clear, Group by / Export. Goal records with outcome, impact assessment and history open via "View details".
- **Plain language:** reference numbers (T-12, G-3, O-5, D-, L-, S-) are no longer shown; titles are used everywhere (numbers still work in search and exports). Shorter step names (Brief, Ideation, Writing, Review, Revisions, Planning, Design / Production, Editing, Final review, Approval, Publishing). Deleting permanently is confirmed by typing DELETE.
- **Forms:** separate Deliverable and Task forms, in sections (what, how it runs, who and when, details, business impact). A deliverable's business impact starts from its goal's outcome; a task in a deliverable inherits the deliverable's.
- Supersedes the view parts of D-038 and D-040 (Board / Table / Timeline remain as the Tasks, List and Calendar tabs).
- **Applied to production (2026-10-26):** migration `task_steps` on "Akidha DB" with the product owner's approval. Objects outside our schemas unchanged (2,345). Rolled-back check as Sourabh and Saail: a standalone task gets exactly its one step and starts there; a workflow can leave out earlier steps; tasks created without a step list still use their template (6 steps for Script or copy); unknown steps are refused; a contributor's standalone task is a request with no active step; step names updated. Nothing left behind.

## D-042 · Incident: edits failed with "permission denied" after the Recycle Bin update
- **What happened:** from the `recycle_bin` migration (2026-10-25) until this fix (2026-10-26), saving a direct edit to a task or goal (Edit details, goal edits, calendar date moves, bulk assign, grouping into a deliverable, recording a goal's outcome) failed for everyone with "permission denied for function in_bin_action", shown in the app as "You do not have permission to view this". The Recycle Bin guard ran with the caller's rights and called a helper signed-in users may not execute. Workflow actions (pick up, hand off, submit, approve…) and the bin actions were unaffected, because they run with the owner's rights. No data was changed or lost; the failed saves were refused.
- **Fix:** migration `fix_bin_guard_permission` makes the guard run with the owner's rights, like every other check. Verified on production with a rolled-back test (admin and contributor edits, goal edit, bin columns still guarded, delete/restore, pick-up). A check of every remaining caller-rights trigger in our schemas found none calling a restricted helper. A regression test was added; earlier rolled-back checks had covered actions but not plain edits, which is how this was missed.

## D-043 · Audit: forms, status rules and wording made consistent
- **Trigger:** "Business impact: add the intended business outcome" appeared on a task form where the impact fields were hidden (the task was inside a deliverable, which supplies the impact). A full audit followed so issues stop being found one at a time.
- **Forms:** the impact fields show exactly when they are required: an admin creating or reassigning top-level work, or taking a task out of a deliverable (it no longer inherits an impact case; the database enforces the same rule). A task created inside a deliverable stores no impact of its own. Saving a workflow task no longer races the workflow list: when every step is kept, the database runs the workflow as defined (optional steps stay optional); a step list is sent only when steps were left out. Deliverables get an "Output link" field when edited.
- **Status rules (database and app):** a pending request can only be withdrawn until an admin accepts or declines it; only admins reopen cancelled work; a request that was never accepted cannot be reopened. Work in the Recycle Bin shows no actions and takes no comments. A deliverable's Approve is disabled, with the reason, while its tasks are open. Requested, closed or binned deliverables take no new tasks.
- **Filters and views:** a task inside a deliverable matches its deliverable's goal. Choosing All or Cancelled status shows cancelled deliverables (never counted toward goal progress). Links to a goal scroll to it. Overview "more" links open the matching filtered list.
- **Bulk edit:** each change (owner, due date, deliverable) has its own Apply. Rows that fail stay selected and are listed by title with the reason.
- **Wording:** no reference numbers (T-, G-, D-, O-) in the interface, including the AI brief, which now shows titles. CSV exports keep them for record-keeping. "Parts" is now "tasks". The panel says "deliverable" for deliverables. History shows accepted and declined requests. The permission message reads "You do not have permission to do this".
- **Verification:** unit tests (136); new database tests for the status and impact rules; a browser run as an admin and a contributor across 22 pages and every create/edit flow, with all database writes blocked: no findings.

## D-044 · Workspace Overview tab; goals in primary purple
- **Why:** goal cards blended into the light page, and there was no single place in the Workspace to see how the work is doing.
- **Goal cards:** solid primary purple (#583286) with white text and a mint progress bar. The business-impact panel stays white so it reads as a separate note. Deliverables and tasks below stay white, so each goal clearly heads its own group.
- **Overview tab (Workspace landing page; Goals moves to /workspace/goals):** built only from recorded goals, deliverables and tasks, following the date range and the Team/Me switch.
  - **Summary:** active goals (and how many need attention), deliverables done and at risk, open/overdue/blocked tasks, items awaiting a decision, approvals and on-time rate in the period, and the median time from creation to approval.
  - **Goals, deliverables and tasks:** a tree of goal → deliverable, with each deliverable's task mix by status (labelled legend; counts in text). Work not linked to a goal is listed separately.
  - **Insights:** plain sentences about goals with no work, goals past their end date, blocked work, deliverables at risk, handovers waiting 2+ days, uneven load, old requests, unlinked work and the on-time rate.
  - **Stuck, and what it holds up:** each blocked, overdue or waiting task traced to the deliverable and goal it holds up.
  - **Work approved per week:** the last 8 Monday-to-Sunday weeks.
  - **People:** open work counted with whoever holds the current step, plus overdue, blocked, in review, approved and on-time rate.
- Progress is shown as work done, never as proof a business outcome was achieved.
- Also fixed: the top bar no longer pushes the page sideways on phones.

## D-045 · Workflow belongs to the deliverable; a journey page for each deliverable
- **Why:** the choice between a workflow and a standalone piece of work belongs to a deliverable, not to a task. A deliverable is either made by one person, or produced through a sequence of tasks by different people. For each deliverable we want to see the whole journey: how many tasks, who did them, when, how long each took, where time was lost and where things went well.
- **Tasks:** the "Use a workflow / Standalone task" choice is removed from task creation. A new task is one piece of work by one person: one **Step** (Writing, Design, Review…), which defaults from the type of work. Existing multi-step tasks keep working unchanged.
- **Deliverables:** a new "How it will be produced" section:
  - **Standalone:** the owner does it and sends it for approval.
  - **Workflow:** pick a workflow, then for each step tick it, choose who does it and set a due date. Each ticked step becomes a task in the deliverable, created with it. The tasks take the deliverable's channel and priority, and its business impact.
  - A contributor's workflow request creates the deliverable and its tasks as requests. Accepting the deliverable can accept them too, each keeping its own owner.
  - No database change: the tasks carry the steps, and a deliverable with no tasks is standalone.
- **Journey page** (`/workspace/deliverables/<n>`, linked from deliverable cards, the panel and the Overview):
  - The verdict: early, on time, late, or days left.
  - Summary figures: tasks done, people, elapsed time, working/waiting/review time, on-time tasks, rework.
  - **How it flowed:** a flow diagram with steps as columns. Each task card shows the person, dates and status. The arrows show the time from one step finishing to the next being picked up.
  - **Timeline by person:** swimlanes showing waiting, working and review segments, due dates, the deliverable's date and today.
  - **Where the time went:** working, waiting, review and blocked.
  - **Who did what:** a per-person table.
  - **What went well / Where we lost time:** early or late approvals, quick or slow pick-ups, long reviews, rework, blocked time, overlapping steps.
  - **Activity, step by step:** the full log.
- **Measurement rules:** everything is measured from recorded steps and history; nothing is estimated. In a workflow every task exists from the start, so a step's waiting time is counted from when the previous step finished (or from its hand-over, if later). Review time runs from each submission to the decision on it. Lateness is by India calendar date.

## D-046 · Daily Ops: plan the workday, punch in/out on tasks, private performance for admins
- **Why:** contributors and admins plan their workday and record time on tasks. Admins need a private view of working hours, output, workload, delays and trends for the people they manage, with downloadable logs.
- **Where:** a new top-level section, **Daily Ops**, between Overview and Workspace (`/ops`).
- **My day (everyone):**
  - A week strip and a day calendar showing **Plan** and **Actual** side by side.
  - Set working hours; plan blocks (a task, or another activity) inside them; check in and out.
  - Punch in on a task, from a planned block or any open task, and punch out with an optional note. Switching tasks ends the previous session automatically.
  - Every timestamp comes from the server.
- **Team plans (admins):** see and change the day of the people you may see. Your changes appear as **suggestions** until the person accepts them.
- **Performance (admins, private):**
  - **Per person:** days worked, hours worked (check-in to check-out), time on tasks, tasks approved and approvals per 8 hours, late approvals, late starts, plan kept, and open/overdue workload.
  - **Baseline:** productivity and hours are compared with the person's own usual level, the 28 days before the period.
  - **For one person:** daily trends of hours and approvals, plus a list of delays.
- **Log (admins, private):** every recorded workday with each task session (in/out, minutes, notes). Two CSV downloads, daily summary and task sessions, for today, a week, a month or a custom range, for everyone or one person.
- **Access, enforced in the database** (`can_view_ops`, row-level security; the tables are read-only to the app and every write goes through checked functions):
  - Everyone sees and plans only their own day.
  - Both admins see every contributor.
  - Admin-to-admin access is granted row by row in `ops_viewers`; seeded: Sourabh may see Tanvi, and Tanvi may not see Sourabh.
  - Contributors never see Team plans, Performance or Log.
  - No admin sees their own figures in Performance.
- **Rules:**
  - Blocks must fit inside the working hours and not overlap.
  - Past days cannot be re-planned; they are the record.
  - Only one task session can be open at a time.
  - A session left open overnight is closed at that day's check-out, or at midnight, and marked "closed automatically".
  - A day without a check-out has no worked hours and is flagged.
  - Nothing is deleted; a removed plan block is marked removed.
- **Applied to production (2026-10-26)** as migration `daily_ops`:
  - First run in full, with access checks as the real members, inside a rolled-back transaction; all 13 checks behaved as designed.
  - Catalog fingerprint outside our schemas unchanged (2,345 objects).
  - Signed-out visitors cannot read or call anything; the app cannot write the tables directly.
- **Calendar:** the day planner is the calendar for planned work. Task due and publish dates stay on the Workspace calendar.
