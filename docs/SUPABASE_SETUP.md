# Supabase setup (Phase 0)

Status of each step in the shared "Akidha DB" project.

## 1. Apply the migration — DONE (2026-10-24)
`supabase/migrations/20261024000000_marketing_os_foundation.sql` was applied as migration `marketing_os_foundation`. It created only `marketing_os` and `marketing_os_private`; nothing outside them changed (verified, see D-009).

For future migrations:

```bash
npm run check:migrations                      # isolation guard
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db   # throwaway DB
```

## 2. Expose the schema to the Data API — TO DO (dashboard)
1. Open https://supabase.com/dashboard/project/rqvawgtpdjkwdbgftwxz
2. Go to **Project Settings → Data API** (older dashboards: **Settings → API**).
3. Find **Exposed schemas**. Click into the field and add `marketing_os`. **Keep every schema already listed** (other apps depend on them).
4. Do **not** add `marketing_os_private`.
5. Click **Save**.

Until this is done the app shows "The marketing_os schema is not exposed in the Supabase Data API yet". Exposing it is safe: `anon` has no access, and every table requires a Marketing OS membership.

## 3. Accounts — DONE for the core team
Username + password login (decision D-008):

| Username | Name | Role |
|---|---|---|
| `sourabh` | Sourabh | admin |
| `tanvi` | Tanvi | admin |
| `nikita` | Nikita | contributor |
| `saail` | Saail | contributor |

Each person has their own temporary password (shared with the product owner privately, not stored in this repo). They should change it under **Account** after first sign-in.

Adding people later / resetting a password (admin's machine only, needs the service-role key in `.env.local`):

```bash
npm run member:create -- --username priya --name "Priya" --role contributor
npm run member:create -- --username priya --reset-password
npm run member:create -- --username priya --deactivate
```

## 4. Netlify environment variables
Site configuration → Environment variables:

| Name | Value | Scope |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://rqvawgtpdjkwdbgftwxz.supabase.co` | Builds |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable / anon key (Project Settings → API Keys) | Builds |
| `SUPABASE_URL` | same URL | Functions |
| `SUPABASE_PUBLISHABLE_KEY` | same publishable key | Functions |
| `AI_PROVIDER` | `gemini` (D-024) | Functions |
| `GEMINI_API_KEY` | Google AI Studio key (mark as secret) | Functions |
| `GEMINI_MODEL` | model ID from AI Studio, e.g. a Flash model (optional; default `gemini-2.5-flash`) | Functions |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | only if you switch `AI_PROVIDER` to `openai` | Functions |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | from a Reddit "script" app (optional; Reddit sources show "not configured" without them) | Functions |
| `REDDIT_USER_AGENT` | e.g. `akidha-marketing-desk/1.0 by <reddit username>` | Functions |

Never add `SUPABASE_SERVICE_ROLE_KEY` to Netlify. `/api/health` reports configured/not-configured flags (never values) and warns if it is present.

## 5. Auth settings (no change required)
Email/password sign-in must stay enabled (Supabase default); it powers username login. No confirmation or reset emails are sent for Marketing OS accounts.
