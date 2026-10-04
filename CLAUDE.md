# Life Command Center (CLAUDE.md)

Logan's personal productivity web app, for one user only. It is not a product: no billing, no multi-tenant features, no marketing pages.

## Stack
- Vite + vanilla JS (no framework). Entry: `index.html` → `src/main.js`. Fonts are self-hosted from `@fontsource` (latin subsets only).
- Supabase: email/password auth (one user, sign-ups disabled) and Postgres. `src/supabase.js` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time, or values saved on the device from the in-app Connect screen when the build has none.
- Hosted on Vercel (Vite preset, `vercel.json` sets caching headers). Pushes to the production branch deploy automatically. `.github/workflows/build.yml` runs the build on every push.
- PWA: `vite-plugin-pwa` (`vite.config.js`) generates the manifest and a Workbox service worker that precaches the app shell. Supabase requests are never cached by the worker. Update mode is `prompt`: `main.js` shows a "new version ready" toast, and a waiting worker also takes over on the next cold start. `public/` holds the icons; regenerate them with `npm run icons` (`scripts/icons.mjs`, needs Playwright).

## Data model
- One table, `public.docs`, with columns (owner uuid, collection text, id text, data jsonb, updated_at). RLS restricts every row to `auth.uid() = owner`. Schema is in `supabase/schema.sql`, which also installs `patch_doc(collection, id, patch)` (server-side deep merge) and a trigger that sets `updated_at`. It is idempotent.
- `src/db.js` wraps it in a Firestore-style API: `db.collection(c).onSnapshot(fn)` and `db.collection(c).doc(id).get/set/update/delete`. Keep this API stable; `main.js` depends on it. It is offline-first:
  - rows are cached in memory and mirrored to `localStorage` (`lcc:cache:<uid>`) so the app paints instantly and reads offline;
  - writes update memory first, then join a persisted queue (`lcc:queue:<uid>`) that is sent in order, batched for sets, and retried on `online`, on visibility, on a backoff timer and every 5 minutes;
  - `update()` sends a patch to `patch_doc` and falls back to fetch + merge + upsert if the function is missing (`PGRST202`);
  - Realtime events are ignored for documents with queued writes and when older than the version held; every reconnect and visibility change triggers a full reload;
  - `db.status()` feeds the header sync chip; `db.refresh()`, `db.flush()`, `db.destroy({wipe})` exist. Sign-out wipes the local copies.
- Collections:
  - `config/schedule`: `{days: {Mon: [item…], …}}`. An item is `{key, start "HH:MM", end, tag, text, kind, carry?, quota?, region?, minutes?, sessionType?, hours?, short?, area?}`.
    - `kind` is one of `marker | task | checkin | checkout | calls | session | gym | mobility | watch | dupr`.
  - `config/roadmap`: `{weeks: [{start "YYYY-MM-DD", focus, musts}]}`.
  - `config/profile`: move date, start/goal weight, DUPR start and checkpoints, weekly targets, the Dec 1 gate, links, `startDate`, `restDays` (defaults to `['Sun']` when missing).
  - `config/money`: account balances, history, and the weekly savings plan.
  - `days/<YYYY-MM-DD>`: `{date, checks{key:bool}, skips{key:bool}, am{weight, sleep, energy, top3[{t,done}], note, savedAt}, pm{…, savedAt}, calls[{t, id, name, region, kind, outcome, dial, convo, demo, dm}]}`.
  - `tasks/<id>`: `{title, due, origDue, area, notes, done, doneOn, dropped, kind: task|makeup|top3|fix|sales}`.
  - `leads/<id>`: `{name, type: Cold|Warm|Client|Partner, stage, nextStep, nextDate, phone, business, contact, website, region: IA|AZ|'', touches, notes, deal, monthly, collected}`.
  - `sessions/<id>`: pickleball sessions. `auto-<date>-<key>` ones are created when a drill or play block is checked off.
  - `dupr/<date>`, `weeks/<weekStart>` (Sunday review: leak, fix), `meta/rollover` (`{through, freshStart?}`).

## Automations (in main.js)
- **Rollover (`runRollover`):** runs only after the first successful load from the server (never on a stale local copy). It processes each day after `meta/rollover.through`, up to yesterday (max 3 days back, never before `profile.startDate`). It creates make-up tasks for missed `carry` items, dial shortfalls and unfinished top-3 items. Rest days get no schedule make-ups. Task IDs are deterministic (`mk-…`, `t3-…`) so reruns don't duplicate.
- **Rest days (`isRestDay`):** on a rest day nothing is marked late or behind (schedule, to-dos and leads), the carried-over section and the Calls badge are hidden and a rest banner shows instead.
- **Fresh start (`submit('fresh')`):** moves unfinished older to-dos and lead follow-ups (`nextDate`) to the chosen date, drops `makeup`/`top3` tasks, sets `meta/rollover.through` to the day before, sets `profile.startDate` and optionally `restDays=['Sun']` plus the `REST_SUNDAY` schedule.
- **Call outcomes (`outcome`):** count dials, conversations and demos into the day's calls, and move cold leads along the 5-touch cadence (gaps of 2, 2, 3 and 6 days). Booking a demo creates the demo task and a proposal task.
- **Check-out:** the "fix" becomes tomorrow's task `fix-<date>`.

## UI
- Five tabs with icons: Today, Calls, Week, Log, Plan. The Plan tab opens with "The plan" (gate, DUPR and body checkpoints, move, weekly targets) and ends with the **This device** card: install, appearance, sync, fresh start, backup, account.
- Layout: one column on phones. From 980px the tab bar becomes a left rail; from 1100px Today is two columns (`.two`: plan on the left, forms on the right) and other views pair cards with `.two-eq`. Mobile order is kept with `ord-*` classes and `display: contents`.
- An install banner on Today explains how to add the app on the current device (`beforeinstallprompt` where available, Share → Add to Home Screen on iOS). Dropping a `.json` file anywhere imports it.

## Conventions
- Dates are local `YYYY-MM-DD` strings. Never use UTC `toISOString()` for day keys.
- UI copy is plain, direct and second person.
- Colors come from the CSS tokens in `src/styles.css`, with light and dark both supported (auto, or forced via the Appearance setting, `data-theme` on `<html>`).
- Write one document at a time per path. Writes go through `setDoc`, `patchDoc` and `delDoc` in `main.js`.
- Never commit `seed/`, backups or `.env*`.

## Commands
- `npm run dev` runs locally at http://localhost:5173.
- `npm run build` produces the production build in `dist/` (service worker included). `npm run preview` serves it.
- `npm run icons` regenerates the icons in `public/`.

## Backlog ideas (only if Logan asks)
- Web push reminders at block start times.
- Google Calendar sync of the daily blocks.
- An email outreach panel: log replies from the cold email tool against leads.
- A schedule editor UI (today the schedule is edited via Fresh start for Sunday, `config/schedule`, or a backup file).
