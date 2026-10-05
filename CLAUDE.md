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
    - Keys repeat across weekdays for the same block (`checkin`, `drill`, …). Blocks added in the app or by the assistant get `b<base36>` keys.
  - `config/roadmap`: `{weeks: [{start "YYYY-MM-DD", focus, musts}]}`.
  - `config/profile`: move date, start/goal weight, DUPR start and checkpoints, weekly targets, the Dec 1 gate, links, `startDate`, `restDays` (defaults to `['Sun']` when missing).
  - `config/money`: account balances, history, and the weekly savings plan.
  - `days/<YYYY-MM-DD>`: `{date, checks{key:bool}, skips{key:bool}, moves{key:{start,end}|null}, am{weight, sleep, energy, top3[{t,done}], note, savedAt}, pm{…, savedAt}, calls[{t, id, name, region, kind, outcome, dial, convo, demo, dm}]}`. `moves` are one-off times for that date only; `null` means back to the usual time.
  - `tasks/<id>`: `{title, due, origDue, area, notes, done, doneOn, dropped, kind: task|makeup|top3|fix|sales}`.
  - `leads/<id>`: `{name, type: Cold|Warm|Client|Partner, stage, nextStep, nextDate, phone, business, contact, website, region: IA|AZ|'', touches, notes, deal, monthly, collected}`.
  - `sessions/<id>`: pickleball sessions. `auto-<date>-<key>` ones are created when a drill or play block is checked off.
  - `dupr/<date>`, `weeks/<weekStart>` (Sunday review: leak, fix), `meta/rollover` (`{through, freshStart?}`).
  - `push/<deviceId>`: Web Push subscription for one device `{endpoint, keys, tz, lead, enabled, ua}` (written by the app). `pushlog/<deviceId>`: `{sent: {"<date>|<key>": ts}}` written only by the reminders function.
  - `events/<id>`: one-off items for a single date `{title, date "YYYY-MM-DD", start "HH:MM", end, where, notes, kind?, sessionType?, createdAt, updatedAt}`. No `kind` (or `event`) is an appointment; otherwise `kind` is `session | task | gym | mobility | watch | marker`, and court time carries `sessionType`. Ids are `ev-<base36 time>` (the assistant uses the same shape).
  - `chat/main`: the assistant conversation `{messages: [{role: user|assistant, content, at, actions?: [string]}]}`, kept to the last 40 messages, shared by every device.

## Automations (in main.js)
- **Rollover (`runRollover`):** runs only after the first successful load from the server (never on a stale local copy). It processes each day after `meta/rollover.through`, up to yesterday (max 3 days back, never before `profile.startDate`). It creates make-up tasks for missed `carry` items, dial shortfalls and unfinished top-3 items. Rest days get no schedule make-ups. Task IDs are deterministic (`mk-…`, `t3-…`) so reruns don't duplicate.
- **Rest days (`isRestDay`):** on a rest day nothing is marked late or behind (schedule, to-dos and leads), the carried-over section and the Calls badge are hidden and a rest banner shows instead.
- **Automatic fresh start (`maybeAutoFreshStart`, called from `maybeRollover`):** on the first load after `AUTO_FRESH_DATE` (2026-10-05) ships, if neither `meta/setup.freshStart` nor `meta/rollover.freshStart` exists and `profile.startDate` is older, it runs `applyFreshStart(max(today, AUTO_FRESH_DATE), true)` and writes `meta/setup`. Never repeats.
- **Fresh start (`applyFreshStart`, UI in `submit('fresh')`):** moves unfinished older to-dos and lead follow-ups (`nextDate`) to the chosen date, drops `makeup`/`top3` tasks, sets `meta/rollover.through` to the day before, sets `profile.startDate` and optionally `restDays=['Sun']` plus the `REST_SUNDAY` schedule (church 10:30 to 13:00, play 15:00 to 17:00).
- **Call outcomes (`outcome`):** count dials, conversations and demos into the day's calls, and move cold leads along the 5-touch cadence (gaps of 2, 2, 3 and 6 days). Booking a demo creates the demo task and a proposal task.
- **Check-out:** the "fix" becomes tomorrow's task `fix-<date>`.
- **A day's plan (`itemsFor`):** `scheduleFor(d)` with that date's `moves` applied (moved items carry `movedFrom`), plus `eventsOn(d)` mapped by `eventItem` (`key: 'ev-<id>'`, `eventId`, `oneoff: true`, `kind` from the event, tag `EVENT` or the session type), sorted by start. Today, the NOW card, `toggleCheck`, `blockSheet`, calling mode, `dayAuto` and `dayStatsFor` use it, so one-off gym, mobility and study count toward the week and one-off court time logs an `auto-<date>-ev-<id>` session when checked. Rollover keeps using `scheduleFor`, so one-offs never create make-ups. `exportCalendar` appends one-offs as VEVENTs (`eventLines`), `exportEvent(id)` saves a single-event `.ics`.
- **Schedule editing:** `moveBlock(date, key, start, end, scope)` writes `days/<date>.moves` (scope `day`), the weekday's array in `config/schedule` via `patchDoc` (scope `week`, which also clears that date's move), or the event itself. `moveBy`, `moveTime` (Starts/Ends inputs; a new start keeps the length) and `resetMove` build on it. Adds and edits go through `submit('add')` (one-off event, or a weekly block on the picked weekdays) and `submit('block-edit')` (changed fields copied to every picked weekday; days without the block get a copy). Every change sets `S.lastUndo = {type:'restore', ops}`, replayed by `runOps`.

