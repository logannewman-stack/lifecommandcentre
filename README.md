# Life Command Center

Your personal daily plan, call list, check-ins and training log. It's a static site on Vercel with Supabase for login and data, so it syncs between your phone and laptop.

Setup takes about 20 minutes. Do it once.

## 1. Open the project

1. Unzip this folder somewhere you keep code, for example `~/code/life-command-center`.
2. Open the folder in Claude Code (or a terminal) and run:

```bash
npm install
```

## 2. Create the Supabase project (free)

1. Go to supabase.com, sign in, and click **New project**. Name it `life-command-center` and pick the US Central or US West region.
2. When it finishes, open **SQL Editor**, click **New query**, paste everything in `supabase/schema.sql`, and click **Run**. You should see "Success".
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick **Auto confirm user**.
4. Turn off public sign-ups: **Authentication → Sign In / Providers** (or **Settings**), then switch off **Allow new users to sign up**. Now nobody else can make an account.
5. Open **Project Settings → API Keys**. Copy the **Project URL** and the **Publishable key** (older projects call it the `anon` key).

## 3. Connect it

1. Copy `.env.example` to `.env.local`.
2. Paste the two values in:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

3. Run it locally:

```bash
npm run dev
```

4. Open http://localhost:5173, sign in, then click **Choose backup file** and pick `seed/data.json`. That loads your schedule, roadmap, 109 leads, to-dos, yesterday's check-in and your starting DUPR.

## 4. Put it on Vercel

1. Create a **private** GitHub repo and push this folder to it. `.gitignore` already keeps `seed/` and `.env.local` (your personal data and keys) out of Git.

```bash
git init && git add . && git commit -m "Life Command Center"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/life-command-center.git
git push -u origin main
```

2. On vercel.com, click **Add New → Project**, import the repo, and keep the detected **Vite** settings.
3. Before you click Deploy, open **Environment Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values as `.env.local`. They get baked in at build time, so if you add them later, click **Redeploy**.
4. Deploy. Every `git push` to `main` redeploys automatically after that.

## 5. Install it like an app

- **iPhone:** open the Vercel URL in Safari, tap Share, then **Add to Home Screen**.
- **Mac or PC:** open it in Chrome and click the install icon in the address bar (or the ⋮ menu, then Cast, save and share, then **Install page as app**).

## Good to know

- **The publishable key is safe in the browser.** Row-level security in `schema.sql` means only your signed-in account can read or write your rows. Never put the **secret** (service_role) key in this project or in Vercel.
- **Backups:** the Plan tab has **Download backup** and **Choose backup file**. Importing adds or replaces items, never deletes.
- **Free Supabase projects pause after about a week with no use.** Opening the app daily keeps it awake. If it ever pauses, open the Supabase dashboard and click **Resume project**. Your data stays.
- **Switching from the Claude version:** stop logging there once this is live. If you used it after this export, ask Claude to export a fresh `data.json` and import it here.
