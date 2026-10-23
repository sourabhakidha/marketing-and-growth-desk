# Akidha Marketing Desk

Internal marketing & growth platform: Sense → Interpret → Decide → Execute → Learn. Product spec: Project Bible v1.0 and the Team Roles & Workflow Playbook (`docs/source/`).

**Status: Phase 1 (Workspace) built.** Sign-in, roles, vocabularies, audit log, and the Workspace — New Activity (Task / Goal), task board, task workflow with hand-offs and approvals, goals with progress, activity log and CSV exports. Performance Planning, Calendar, Radar, Opportunities, AI Intelligence and Learning Loop are labelled "Planned".

## Quick start

```bash
nvm use            # Node 22
npm ci
cp .env.example .env.local   # fill VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Netlify Functions locally: `npx netlify-cli dev` (serves `/api/*`).

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, unit tests, migration isolation guard, secret scan |
| `npm run build` | Production build to `dist/` |
| `npm run test:db` | Migrations + RLS tests on a throwaway Postgres (`TEST_DATABASE_URL` required; refuses Supabase hosts) |
| `npm run member:create -- --username … --name … --role admin\|contributor` | Admin-only, local: add a member or reset a password (see `docs/SUPABASE_SETUP.md`) |

## Layout

```
src/                 React app (pages, components, lib)
netlify/functions/   Server endpoints (/api/health, /api/me)
netlify/lib/         Shared server code (auth, env, http)
supabase/migrations/ SQL migrations — marketing_os schema ONLY
supabase/tests/      Test-only Supabase stub + RLS tests
scripts/             Guards, DB test runner, member admin script
docs/                Architecture, decisions, open questions, setup
```

## Rules for contributors
- Migrations may only touch `marketing_os` / `marketing_os_private`; CI enforces this.
- No secrets in the repo or in `VITE_*` variables. The Supabase service-role key never goes to Netlify.
- Do not show invented data. Unbuilt or unconfigured features must say so.
- Record product decisions in `docs/DECISIONS.md`; open items in `docs/OPEN_QUESTIONS.md`.
