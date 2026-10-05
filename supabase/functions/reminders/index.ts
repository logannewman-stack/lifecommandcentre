// Life Command Center: phone reminders.
//
// A Supabase Edge Function that runs every minute, looks at your schedule in your
// own time zone, and sends a Web Push nudge a few minutes before each block starts.
// Deploy it as "reminders" with "Verify JWT" turned off (the app guides you through
// it: Plan → This device → Phone notifications), then schedule it every minute
// with the Cron page or cron.sql next to this file.
//
//   GET  ?public_key=1   → the VAPID public key the app subscribes with
//   GET  ?status=1       → {lastRun, subscriptions, version} so the app can confirm the setup
//   POST                 → send whatever is due right now (the cron job calls this)
//   POST ?test=<device>  → send a test notification to one device
//
// Keys are generated on the first run and kept in public.push_vapid (schema.sql).
// After an app update that changes this file, paste the new code over the old one and Deploy;
// the app's notifications sheet says when that is needed.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

// ---- pure logic (plain JavaScript; the Node test imports this section) ----
export const FN_VERSION = 2;
export const KIND_LABEL: any = { marker: "", task: "Task", checkin: "Check-in", checkout: "Check-out", calls: "Calls", session: "Court time", gym: "Gym", mobility: "Mobility", watch: "Pro video", dupr: "DUPR", event: "Event" };
export const ONEOFF_TAG: any = { event: "EVENT", task: "TO-DO", gym: "GYM", mobility: "MOBILITY", watch: "STUDY", marker: "NOTE" };
// Weekday, local date and minutes since midnight in the device's time zone.
export function localClock(tz: any, date: any = new Date()) {
  let parts: any[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch (_e) {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  }
  const get = (t: string) => (parts.find((p) => p.type === t) || {}).value || "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { dow: get("weekday"), date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(hour) * 60 + Number(get("minute")) };
}
export const toMin = (t: any) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const fmtTap = (t: any) => { let [h, m] = String(t).split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${String(m || 0).padStart(2, "0")} ${ap}`; };
// A day's blocks: the weekly plan for that weekday with the date's one-off moves
// (day.moves = {key: {start, end}}), plus one-off items from the events collection.
export function itemsForDay(schedule: any, dow: any, day: any, events: any) {
  const moves = (day && day.moves) || {};
  const base = ((((schedule || {}).days || {})[dow]) || []).map((i: any) => { const m = i && moves[i.key]; return m && m.start ? { ...i, start: m.start, end: m.end || i.end } : i; });
  const extra = (events || []).filter((e: any) => e && e.start).map((e: any) => {
    const kind = e.kind && e.kind !== "event" ? e.kind : "event";
    return { key: "ev-" + e.id, start: e.start, end: e.end, kind, oneoff: true, text: `${e.title}${e.where ? " at " + e.where : ""}`,
      tag: kind === "session" ? (e.sessionType || "Court time") : (ONEOFF_TAG[kind] || "EVENT") };
  });
  return [...base, ...extra];
}
// The nudges one device should get this minute. `sent` holds ids already delivered.
export function dueReminders({ schedule, profile, day, clock, lead, sent, events }: any) {
  const items = itemsForDay(schedule, clock.dow, day, events);
  const restDays = Array.isArray((profile || {}).restDays) ? profile.restDays : ["Sun"];
  const rest = restDays.includes(clock.dow);
  const checks = (day && day.checks) || {}, skips = (day && day.skips) || {};
  const out: any[] = [];
  for (const i of items) {
    if (!i || !i.start) continue;
    if (i.kind === "marker" && !i.tag) continue;
    if (rest && !i.oneoff && !["checkin", "checkout", "session"].includes(i.kind)) continue;
    const fire = toMin(i.start) - (Number(lead) || 0);
    if (clock.minutes < fire || clock.minutes > fire + 1) continue; // this minute, or the next if cron ran late
    const id = `${clock.date}|${i.key}`;
    if (sent && sent[id]) continue;
    if (checks[i.key] || skips[i.key]) continue;
    if (i.kind === "checkin" && day && day.am && day.am.savedAt) continue;
    if (i.kind === "checkout" && day && day.pm && day.pm.savedAt) continue;
    const label = i.tag || KIND_LABEL[i.kind] || "Block";
    let body = String(i.text || "");
    if (i.kind === "calls") {
      const dials = ((day && day.calls) || []).filter((c: any) => c.dial && (!i.region || c.region === i.region)).length;
      body = `${dials}/${i.quota || 0} ${i.region === "IA" ? "Iowa" : i.region === "AZ" ? "Arizona" : ""} dials so far. `.replace("  ", " ") + body;
    }
    if (body.length > 160) body = body.slice(0, 157) + "…";
    out.push({
      id, key: i.key,
      title: `${label} · ${fmtTap(i.start)}${Number(lead) ? ` (in ${Number(lead)} min)` : ""}`,
      body, tag: "lcc-" + i.key,
      url: i.kind === "calls" ? "/#calls" : i.kind === "dupr" ? "/#log" : "/#today",
      oneoff: !!i.oneoff,
    });
  }
  return out;
}
// Drop delivered ids older than two days so the log stays small.
export function pruneSent(sent: any, today: string) {
  const keep: any = {};
  const limit = new Date(today + "T00:00:00Z").getTime() - 2 * 86400000;
  for (const [k, v] of Object.entries(sent || {})) {
    const d = new Date(k.split("|")[0] + "T00:00:00Z").getTime();
    if (Number.isFinite(d) && d >= limit) keep[k] = v;
  }
  return keep;
}
// ---- end pure logic ----

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function loadKeys(admin: any) {
  const { data, error } = await admin.from("push_vapid").select("keys").eq("id", 1).maybeSingle();
  if (error) throw new Error(`The push_vapid table is missing (${error.message}). Run supabase/schema.sql again in the SQL Editor.`);
  let exported = data?.keys;
  if (!exported) {
    const fresh = await webpush.generateVapidKeys({ extractable: true });
    exported = await webpush.exportVapidKeys(fresh);
    const ins = await admin.from("push_vapid").insert({ id: 1, keys: exported });
    if (ins.error) throw new Error("Could not save the keys: " + ins.error.message);
  }
  const keys = await webpush.importVapidKeys(exported, { extractable: false });
  const publicKey = await webpush.exportApplicationServerKey(keys);
  return { keys, publicKey };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { keys, publicKey } = await loadKeys(admin);
    if (url.searchParams.has("public_key")) return json({ publicKey });
    if (url.searchParams.has("status")) {
      const { data } = await admin.from("push_vapid").select("last_run").eq("id", 1).maybeSingle();
      const { count } = await admin.from("docs").select("id", { count: "exact", head: true }).eq("collection", "push");
      return json({ ok: true, lastRun: data?.last_run || null, subscriptions: count || 0, version: FN_VERSION });
    }
    if (req.method !== "POST") return json({ ok: true, hint: "POST to send due reminders" });

    const test = url.searchParams.get("test");
    const { data: rows, error } = await admin.from("docs").select("owner,collection,id,data").in("collection", ["push", "pushlog", "config", "days", "events"]);
    if (error) throw error;
    const byOwner: any = {};
    for (const r of rows || []) {
      const o = (byOwner[r.owner] ||= { push: {}, pushlog: {}, config: {}, days: {}, events: {} });
      (o[r.collection] ||= {})[r.id] = r.data;
    }
    const as = await webpush.ApplicationServer.new({ contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:reminders@life-command-center.app", vapidKeys: keys });
    let sent = 0, failed = 0, disabled = 0;
    for (const [owner, d] of Object.entries(byOwner) as any) {
      for (const [device, sub] of Object.entries(d.push) as any) {
        if (!sub || !sub.endpoint || !sub.keys || sub.enabled === false) continue;
        if (test && device !== test) continue;
        const clock = localClock(sub.tz, new Date());
        const log = d.pushlog[device] || { sent: {} };
        const notes = test
          ? [{ id: "test-" + Date.now(), key: "test", title: "Reminders are on", body: "You'll get a nudge like this before each block. Tap it to open the app.", tag: "lcc-test", url: "/#today" }]
          : dueReminders({ schedule: d.config.schedule, profile: d.config.profile, day: d.days[clock.date], clock, lead: sub.lead, sent: log.sent,
              events: Object.entries(d.events).filter(([, e]: any) => e && e.date === clock.date).map(([id, e]: any) => ({ id, ...e })) });
        if (!notes.length) continue;
        const subscriber = as.subscribe({ endpoint: sub.endpoint, keys: sub.keys });
        const sentIds: any = { ...(log.sent || {}) };
        for (const n of notes) {
          try {
            const text = JSON.stringify(n);
            if (typeof (subscriber as any).pushTextMessage === "function") await (subscriber as any).pushTextMessage(text, { ttl: 900, urgency: webpush.Urgency.High });
            else await (subscriber as any).pushMessage(new TextEncoder().encode(text), { ttl: 900, urgency: webpush.Urgency.High });
            sent++; if (!test) sentIds[n.id] = Date.now();
          } catch (e: any) {
            failed++;
            const status = e && e.response && e.response.status;
            if (status === 404 || status === 410) {
              disabled++;
              await admin.from("docs").update({ data: { ...sub, enabled: false, error: "This device's subscription expired. Turn notifications on again." }, updated_at: new Date().toISOString() })
                .match({ owner, collection: "push", id: device });
              break;
            }
            console.error("push failed", device, e && (e.message || e));
          }
        }
        if (!test) {
          await admin.from("docs").upsert({ owner, collection: "pushlog", id: device, data: { sent: pruneSent(sentIds, clock.date) }, updated_at: new Date().toISOString() }, { onConflict: "owner,collection,id" });
        }
      }
    }
    if (!test) await admin.from("push_vapid").update({ last_run: new Date().toISOString() }).eq("id", 1);
    return json({ ok: true, sent, failed, disabled, test: !!test });
  } catch (e: any) {
    console.error(e);
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
