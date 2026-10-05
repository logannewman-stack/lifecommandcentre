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

- **A block on Today** (or the blue NOW card): the full text, where you stand this week on that kind of block, the last four same-weekdays, Mark done, Cancel for today, and **Reschedule**.
- **A to-do**: edit the title, due date, area and notes; see where it came from (make-up, top 3, check-out fix) and when it was originally due.
- **A milestone on the Plan tab**: what it means, how it is counted, and the to-dos on the way there.
- **A number on the Week tab**: the day-by-day bars and how that number is counted.
- **A one-off item**: its notes, **Edit event**, and **Add to my calendar**.

## Calling mode

During a call block the NOW card offers **Start calling** (also on the Calls tab, or press `c` on a laptop). It serves one lead at a time with a big Call button and the result buttons; each result counts the dial, books the next touch and brings up the next lead. **Skip for now** sends a lead to the back of the list. The bar at the top shows the block's dials and today's total.

## Your schedule

Your week has a plan that repeats (every Monday looks the same), and any single day can differ. Every change asks which one you mean: **Only today** (or that date) or **Every Monday** (or that weekday).

- **Fastest: swipe or hover.** On a phone, swipe a block left for **+30 min**, **Reschedule** and **Cancel**, or swipe it right to mark it done. On a laptop, rest the pointer on a block and the same buttons appear, plus +15. The **⋯** on each row has them too.
- **Reschedule.** Tap a block, then use the **Reschedule** box: −30 / −15 / +15 / +30 / +60, exact Starts and Ends times (moving the start keeps the length), **Move to tomorrow**, or **another day**. Moving to another day cancels it where it was and puts a one-off copy on the new day, marked "Moved from Mon". A block moved for one day shows "Moved from 7:15" and has **Put it back**.
- **Cancel.** **Cancel for today** (or **Cancel on** another date) takes a block off that day only. It leaves your week alone and never comes back as a make-up.
- **Catch up.** When blocks slip by, the **3 behind · Catch up** pill on Today lists them: mark what you did (court time logs the session), reschedule what you still want to do, and cancel the rest in one tap.
- **Plan another day.** **Edit** on Today's plan (or `s` on a laptop) opens **Your schedule**: tap Today, Tomorrow or any day in the next week, or pick a date, then tap a block to change it for that day.
- **Add something.** **+ Add** (or `e`) opens one box. Type it the way you would say it, and the line under the box shows what you will get before you press Enter: "Pickleball Thu 6-8am" is court time on Thursday, "Dentist Friday 2pm" is an appointment, "Gym every Mon, Wed, Fri 6:30pm" goes on your weekly plan, and anything without a time is a to-do. **More options** opens the full form (type, day or weekdays, place, notes) with what you typed filled in. Pickleball counts toward your week's drill and competitive numbers when you check it off. If it overlaps other blocks, the app says which.
- **Change your week for good.** In a block's sheet, **Edit it or remove it from your week** changes the label, details, times and type, and **Apply to** copies the change to other weekdays. **Remove from your week** takes it out of the days you pick.
- Every change shows **Undo** for a few seconds, and a moved block flashes in its new spot. The Plan tab's **Your schedule** card and the Week tab's **Day by day** card open the same editor.
- One-off items show in that day's plan with a green tag, get a phone nudge before they start (Sundays included), and **Add to my calendar** saves one as an `.ics` file. **Coming up** on the Plan tab lists the next 90 days of them.

## To-dos

- **Add one** in the box under **To-dos due today**, in plain words: "Call Lisa tomorrow" is a Sales to-do due tomorrow, and "Send the proposal Wednesday" is due Wednesday. Without a day it is due on the date next to the box. A line with a time, like "Gym 6pm", goes on your plan instead; tap **Just a to-do** if you meant a to-do.
- **Finish, move or drop it with a swipe.** On a phone, swipe a to-do right to mark it done, or left for **Tomorrow**, **Pick a day** and **Drop**. On a laptop, rest the pointer on it for the same buttons. Tap the title to edit it. Each change has **Undo**.
- **Long lists are grouped by area**: your check-out fix first, then Sales, Build, Pickleball, Body, Money, Move, DoD and Other.
- **Too many for one day?** When more than six are due, **Spread over the week** keeps the five most important today (your fix, top 3, make-ups, then whatever has waited longest) and moves the rest onto the next days that count, five a day. **Undo** puts them back.

## Ask: talk to the app

The **Ask** button at the bottom right (or `a` on a laptop) opens a chat with Claude that sees your live data: today's and tomorrow's plan and what is done, your weekly plan, to-dos, the call list and pipeline, this week's numbers against the targets, the roadmap, money, body, sessions and DUPR. Ask what to focus on, how the week is going or who to call first, or tell it what to do:

- "I have pickleball 6 to 8, 12 to 2 and 4:30 to 6:30 tomorrow" (it moves or adds court time and tells you what overlaps)
- "Push everything after lunch 30 minutes", "Cancel gym today", "Move gym to tomorrow", "Move check-in to 6:45 every weekday"
- "I finished drill, went 7 and 3, work on resets", "Weight 218.4, slept 7 hours, energy 8"
- "Add a to-do for Friday: send the proposal", "Note on Lisa: call back Thursday", "I'm sick, take today off"

