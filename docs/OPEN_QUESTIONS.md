# Open questions

Items not yet decided. Needed-by = the phase that cannot start without the answer.

| # | Question | Needed by | Source |
|---|---|---|---|
| Q-01 | ~~Team emails / name spelling~~ — resolved by D-008 (username login; "Sourabh"). | — | D-008 |
| Q-02 | ~~Task/goal permissions~~ — resolved by D-010, D-012. | — | D-010, D-012 |
| Q-03 | ~~Which tasks need approval~~ — all tasks (D-011). | — | D-011 |
| Q-04 | ~~Production / Publishing~~ — task types (D-013). | — | D-013 |
| Q-05 | Is a Campaign/Project container needed above goals, or are goals enough initially? | Phase 1 | Playbook §18 |
| Q-06 | Can one task produce multiple assets; when are assets tracked separately? | Phase 1 | Playbook §18 |
| Q-07 | Priority levels and urgency criteria (seeded High/Medium/Low). | Phase 1 | Playbook §18 |
| Q-08 | Which fields are mandatory before work can start? | Phase 1 | Playbook §18 |
| Q-09 | Review stages per task type and who reviews each. | Phase 1 | Playbook §18 |
| Q-10 | Effort: current build takes estimates in hours (stored as minutes); actual active-time tracking is not built. Confirm unit and whether actual time is mandatory. | Phase 1 polish | Playbook §10, §18 |
| Q-11 | Goal progress is computed per the goal's declared method (D-012); "At Risk" is currently set manually by an admin. Should it be calculated (e.g. from due dates and remaining deliverables)? | Phase 2 | Bible §5.3; Playbook §18 |
| Q-12 | Notifications needed (email / WhatsApp / none)? | Phase 1 | Not documented |
| Q-13 | Netlify site name / custom domain; is a separate staging environment wanted? | Deploy | Not documented |
| Q-14 | Performance data sources to integrate (Meta, analytics, manual import). | Phase 2 | Bible §21 |
| Q-15 | ~~Radar source set~~ — resolved by D-018. Open: do we want a scheduled daily scan later (needs a server secret)? | Later | D-018 |
| Q-16 | Scope and limit resolved by D-020 (briefs & scripts, 30/person/day). Provider: Gemini free tier (D-024). **Still open:** whether to move to a paid tier later (no provider review of data, higher limits). | Now | D-020 |
| Q-17 | Retention/deletion policy for audit history, Radar signals and personal data (Radar stores no Reddit usernames). | Open | Bible §18.1, §21 |
| Q-18 | What is the existing `marketing_meta` schema, and does it relate to this app? | Phase 2 | Supabase inspection |
| Q-20 | Should contributors be able to add or edit workflow templates, or admins only (current: admins only, no editing UI yet)? | Phase 1 polish | Bible §15.1 |
| Q-21 | Task-to-multiple-assets: keep one task per asset for now, or add batch size? (Playbook §10 "a batch can be one parent task with a batch size") | Phase 1 polish | Playbook §10 |
| Q-22 | Performance Planning (deferred, D-016): targets, actuals source and cadence. | Later | D-016 |
| Q-19 | Pre-existing exposure: ~21 tables in `public` readable by `anon` without RLS (other apps). Owner to decide whether to fix (outside this repo's scope). | Owner decision | Supabase inspection |
