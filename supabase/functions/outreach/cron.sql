-- Runs the "outreach" Edge Function every 10 minutes.
-- Each run reads new replies and sends at most one email, only on your sending days and hours,
-- so a day's emails are spread out. Paste this into SQL Editor > New query and click Run.
-- YOUR-PROJECT-REF is the part of your project URL before .supabase.co (the app fills it in).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lcc-outreach') then
    perform cron.unschedule('lcc-outreach');
  end if;
end $$;

select cron.schedule(
  'lcc-outreach',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/outreach',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
