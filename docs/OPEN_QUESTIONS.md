# Open questions

Items not yet decided. Needed-by = the phase that cannot start without the answer.

| # | Question | Needed by | Source |
|---|---|---|---|
| Q-01 | ~~Team emails / name spelling~~ — resolved by D-008 (username login; "Sourabh"). | — | D-008 |
| Q-02 | Who can create/assign tasks, set priorities and change deadlines? Can contributors create draft goals? | Phase 1 | Bible §15.1, §21; Playbook §18 |
| Q-03 | Which task types require admin completion approval — all, or selected types? | Phase 1 | Bible §21 |
| Q-04 | Production/Shoot and Publishing/Scheduling: task types or workflow stages? | Phase 1 | Playbook §15, §18 |
| Q-05 | Is a Campaign/Project container needed above goals, or are goals enough initially? | Phase 1 | Playbook §18 |
| Q-06 | Can one task produce multiple assets; when are assets tracked separately? | Phase 1 | Playbook §18 |
| Q-07 | Priority levels and urgency criteria (seeded High/Medium/Low). | Phase 1 | Playbook §18 |
| Q-08 | Which fields are mandatory before work can start? | Phase 1 | Playbook §18 |
| Q-09 | Review stages per task type and who reviews each. | Phase 1 | Playbook §18 |
| Q-10 | Effort estimates in minutes or hours; is actual-time tracking optional or mandatory? | Phase 1 | Playbook §10, §18 |
| Q-11 | How are goal progress and "At Risk" calculated? | Phase 1 | Bible §5.3; Playbook §18 |
| Q-12 | Notifications needed (email / WhatsApp / none)? | Phase 1 | Not documented |
| Q-13 | Netlify site name / custom domain; is a separate staging environment wanted? | Deploy | Not documented |
| Q-14 | Performance data sources to integrate (Meta, analytics, manual import). | Phase 2 | Bible §21 |
| Q-15 | Radar source set and access methods (APIs/RSS/official sources). | Phase 3 | Bible §8, §21 |
| Q-16 | OpenAI model, monthly budget, data-handling stance; which AI outputs need approval before external use. | Phase 4 | Bible §10; Playbook §18 |
| Q-17 | Retention/deletion policy for audit history, source records and personal data. | Phase 3 | Bible §18.1, §21 |
| Q-18 | What is the existing `marketing_meta` schema, and does it relate to this app? | Phase 2 | Supabase inspection |
| Q-19 | Pre-existing exposure: ~21 tables in `public` readable by `anon` without RLS (other apps). Owner to decide whether to fix (outside this repo's scope). | Owner decision | Supabase inspection |
