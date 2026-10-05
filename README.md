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

- **A block on Today** (or the blue NOW card): the full text, where you stand this week on that kind of block, the last four same-weekdays, Mark done / Skip, and **Move it**.
- **A to-do**: edit the title, due date, area and notes; see where it came from (make-up, top 3, check-out fix) and when it was originally due.
- **A milestone on the Plan tab**: what it means, how it is counted, and the to-dos on the way there.
- **A number on the Week tab**: the day-by-day bars and how that number is counted.
- **A one-off item**: its notes, **Edit event**, and **Add to my calendar**.

## Calling mode

During a call block the NOW card offers **Start calling** (also on the Calls tab, or press `c` on a laptop). It serves one lead at a time with a big Call button and the result buttons; each result counts the dial, books the next touch and brings up the next lead. **Skip for now** sends a lead to the back of the list. The bar at the top shows the block's dials and today's total.

## Your schedule

Your week has a plan that repeats (every Monday looks the same), and any single day can differ. Every change asks which one you mean: **Only today** (or that date) or **Every Monday** (or that weekday).

- **Move a block.** Tap it, then use **Move it**: the −30 / −15 / +15 / +30 / +60 buttons, or type exact Starts and Ends times. Moving the start keeps the length. A block moved for one day shows "Moved from 7:15" and has **Put it back**.
- **Running late?** Tap **⋯** on a row in Today's plan and push it back 15 minutes, 30 minutes or an hour, just for today.
- **Plan another day.** **Edit** on Today's plan (or `s` on a laptop) opens **Your schedule**: tap Today, Tomorrow or any day in the next week, or pick a date, then tap a block to change it for that day.
- **Add something.** **+ Add** (or `e`) adds to one day (an appointment, extra pickleball, a gym session) or to every week on the weekdays you pick. Pickleball counts toward your week's drill and competitive numbers when you check it off. If it overlaps other blocks, the app says which.
- **Change or remove a block for good.** In a block's sheet, **Change it or take it out of your week** edits the label, details, times and type, and **Apply to** copies the change to other weekdays. **Take it out** removes it from the days you pick.
- **Skip once.** **Skip today** (or **Take it off** for another date) leaves your week alone and creates no make-up.
- Every change shows **Undo** for a few seconds. The Plan tab's **Your schedule** card and the Week tab's **Day by day** card open the same editor.
- One-off items show in that day's plan with a green tag, get a phone nudge before they start (Sundays included), and **Add to my calendar** saves one as an `.ics` file. **Coming up** on the Plan tab lists the next 90 days of them.

## Ask: talk to the app

The **Ask** button at the bottom right (or `a` on a laptop) opens a chat with Claude that sees your live data: today's and tomorrow's plan and what is done, your weekly plan, to-dos, the call list and pipeline, this week's numbers against the targets, the roadmap, money, body, sessions and DUPR. Ask what to focus on, how the week is going or who to call first, or tell it what to do:

- "I have pickleball 6 to 8, 12 to 2 and 4:30 to 6:30 tomorrow" (it moves or adds court time and tells you what overlaps)
- "Push everything after lunch 30 minutes", "Skip gym today", "Move check-in to 6:45 every weekday"
- "I finished drill, went 7 and 3, work on resets", "Weight 218.4, slept 7 hours, energy 8"
- "Add a to-do for Friday: send the proposal", "Note on Lisa: call back Thursday"

A change for a named day stays on that day; it changes your weekly plan only when you say every, always or from now on. Each reply lists what it changed. On a phone, tap the mic to dictate. The conversation is saved in your database, so it is the same on every device; **Clear** starts over.

It runs as a second Edge Function in your own Supabase project with your own Anthropic key, so nothing goes through anyone else's server. Plan → This device → **Assistant** → **Set up** walks you through it once:

1. At console.anthropic.com add a few dollars of credit under **Billing**, then create a key under **Settings → API keys**.
2. In Supabase open **Edge Functions → Deploy a new function → Via Editor**, name it `assistant`, replace the code with the app's **Copy the code** button (it is `supabase/functions/assistant/index.ts`), deploy, then turn off **Verify JWT** in the function's settings. Tap **Check** in the app.
3. Under **Edge Functions → Secrets** add `ANTHROPIC_API_KEY` with the key from step 1, then tap **Check** again.

Each question costs a few cents. The function checks that the request comes from your signed-in account before it reads anything, and the key never leaves Supabase. It uses Claude Opus 5.5 with Anthropic's server-side fallback turned on, so a request that a safety filter declines is retried on a fallback model instead of failing. Until it is set up, the chat shows a **Set it up** card.

**After an app update** that changes a function, its setup sheet shows **Update needed**: tap **Copy the code**, open that function in Supabase, replace all of its code, **Deploy**, and tap **Check**. Your key and settings stay.

## Laptop keys

`1` to `5` switch tabs, `/` opens Calls with the search focused, `n` jumps to the new to-do box, `s` opens your schedule, `e` adds to your plan, `c` starts calling, `a` opens Ask, `Esc` closes any sheet.

## Reminders

Two ways, pick either or both:

- **Calendar alarms, no setup.** Plan → This device → **Add to calendar** saves a `.ics` file: a weekly repeating calendar of your blocks with an alarm before each one. Open the file on your iPhone and tap **Add All**, or double-click it on your Mac (Calendar syncs it to your phone through iCloud). Google Calendar: Settings → Import. One-off items are included; moves for a single day are not. Re-export after you change your weekly plan.
- **Phone notifications.** Plan → This device → **Phone notifications** walks you through a one-time, three-step setup: paste the `supabase/functions/reminders/index.ts` code into a Supabase Edge Function called `reminders` (with "Verify JWT" off), schedule it every minute (Supabase Cron page, or `cron.sql`), then turn it on for each device. On iPhone this only works from the Home Screen icon. The function runs in your own Supabase project, generates its own keys on first run (`push_vapid` table from `schema.sql`), and nudges you before each block in your time zone, at the moved time when you moved a block for that day. One-off items nudge too. Sundays stay quiet apart from check-in, check-out, play and one-off items.

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