## Reminders
- `supabase/functions/reminders/index.ts` is a Deno Edge Function (deployed by hand as `reminders`, Verify JWT off). Every minute (Supabase Cron or `cron.sql`) it loads `push`, `pushlog`, `config`, `days` and `events` rows with the service role, computes each device's local clock from its `tz`, builds the day with `itemsForDay` (weekly plan + that date's `moves` + one-off items) and sends a Web Push for blocks whose start minus `lead` minutes is now (or one minute ago). Untagged markers never nudge; rest days only nudge check-in, check-out, sessions and one-off items; checked, skipped and saved items are quiet.
- Both functions export `FN_VERSION` and report it from `?status=1`. The app reads the version in its embedded copy (`fnVersion`) and shows **Update needed** in the setup sheet (and a card in the chat) when Supabase runs an older one. Bump `FN_VERSION` whenever a function's behaviour changes. `?public_key=1`, `?status=1` and `POST ?test=<device>` serve the app. VAPID keys live in `public.push_vapid`, created on first run. The pure logic sits between `// ---- pure logic` markers so a Node test can import it without Deno.
- The app embeds that file and `cron.sql` with `?raw` imports so the setup sheet can copy them. `src/sw.js` shows pushes and focuses the app on tap.
- Calendar export (`exportCalendar`) writes a weekly-recurring `.ics` with a VALARM per block; floating local times, untagged markers excluded. Events from the last week onward are appended as one-off VEVENTs.

