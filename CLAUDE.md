# Life Command Center (CLAUDE.md)

Logan's personal productivity web app, for one user only. It is not a product: no billing, no multi-tenant features, no marketing pages.

## Stack
- Vite + vanilla JS (no framework). Entry: `index.html` → `src/main.js`.
- Supabase: email/password auth (one user, sign-ups disabled) and Postgres.
- Hosted on Vercel (Vite preset). Env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable key).
- PWA manifest and icons are in `public/`. There is deliberately no service worker, so a deploy never gets stuck behind a stale cache.

## Data model
- One table, `public.docs`, with columns (owner uuid, collection text, id text, data jsonb, updated_at). RLS restricts every row to `auth.uid() = owner`. Schema is in `supabase/schema.sql`.
- `src/db.js` wraps it in a Firestore-style API: `db.collection(c).onSnapshot(fn)` and `db.collection(c).doc(id).get/set/update/delete`. It loads every row once, keeps them in memory, writes optimistically, and listens to Supabase Realtime. Keep this API stable; `main.js` depends on it.
- Collections:
  - `config/schedule`: `{days: {Mon: [item…], …}}`. An item is `{key, start "HH:MM", end, tag, text, kind, carry?, quota?, region?, minutes?, sessionType?, hours?, short?, area?}`.
    - `kind` is one of `marker | task | checkin | checkout | calls | session | gym | mobility | watch | dupr`.
  - `config/roadmap`: `{weeks: [{start "YYYY-MM-DD", focus, musts}]}`.
  - `config/profile`: move date, start/goal weight, DUPR start and checkpoints, weekly targets, the Dec 1 deadline, links.
  - `config/money`: account balances, history, and the weekly savings plan.
  - `days/<YYYY-MM-DD>`: `{date, checks{key:bool}, skips{key:bool}, am{weight, sleep, energy, top3[{t,done}], note, savedAt}, pm{…, savedAt}, calls[{t, id, name, region, kind, outcome, dial, convo, demo, dm}]}`.
  - `tasks/<id>`: `{title, due, origDue, area, notes, done, doneOn, dropped, kind: task|makeup|top3|fix|sales}`.
  - `leads/<id>`: `{name, type: Cold|Warm|Client|Partner, stage, nextStep, nextDate, phone, business, contact, website, region: IA|AZ|'', touches, notes, deal, monthly, collected}`.
  - `sessions/<id>`: pickleball sessions. `auto-<date>-<key>` ones are created when a drill or play block is checked off.
  - `dupr/<date>`, `weeks/<weekStart>` (Sunday review: leak, fix), `meta/rollover` (`{through}`).

## Automations (in main.js)
- **Rollover (`runRollover`):** on load, it processes each day after `meta/rollover.through`, up to yesterday (max 3 days back). It creates make-up tasks for missed `carry` items, dial shortfalls and unfinished top-3 items. Task IDs are deterministic (`mk-…`, `t3-…`) so reruns don't duplicate.
- **Call outcomes (`outcome`):** count dials, conversations and demos into the day's calls, and move cold leads along the 5-touch cadence (gaps of 2, 2, 3 and 6 days). Booking a demo creates the demo task and a proposal task.
- **Check-out:** the "fix" becomes tomorrow's task `fix-<date>`.

## Conventions
- Dates are local `YYYY-MM-DD` strings. Never use UTC `toISOString()` for day keys.
- UI copy is plain, direct and second person.
- Colors come from the CSS tokens in `src/styles.css`, with light and dark both supported.
- Write one document at a time per path. Writes go through `setDoc`, `patchDoc` and `delDoc` in `main.js`.
- Never commit `seed/`, backups or `.env*`.

## Commands
- `npm run dev` runs locally at http://localhost:5173.
- `npm run build` produces the production build in `dist/`.

## Backlog ideas (only if Logan asks)
- Web push reminders at block start times.
- Google Calendar sync of the daily blocks.
- An email outreach panel: log replies from the cold email tool against leads.
- A schedule editor UI (today the schedule is edited in `config/schedule` or via a backup file).
