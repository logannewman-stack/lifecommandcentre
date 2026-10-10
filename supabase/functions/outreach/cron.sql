-- Runs the "outreach" Edge Function on two schedules:
--   lcc-outreach       every 10 minutes: reads new replies, moves leads through the pipeline and sends
--                      at most one email, only on your sending days and hours, so a day's emails are spread out.
--   lcc-outreach-find  every 15 minutes: the finder adds new leads until it reaches the day's target
--                      (it does nothing until you turn it on in the app).
-- Paste this into SQL Editor > New query and click Run. Running it again is safe.
-- YOUR-PROJECT-REF is the part of your project URL before .supabase.co (the app fills it in).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lcc-outreach') then
    perform cron.unschedule('lcc-outreach');
  end if;
  if exists (select 1 from cron.job where jobname = 'lcc-outreach-find') then
    perform cron.unschedule('lcc-outreach-find');
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

select cron.schedule(
  'lcc-outreach-find',
  '7,22,37,52 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/outreach?job=find',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"job": "find"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
