# Life Command Center

Your personal daily plan, call list, check-ins and training log. It is a small web app you install on your phone and laptop. Your data lives in your own free Supabase project, so every device shows the same thing within seconds, and the app keeps working when the connection drops.

The live app is at your Vercel URL. Setup is a one-time job; the first part takes about 15 minutes.

## 1. Supabase (your database, free)

1. Go to supabase.com, sign in, and click **New project**. Name it `life-command-center` and pick a US region.
2. Open **SQL Editor → New query**, paste everything in `supabase/schema.sql`, and click **Run**. You should see "Success". Running it again later is safe.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick **Auto confirm user**.
4. Turn off public sign-ups: **Authentication → Sign In / Providers**, then switch off **Allow new users to sign up**.
5. Open **Project Settings → API Keys**. Copy the **Project URL** and the **Publishable key** (older projects call it the `anon` key). The publishable key is safe in a browser: row-level security means only your signed-in account can read or write your rows. Never use the **secret** key anywhere in this project.

## 2. Vercel (hosting, free)

1. Push this folder to a GitHub repo (private is best).
2. On vercel.com click **Add New → Project**, import the repo, and keep the detected **Vite** settings.
3. Open **Environment Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the two values from step 1.5. They are baked in at build time, so if you add them later click **Redeploy**.
4. Deploy. Every push to the production branch redeploys automatically.

If you ever open the app on a build that has no keys, it shows a **Connect your database** screen where you can paste the two values instead. They are kept on that device only.

## 3. Load your data

Open the Vercel URL, sign in, and when it says your database is empty click **Choose backup file** and pick `seed/data.json` (or drag the file onto the page). Do this once, on one device. Importing adds or replaces items with the same IDs and never deletes anything, so re-importing a backup is safe.

## 4. Install it like an app

- **iPhone or iPad:** open the URL in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the **⋮** menu, then **Install app**.
- **Mac or Windows, Chrome or Edge:** click the **install icon** at the right end of the address bar, then **Install**.
- **Mac, Safari:** **File → Add to Dock**.

The app also shows a banner with the right steps for the device you are on, and the **This device** card on the Plan tab has an Install button where the browser supports one.

## How sync works

- Every device reads and writes the same Supabase table. Changes made on one device appear on the others within a few seconds through Supabase Realtime, and the app reloads everything whenever you come back to it.
- The header shows the sync state: **Synced**, **Saving…**, **Offline · saved copy**, or **N changes waiting**. Tap it to sync now.
- A copy of your data is kept on each device, so the app opens instantly and still reads when you have no signal. Anything you change while offline is queued and sent as soon as you are back online, even if you closed the app in between.
- Patches are merged on the server, so changing different fields of the same item on two devices does not overwrite either change. If you set up Supabase before this version, run `supabase/schema.sql` again once to install that function; until then the app merges on the client.

## Tap anything for the story behind it

- **A block on Today** (or the blue NOW card): the full text, where you stand this week on that kind of block, the last four same-weekdays, and Mark done / Skip.
- **A to-do**: edit the title, due date, area and notes; see where it came from (make-up, top 3, check-out fix) and when it was originally due.
- **A milestone on the Plan tab**: what it means, how it is counted, and the to-dos on the way there.
- **A number on the Week tab**: the day-by-day bars and how that number is counted.
- **A calendar event**: its notes, **Edit event**, and **Add to my calendar**.

## Calling mode

During a call block the NOW card offers **Start calling** (also on the Calls tab, or press `c` on a laptop). It serves one lead at a time with a big Call button and the result buttons; each result counts the dial, books the next touch and brings up the next lead. **Skip for now** sends a lead to the back of the list. The bar at the top shows the block's dials and today's total.

## Your calendar

Anything with a date and a time that is not part of the weekly schedule: a demo, a dentist appointment, a tournament, a flight.

- **Add one** with **+ Event** on Today's plan or on the Plan tab, press `e` on a laptop, or tell the assistant ("put a demo on my calendar Thursday at 2").
- It shows in that day's plan in time order with a green **EVENT** tag, counts as a block you can check off, and gets a phone nudge before it starts, Sundays included.
- Tap it for **Edit event** and **Add to my calendar**, which saves a one-off `.ics` file for your phone or Mac calendar. The weekly export under Reminders includes your events too.
- **Coming up** on the Plan tab lists the next 90 days of events alongside your to-dos.