## Assistant
- `supabase/functions/assistant/index.ts` is a second Deno Edge Function (deployed by hand as `assistant`, Verify JWT off, secret `ANTHROPIC_API_KEY`). The app embeds it with `?raw` so the setup sheet (`assistantSheet`, three steps, `GET ?status=1` → `{ok, hasKey, model}`) can copy it.
- Request: `POST {message, history, tz, today, now}` with `Authorization: Bearer <session access token>`. The function verifies the token with the anon client (`auth.getUser`), then loads every row of that owner with the service role, builds a text context (`buildContext`: today's and tomorrow's plan with `[key]`s, status and moves, one-off changes for the rest of the week, the weekly plan, to-dos, calls and pipeline, week vs targets, roadmap, money, body, sessions with ids, one-offs for 30 days) and calls `claude-opus-5-5` through `@anthropic-ai/sdk` (`client.beta.messages.create`, beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`, `output_config.effort: "medium"`, system prompt cached). Manual tool loop, at most 8 rounds; handles `tool_use`, `pause_turn` and `refusal`. The context is built once per question: the system prompt must stay byte-identical across rounds or the thinking blocks passed back stop being valid. Response `{reply, actions, version}`.
- Tools (`runTool(store, name, input, today, d)`, all between the `// ---- pure logic` markers so a Deno test can run them on the seed with an in-memory store): `move_block`, `skip_block`, `check_block` (logs the auto session for court time), `add_event` (with `kind` / `session_type`), `update_event`, `edit_weekly_block`, `add_weekly_block`, `remove_weekly_block`, `add_task`, `update_task`, `add_lead_note`, `log_checkin`, `log_session`, `log_dupr`. Writes read the current row first and merge (`merge` mirrors `patch_doc`), so a change made on a phone a moment earlier is kept.
- In the app: `askAssistant(text)` appends to `chat/main`, posts, stores the reply with its `actions` and calls `db.refresh()` when something was written. `chatSheet` (modal `chat`) has suggestion chips, dictation via `webkitSpeechRecognition` where available (`chatMic`) and Enter to send. Opened by the `#fab` button (shown by `renderTabs` once loaded), the Assistant row of This device, or `a`. Opening it runs a quiet `assistantCheck(true)`; a missing function, a missing key or an older version shows a `.setupcard` that opens the setup sheet.
- The Anthropic key lives only in Supabase Edge Function secrets. Never put it in the app, `.env*` or the repo.

## UI
- Tap anything for depth: schedule rows and the NOW card open `blockSheet(key, date)` (status, done/skip, `movePanel` with Only-this-day / Every-weekday, nudges and Starts/Ends, overlapping blocks, this-week numbers for that kind, last four same-weekdays; one-offs get Edit event and Add to my calendar), to-do titles open `taskSheet` (edit, origin), milestones open `mileSheet`, Week numbers open `statSheet` (day-by-day bars). `renderModal` dispatches on `S.modal.type` (`session | fresh | block | blockedit | sched | add | task | mile | stat | notif | call | event | chat | assist | lead`) and keeps the focused field and the sheet's scroll across re-renders.
- Your schedule: `schedSheet` (modal `sched`, `{date}`, chips for the next 7 days plus a date picker) lists `itemsFor(date)` as `.srow-b` rows that open `blockSheet` with `back: 'sched'`. `addForm` (modal `add`, `{date, scope, days}`, form `add`) and `eventForm` (modal `event`, form `event-edit`) share `itemFields` (drafts `ev-*`, type select `ad-type` from `ITEM_TYPES`). `blockEditForm` (modal `blockedit`, form `block-edit`, drafts `be-*`) edits a weekly block on the picked weekdays. Entry points: Edit and + Add on Today's plan, ⋯ on each row (push back 15/30/60, Move…, Skip), the Plan tab's Your schedule card, the Week tab's Day by day card, and the `s` and `e` keys. Coming up on Plan groups `{tasks, events}` per date (`.trow.ev`).
- Calling mode (`callSheet`, `S.callMode = {region, skipped}`): opened from the NOW card during a call block, the Calls tab, or the `c` key. Shows the first due lead for the block's region (warm follow-ups included) via `leadCard`; a result re-renders to the next lead; Skip pushes a lead to the back for the session. `closeModal()` resets it.
- Keyboard (laptop, ignored while typing or with a sheet open): `1`–`5` tabs, `/` Calls + search focus, `n` focus the new to-do box, `s` your schedule, `e` add to your plan, `c` calling mode, `a` ask, `Esc` close. Enter in `#chat-in` sends. A one-time `.tip` banner on Today explains tapping for depth and the keys; dismissal is stored in `lcc-tip-done`.
- Five tabs with icons: Today, Calls, Week, Log, Plan. The Plan tab opens with "The plan" (gate, DUPR and body checkpoints, move, weekly targets) and ends with the **This device** card: install, appearance, sync, reminders, assistant, fresh start, backup, account.
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
- Google Calendar sync of the daily blocks (today: `.ics` export and one-off event files).
- An email outreach panel: log replies from the cold email tool against leads.
- Streaming replies in the assistant (the function answers in one piece today).