A change for a named day stays on that day; it changes your weekly plan only when you say every, always or from now on. Each reply lists what it changed. On a phone, tap the mic to dictate. The conversation is saved in your database, so it is the same on every device; **Clear** starts over.

It runs as a second Edge Function in your own Supabase project with your own Anthropic key, so nothing goes through anyone else's server. Plan → This device → **Assistant** → **Set up** walks you through it once:

1. At console.anthropic.com add a few dollars of credit under **Billing**, then create a key under **Settings → API keys**.
2. In Supabase open **Edge Functions → Deploy a new function → Via Editor**, name it `assistant`, replace the code with the app's **Copy the code** button (it is `supabase/functions/assistant/index.ts`), deploy, then turn off **Verify JWT** in the function's settings. Tap **Check** in the app.
3. Under **Edge Functions → Secrets** add `ANTHROPIC_API_KEY` with the key from step 1, then tap **Check** again.

Each question costs a few cents. The function checks that the request comes from your signed-in account before it reads anything, and the key never leaves Supabase. It uses Claude Opus 5.5 with Anthropic's server-side fallback turned on, so a request that a safety filter declines is retried on a fallback model instead of failing. Until it is set up, the chat shows a **Set it up** card.

**After an app update** that changes a function, its setup sheet shows **Update needed**: tap **Copy the code**, open that function in Supabase, replace all of its code, **Deploy**, and tap **Check**. Your key and settings stay.

## Laptop keys

`1` to `5` switch tabs, `/` opens Calls with the search focused, `n` jumps to the new to-do box, `s` opens your schedule, `e` opens **Add**, `c` starts calling, `a` opens Ask, `Esc` closes any sheet.

## Reminders

Two ways, pick either or both:

- **Calendar alarms, no setup.** Plan → This device → **Add to calendar** saves a `.ics` file: a weekly repeating calendar of your blocks with an alarm before each one. Open the file on your iPhone and tap **Add All**, or double-click it on your Mac (Calendar syncs it to your phone through iCloud). Google Calendar: Settings → Import. One-off items are included; moves for a single day are not. Re-export after you change your weekly plan.
- **Phone notifications.** Plan → This device → **Phone notifications** walks you through a one-time, three-step setup: paste the `supabase/functions/reminders/index.ts` code into a Supabase Edge Function called `reminders` (with "Verify JWT" off), schedule it every minute (Supabase Cron page, or `cron.sql`), then turn it on for each device. On iPhone this only works from the Home Screen icon. The function runs in your own Supabase project, generates its own keys on first run (`push_vapid` table from `schema.sql`), and nudges you before each block in your time zone, at the moved time when you moved a block for that day. One-off items nudge too. Sundays and days off stay quiet apart from check-in, check-out, play and one-off items.

## Rest days, days off and fresh starts

- **Sundays are rest days**: nothing counts as late, the carried-over list is hidden, and the catch-up automation never creates make-ups for them. The Plan tab lists the current rest days.
- **A day off** is a rest day for one date. When a day is not happening, open **Catch up** (the behind pill on Today) and tap **Make today a day off**, or ask ("take Friday off"). Nothing that day is late or turns into a make-up. Today shows a **Day off** banner with **It's not a day off** to undo it.
- **Start fresh tomorrow**, also in Catch up, makes today a day off and runs a fresh start for tomorrow.
- **Fresh start** (Plan tab → This device → Fresh start) begins the plan on a day you choose: older unfinished to-dos and call follow-ups move to that day, make-ups the app created are dropped, the catch-up automation starts counting from there, and Sunday gets the church (10:30 to 1), rest and pickleball schedule. Use it after any break.
- **The first load after the October 2026 update ran a fresh start by itself**, once, so the plan began on Monday October 5 with Sundays as rest days.
- **Everything starts on Tuesday, October 6.** The first time the app opens on or before that day, it restarts once: Monday the 5th becomes a day off, older unfinished to-dos and call follow-ups move to Tuesday, make-ups are dropped, and Monday's work is logged: the three pickleball sessions and the InnerBoard app updates, with a note on the Leah Roling lead. It records that in `meta/setup` and never repeats.

## Updates

A new version downloads in the background. When it is ready the app shows **A new version is ready · Reload**; tap it, or just fully close and reopen the app and it switches by itself. The version number is at the bottom of the This device card.

## Good to know

- **Backups:** the This device card has **Download** (saves a JSON backup) and **Choose backup file**. You can also drag a backup onto the page.
- **Free Supabase projects pause after about a week with no use.** Opening the app most days keeps it awake. If it pauses, open the Supabase dashboard and click **Resume project**. Your data stays.
- **Dates** are local to the device, so the day rolls over at your local midnight.
- **Running it on your own computer:** `npm install`, copy `.env.example` to `.env.local` with your two values, then `npm run dev` and open http://localhost:5173. `npm run build` makes the production build in `dist/`. `npm run icons` regenerates the app icons from `scripts/icons.mjs`.
