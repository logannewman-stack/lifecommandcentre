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

## Rest days and fresh starts

- **Sundays are rest days**: nothing counts as late, the carried-over list is hidden, and the catch-up automation never creates make-ups for them. The Plan tab lists the current rest days.
- **Fresh start** (Plan tab → This device → Fresh start) begins the plan on a day you choose: older unfinished to-dos and call follow-ups move to that day, make-ups the app created are dropped, the catch-up automation starts counting from there, and Sunday gets the church / rest / pickleball schedule. Use it the first time you set up and after any break.

## Updates

A new version downloads in the background. When it is ready the app shows **A new version is ready · Reload**; tap it, or just fully close and reopen the app and it switches by itself. The version number is at the bottom of the This device card.

## Good to know

- **Backups:** the This device card has **Download** (saves a JSON backup) and **Choose backup file**. You can also drag a backup onto the page.
- **Free Supabase projects pause after about a week with no use.** Opening the app most days keeps it awake. If it pauses, open the Supabase dashboard and click **Resume project**. Your data stays.
- **Dates** are local to the device, so the day rolls over at your local midnight.
- **Running it on your own computer:** `npm install`, copy `.env.example` to `.env.local` with your two values, then `npm run dev` and open http://localhost:5173. `npm run build` makes the production build in `dist/`. `npm run icons` regenerates the app icons from `scripts/icons.mjs`.