## Ask: talk to the app

The **Ask** button at the bottom right (or `a` on a laptop) opens a chat with Claude that sees your live data: today's plan and what is done, to-dos, the call list and pipeline, this week's numbers against the targets, the roadmap, money, body, DUPR and your calendar. Ask what to focus on, how the week is going or who to call first, or tell it to do something: it can add and change to-dos and calendar events, add a dated note to a lead and log your DUPR. On a phone, tap the mic to dictate. The conversation is saved in your database, so it is the same on every device; **Clear** starts over.

It runs as a second Edge Function in your own Supabase project with your own Anthropic key, so nothing goes through anyone else's server. Plan → This device → **Assistant** → **Set up** walks you through it once:

1. At console.anthropic.com add a few dollars of credit under **Billing**, then create a key under **Settings → API keys**.
2. In Supabase open **Edge Functions → Deploy a new function → Via Editor**, name it `assistant`, replace the code with the app's **Copy the code** button (it is `supabase/functions/assistant/index.ts`), deploy, then turn off **Verify JWT** in the function's settings. Tap **Check** in the app.
3. Under **Edge Functions → Secrets** add `ANTHROPIC_API_KEY` with the key from step 1, then tap **Check** again.

Each question costs a few cents. The function checks that the request comes from your signed-in account before it reads anything, and the key never leaves Supabase. It uses Claude Opus 5.5 with Anthropic's server-side fallback turned on, so a request that a safety filter declines is retried on a fallback model instead of failing.

## Laptop keys

`1` to `5` switch tabs, `/` opens Calls with the search focused, `n` jumps to the new to-do box, `e` adds a calendar event, `c` starts calling, `a` opens Ask, `Esc` closes any sheet.

## Reminders

Two ways, pick either or both:

- **Calendar alarms, no setup.** Plan → This device → **Add to calendar** saves a `.ics` file: a weekly repeating calendar of your blocks with an alarm before each one. Open the file on your iPhone and tap **Add All**, or double-click it on your Mac (Calendar syncs it to your phone through iCloud). Google Calendar: Settings → Import. Your calendar events are included; re-export after you change the schedule or add events.
- **Phone notifications.** Plan → This device → **Phone notifications** walks you through a one-time, three-step setup: paste the `supabase/functions/reminders/index.ts` code into a Supabase Edge Function called `reminders` (with "Verify JWT" off), schedule it every minute (Supabase Cron page, or `cron.sql`), then turn it on for each device. On iPhone this only works from the Home Screen icon. The function runs in your own Supabase project, generates its own keys on first run (`push_vapid` table from `schema.sql`), and nudges you before each block in your time zone. Calendar events nudge too. Sundays stay quiet apart from check-in, check-out, play and events.

## Rest days and fresh starts

- **Sundays are rest days**: nothing counts as late, the carried-over list is hidden, and the catch-up automation never creates make-ups for them. The Plan tab lists the current rest days.
- **The first load after the October 2026 update runs a fresh start by itself**, once, so the plan begins on Monday October 5 (or today, if later) with Sundays as rest days. It records that in `meta/setup` and never repeats.
- **Fresh start** (Plan tab → This device → Fresh start) begins the plan on a day you choose: older unfinished to-dos and call follow-ups move to that day, make-ups the app created are dropped, the catch-up automation starts counting from there, and Sunday gets the church (10:30 to 1), rest and pickleball schedule. Use it after any break.

## Updates

A new version downloads in the background. When it is ready the app shows **A new version is ready · Reload**; tap it, or just fully close and reopen the app and it switches by itself. The version number is at the bottom of the This device card.

## Good to know

- **Backups:** the This device card has **Download** (saves a JSON backup) and **Choose backup file**. You can also drag a backup onto the page.
- **Free Supabase projects pause after about a week with no use.** Opening the app most days keeps it awake. If it pauses, open the Supabase dashboard and click **Resume project**. Your data stays.
- **Dates** are local to the device, so the day rolls over at your local midnight.
- **Running it on your own computer:** `npm install`, copy `.env.example` to `.env.local` with your two values, then `npm run dev` and open http://localhost:5173. `npm run build` makes the production build in `dist/`. `npm run icons` regenerates the app icons from `scripts/icons.mjs`.
