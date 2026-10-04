-- Runs the "reminders" Edge Function every minute.
-- This is the SQL alternative to the Cron page in the Supabase dashboard.
-- Paste it into SQL Editor > New query and click Run. YOUR-PROJECT-REF is the part
-- of your project URL before .supabase.co (the app fills it in when you copy from there).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lcc-reminders') then
    perform cron.unschedule('lcc-reminders');
  end if;
end $$;

select cron.schedule(
  'lcc-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
