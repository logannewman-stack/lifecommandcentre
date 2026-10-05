// Life Command Center: the in-app assistant.
//
// A Supabase Edge Function that lets you talk to Claude inside the app. It checks that
// the request comes from your signed-in account, loads your plan, to-dos, calls, calendar
// and numbers with the service role, and answers with Claude Opus 5.5. Claude can add and
// change to-dos, calendar events, lead notes and DUPR entries through tools.
//
// Deploy it as "assistant" with "Verify JWT" turned off, then add the secret
// ANTHROPIC_API_KEY under Edge Functions → Secrets. The app walks you through it:
// Plan → This device → Assistant.
//
//   GET  ?status=1  → {ok, hasKey, model}
//   POST            → {message, history, tz, today, now} → {reply, actions}
// deno-lint-ignore-file no-explicit-any
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const AREAS = ["Sales", "Build", "Pickleball", "Body", "Money", "Move", "DoD", "Fix", "Other"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (s: string, n: number) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
const dowOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const weekStartOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return addDays(s, -back); };
const num = (v: any) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const money = (n: any) => "$" + Math.round(n || 0).toLocaleString("en-US");
const fmtTap = (t: any) => { let [h, m] = String(t || "0:0").split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${pad(m || 0)} ${ap}`; };
const isDate = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = (s: any) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
function byCol(rows: any[]) { const o: any = {}; for (const r of rows) ((o[r.collection] ||= {})[r.id] = r.data); return o; }

const SYSTEM = `You are the assistant inside Life Command Center, Logan's personal daily-plan app (one user, not a product). You see his live data in the CONTEXT block: today's schedule with what is done, to-dos, call list and pipeline, this week's numbers against targets, the roadmap, money, body and DUPR, and his calendar. You can change things with tools.

How to talk: plain, direct, second person, short. Lead with the answer. Use his real numbers. Do not repeat the whole plan back unless asked. One or two short paragraphs or a tight list is plenty. Latency-sensitive; begin your visible answer immediately.

Doing things: when Logan asks you to add, move, finish, drop or note something, use the tools, then confirm in one line what you did. Dates are relative to the date in the context, in his time zone; "tomorrow", "Friday", "next week" resolve from there. Times for tools are 24-hour HH:MM. If a request is ambiguous (which lead, which day, what time), ask one short question instead of guessing. Never invent data; if it is not in the context, say so.

Coaching: when he asks what to focus on, point at the next block in his schedule, the numbers that are behind for the week, and the leads due now. Sundays are rest days: church, rest and pickleball; nothing counts as late. The big arcs: the Dec 1 gate ($10K saved and $3K a month signed), the move to Scottsdale on Jan 1, DUPR 5.1 by Dec 31, 5.3 by Mar 31, 5.5 by Jun 30, start weight minus 10 lb by Dec 31.`;

const TOOLS: any[] = [
  { name: "add_task", description: "Add a to-do for Logan. Pick the due date (YYYY-MM-DD) from his words: today, tomorrow, Friday, next Monday.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, area: { type: "string", enum: AREAS }, notes: { type: "string" } }, required: ["title", "due"] } },
  { name: "update_task", description: "Change an existing to-do by id (ids are in brackets in the context): rename, move the due date, mark done or not done, drop it, or set notes.", input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, due: { type: "string" }, done: { type: "boolean" }, dropped: { type: "boolean" }, notes: { type: "string" } }, required: ["id"] } },
  { name: "add_event", description: "Put something on Logan's calendar: an appointment, a demo, a tournament, anything with a date and a start time. It shows in his day and nudges him. Times are 24-hour HH:MM in his time zone.", input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" }, where: { type: "string" }, notes: { type: "string" } }, required: ["title", "date", "start"] } },
  { name: "update_event", description: "Change or remove a calendar event by id.", input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, date: { type: "string" }, start: { type: "string" }, end: { type: "string" }, where: { type: "string" }, notes: { type: "string" }, remove: { type: "boolean" } }, required: ["id"] } },
  { name: "add_lead_note", description: "Append a dated note to a lead by id, and optionally set its next step and next date (YYYY-MM-DD).", input_schema: { type: "object", properties: { lead_id: { type: "string" }, note: { type: "string" }, next_step: { type: "string" }, next_date: { type: "string" } }, required: ["lead_id", "note"] } },
  { name: "log_dupr", description: "Record today's DUPR doubles rating, for example 4.912.", input_schema: { type: "object", properties: { rating: { type: "number" } }, required: ["rating"] } },
];

function buildContext(d: any, today: string, now: string, tz: string) {
  const cfg = d.config || {}, profile = cfg.profile || {}, T = profile.targets || {};
  const sched = (cfg.schedule || {}).days || {};
  const days = d.days || {}, tasks = d.tasks || {}, leads = d.leads || {}, events = d.events || {}, sessions = d.sessions || {}, dupr = d.dupr || {}, weeks = d.weeks || {};
  const restDays = Array.isArray(profile.restDays) ? profile.restDays : ["Sun"];
  const dow = dowOf(today), rest = restDays.includes(dow);
  const day = days[today] || {}, checks = day.checks || {}, skips = day.skips || {};
  const dialsFor = (dd: any, region: string) => ((dd && dd.calls) || []).filter((c: any) => c.dial && (!region || c.region === region)).length;
  const lines: string[] = [];
  lines.push(`Today is ${dow} ${today}, ${fmtTap(now)} in ${tz}.${rest ? " Today is a rest day: nothing counts as late." : ""}`);
  const gate = profile.gate || {};
  lines.push(`Logan. Move to Scottsdale on ${profile.moveDate || "?"}. Gate on ${gate.date || "?"}: ${money(gate.saved)} saved and ${money(gate.monthly)} a month signed. DUPR start ${profile.duprStart || "?"}, checkpoints ${(profile.duprCheckpoints || []).map((c: any) => `${c.target} by ${c.date}`).join(", ") || "-"}. Start weight ${profile.startWeight || "?"} lb, goal weight ${profile.goalWeight || "not set"}. Rest days: ${restDays.join(", ")}.`);
  lines.push(`Weekly targets: dials ${T.dials}, owner conversations ${T.convos}, demos ${T.demos}, proposals ${T.proposals}, deals ${T.deals}, mockups ${T.mockups}, DMs ${T.dms}, drill sessions ${T.drill}, competitive sessions ${T.competitive}, gym ${T.gym}, mobility ${T.mobility} min, pro video ${T.proMinutes} min.`);
  const items: any[] = (sched[dow] || []).map((i: any) => ({ ...i }));
  for (const [id, e] of Object.entries(events) as any) if (e && e.date === today) items.push({ key: "ev-" + id, start: e.start, end: e.end, tag: "EVENT", text: `${e.title}${e.where ? " at " + e.where : ""}`, kind: "event", id });
  items.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const status = (i: any) => {
    if (i.kind === "marker") return ""; if (skips[i.key]) return " [skipped]";
    if (i.kind === "checkin") return day.am && day.am.savedAt ? " [done]" : ""; if (i.kind === "checkout") return day.pm && day.pm.savedAt ? " [done]" : "";
    if (i.kind === "calls") return ` [${dialsFor(day, i.region)}/${i.quota} dials${checks[i.key] ? ", done" : ""}]`;
    return checks[i.key] ? " [done]" : "";
  };
  lines.push(`TODAY'S PLAN (${dow}):\n` + (items.map((i: any) => `- ${i.start}-${i.end || i.start} ${i.tag ? i.tag + ": " : ""}${i.text}${status(i)}${i.kind === "event" ? ` (event id ${i.id})` : ""}`).join("\n") || "- nothing scheduled"));
  if (day.am && day.am.savedAt) lines.push(`Morning check-in: weight ${day.am.weight ?? "-"}, sleep ${day.am.sleep ?? "-"} h, energy ${day.am.energy ?? "-"}/10. Top 3: ${(day.am.top3 || []).filter((x: any) => x && x.t).map((x: any) => `${x.t}${x.done ? " (done)" : ""}`).join("; ") || "-"}.${day.am.note ? ` Note: ${day.am.note}` : ""}`);
  else lines.push("Morning check-in: not saved yet today.");
  if (day.pm && day.pm.savedAt) lines.push(`Evening check-out saved. Win: ${day.pm.win || "-"}. Fix for tomorrow: ${day.pm.fix || "-"}.`);
  const tm = addDays(today, 1), tdow = dowOf(tm);
  const tmItems = (sched[tdow] || []).filter((i: any) => i.tag).map((i: any) => `${i.start} ${i.tag}`);
  const evTm = Object.entries(events).filter(([, e]: any) => e && e.date === tm).map(([id, e]: any) => `${e.start} EVENT ${e.title} (id ${id})`);
  lines.push(`TOMORROW (${tdow} ${tm}): ${[...tmItems, ...evTm].join(", ") || "nothing tagged"}.`);
  const open = Object.entries(tasks).map(([id, x]: any) => ({ id, ...x })).filter((x: any) => x.title && !x.done && !x.dropped && x.due).sort((a: any, b: any) => String(a.due).localeCompare(b.due));
  const overdue = open.filter((x: any) => x.due < today), dueToday = open.filter((x: any) => x.due === today), soon = open.filter((x: any) => x.due > today && x.due <= addDays(today, 14));
  const tline = (x: any) => `- [${x.id}] ${x.title} (due ${x.due}${x.area ? ", " + x.area : ""}${x.kind && x.kind !== "task" ? ", " + x.kind : ""}${x.notes ? ", notes: " + String(x.notes).slice(0, 80) : ""})`;
  lines.push(`TO-DOS. Overdue (${overdue.length}):\n${overdue.slice(0, 20).map(tline).join("\n") || "- none"}\nDue today (${dueToday.length}):\n${dueToday.slice(0, 25).map(tline).join("\n") || "- none"}\nNext 14 days (${soon.length}):\n${soon.slice(0, 25).map(tline).join("\n") || "- none"}`);
  const doneToday = Object.entries(tasks).map(([id, x]: any) => ({ id, ...x })).filter((x: any) => x.done && x.doneOn === today);
  if (doneToday.length) lines.push(`Done today: ${doneToday.map((x: any) => x.title).join("; ")}.`);
  const allLeads = Object.entries(leads).map(([id, l]: any) => ({ id, ...l }));
  const due = allLeads.filter((l: any) => l.stage !== "Lost" && l.nextDate && l.nextDate <= today).sort((a: any, b: any) => ((a.type === "Cold" ? 1 : 0) - (b.type === "Cold" ? 1 : 0)) || String(a.nextDate).localeCompare(b.nextDate));
  const stages: any = {}; allLeads.forEach((l: any) => { stages[l.stage || "?"] = (stages[l.stage || "?"] || 0) + 1; });
  const won = allLeads.filter((l: any) => l.stage === "Won");
  const callBlocks = (sched[dow] || []).filter((i: any) => i.kind === "calls").map((i: any) => `${i.region === "IA" ? "Iowa" : i.region === "AZ" ? "Arizona" : i.region || "all"} ${dialsFor(day, i.region)}/${i.quota}`);
  lines.push(`CALLS today: ${callBlocks.join(", ") || "no call blocks today"}. Conversations today ${(day.calls || []).filter((c: any) => c.convo).length}, demos booked today ${(day.calls || []).filter((c: any) => c.demo).length}. Pipeline: ${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}. Won clients: ${won.map((l: any) => `${l.name} (${money(l.monthly)}/mo)`).join(", ") || "none"}.\nLeads due now (${due.length}, showing ${Math.min(due.length, 30)}):\n${due.slice(0, 30).map((l: any) => `- [${l.id}] ${l.name}${l.business ? ", " + l.business : ""} | ${l.type}/${l.stage}${l.region ? "/" + l.region : ""} | next: ${l.nextStep || "-"} (${l.nextDate})${l.phone ? " | " + l.phone : ""}`).join("\n") || "- none"}`);
  const ws = weekStartOf(today);
  const st: any = { dials: 0, convos: 0, demos: 0, dms: 0, proposals: 0, deals: 0, mockups: 0, cash: 0, gym: 0, mobility: 0, drill: 0, competitive: 0, checkins: 0 };
  for (let i = 0; i < 7; i++) {
    const dd = addDays(ws, i); if (dd > today) break;
    const x = days[dd] || {}, pm = x.pm || {}, ch = x.checks || {};
    (x.calls || []).forEach((c: any) => { if (c.dial) st.dials++; if (c.convo) st.convos++; if (c.demo) st.demos++; if (c.dm) st.dms++; });
    st.proposals += num(pm.proposals) || 0; st.deals += num(pm.deals) || 0; st.mockups += num(pm.mockups) || 0; st.cash += num(pm.cash) || 0; st.dms += num(pm.dms) || 0;
    if (x.am && x.am.savedAt) st.checkins++;
    (sched[dowOf(dd)] || []).forEach((i: any) => { if (!ch[i.key]) return; if (i.kind === "gym") st.gym++; if (i.kind === "mobility") st.mobility += i.minutes || 15; });
  }
  Object.values(sessions).forEach((s: any) => { if (s && s.date >= ws && s.date <= today) { if (s.type === "Drill") st.drill++; if (["Competitive", "Tournament"].includes(s.type)) st.competitive++; } });
  lines.push(`THIS WEEK so far (week of ${ws}): dials ${st.dials}/${T.dials}, conversations ${st.convos}/${T.convos}, demos ${st.demos}/${T.demos}, proposals ${st.proposals}/${T.proposals}, deals ${st.deals}/${T.deals}, mockups ${st.mockups}/${T.mockups}, DMs ${st.dms}/${T.dms}, cash in ${money(st.cash)}, drill ${st.drill}/${T.drill}, competitive ${st.competitive}/${T.competitive}, gym ${st.gym}/${T.gym}, mobility ${st.mobility}/${T.mobility} min, check-ins ${st.checkins}/7.`);
  const rm = ((cfg.roadmap || {}).weeks || []).slice().sort((a: any, b: any) => String(a.start).localeCompare(b.start));
  let cur: any = null, next: any = null; rm.forEach((w: any) => { if (w.start <= today) cur = w; else if (!next) next = w; });
  if (cur) lines.push(`ROADMAP this week: ${cur.focus}. Must-dos: ${cur.musts || "-"}`);
  if (next) lines.push(`Next week on the roadmap: ${next.focus}.`);
  const m = cfg.money || {}; const plan = (m.plan || []).slice().sort((a: any, b: any) => String(a.date).localeCompare(b.date)); let target: any = null; plan.forEach((p: any) => { if (p.date <= addDays(ws, 6)) target = p; });
  lines.push(`MONEY: Scottsdale account ${m.scottsdale != null ? money(m.scottsdale) : "not entered yet"}, taxes ${m.taxes != null ? money(m.taxes) : "not entered yet"}${m.updated ? `, updated ${m.updated}` : ""}.${target ? ` Savings plan for ${target.date}: ${money(target.amount)}.` : ""} Rule for every payment: 25% taxes, 50% Scottsdale, 25% bills.`);
  const weights = Object.values(days).filter((x: any) => x && x.date && x.am && num(x.am.weight)).map((x: any) => ({ d: x.date, w: num(x.am.weight) as number })).sort((a: any, b: any) => a.d.localeCompare(b.d));
  const last7 = weights.filter((x: any) => x.d > addDays(today, -7)); const a7 = last7.length ? last7.reduce((a: number, b: any) => a + b.w, 0) / last7.length : null;
  const dl = Object.values(dupr).filter((x: any) => x && x.date && num(x.rating)).sort((a: any, b: any) => a.date.localeCompare(b.date)); const latest: any = dl[dl.length - 1];
  lines.push(`BODY: latest weight ${weights.length ? `${weights[weights.length - 1].w} lb on ${weights[weights.length - 1].d}` : "none yet"}${a7 ? `, 7-day average ${a7.toFixed(1)}` : ""}. DUPR: ${latest ? `${latest.rating} on ${latest.date}` : "no entry yet"}.`);
  const ahead = Object.entries(events).map(([id, e]: any) => ({ id, ...e })).filter((e: any) => e.date >= today && e.date <= addDays(today, 30)).sort((a: any, b: any) => (a.date + a.start).localeCompare(b.date + b.start));
  lines.push(`CALENDAR next 30 days (${ahead.length}):\n${ahead.slice(0, 30).map((e: any) => `- [${e.id}] ${e.date} ${e.start}${e.end ? "-" + e.end : ""} ${e.title}${e.where ? " at " + e.where : ""}`).join("\n") || "- nothing"}`);
  const recent = Object.entries(sessions).map(([id, s]: any) => ({ id, ...s })).filter((s: any) => s.date).sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 5);
  if (recent.length) lines.push(`Recent sessions: ${recent.map((s: any) => `${s.date} ${s.type}${num(s.games) ? ` ${num(s.won) || 0}-${(num(s.games) as number) - (num(s.won) || 0)}` : ""}${s.workOn ? ` (work on: ${s.workOn})` : ""}`).join("; ")}.`);
  const lastWeek = weeks[addDays(ws, -7)] || {}; if (lastWeek.fix || lastWeek.leak) lines.push(`Last Sunday review: leak "${lastWeek.leak || "-"}", fix "${lastWeek.fix || "-"}".`);
  return lines.join("\n\n");
}

async function runTool(admin: any, uid: string, name: string, input: any, today: string, d: any): Promise<{ result: string; action?: string }> {
  const write = async (col: string, id: string, data: any) => {
    const { error } = await admin.from("docs").upsert({ owner: uid, collection: col, id, data, updated_at: new Date().toISOString() }, { onConflict: "owner,collection,id" });
    if (error) throw new Error(error.message);
    (d[col] ||= {})[id] = data;
  };
  const del = async (col: string, id: string) => {
    const { error } = await admin.from("docs").delete().match({ owner: uid, collection: col, id });
    if (error) throw new Error(error.message);
    if (d[col]) delete d[col][id];
  };
  switch (name) {
    case "add_task": {
      const title = String(input.title || "").trim(), due = isDate(input.due) ? input.due : today;
      if (!title) return { result: "error: title is required" };
      const id = "u-" + Date.now().toString(36);
      await write("tasks", id, { title, due, origDue: due, area: AREAS.includes(input.area) ? input.area : "Other", notes: String(input.notes || "").trim(), done: false, kind: "task", createdAt: Date.now() });
      return { result: `added task ${id}`, action: `Added to-do: ${title} (due ${due})` };
    }
    case "update_task": {
      const x = (d.tasks || {})[input.id]; if (!x) return { result: "error: no task with that id" };
      const nx: any = { ...x };
      if (typeof input.title === "string" && input.title.trim()) nx.title = input.title.trim();
      if (isDate(input.due)) { nx.origDue = x.origDue || x.due; nx.due = input.due; }
      if (typeof input.done === "boolean") { nx.done = input.done; nx.doneOn = input.done ? today : null; }
      if (typeof input.dropped === "boolean") { nx.dropped = input.dropped; if (input.dropped) nx.droppedOn = today; }
      if (typeof input.notes === "string") nx.notes = input.notes.trim();
      await write("tasks", input.id, nx);
      return { result: "updated", action: `${nx.dropped ? "Dropped" : nx.done ? "Completed" : "Updated"} to-do: ${nx.title}` };
    }
    case "add_event": {
      const title = String(input.title || "").trim();
      if (!title || !isDate(input.date) || !isTime(input.start)) return { result: "error: title, date (YYYY-MM-DD) and start (HH:MM, 24-hour) are required" };
      const id = "ev-" + Date.now().toString(36);
      await write("events", id, { title, date: input.date, start: input.start, end: isTime(input.end) ? input.end : "", where: String(input.where || "").trim(), notes: String(input.notes || "").trim(), createdAt: Date.now() });
      return { result: `added event ${id}`, action: `Added to calendar: ${title}, ${input.date} ${fmtTap(input.start)}` };
    }
    case "update_event": {
      const e = (d.events || {})[input.id]; if (!e) return { result: "error: no event with that id" };
      if (input.remove) { await del("events", input.id); return { result: "removed", action: `Removed event: ${e.title}` }; }
      const ne: any = { ...e };
      if (typeof input.title === "string" && input.title.trim()) ne.title = input.title.trim();
      if (isDate(input.date)) ne.date = input.date; if (isTime(input.start)) ne.start = input.start; if (isTime(input.end)) ne.end = input.end;
      if (typeof input.where === "string") ne.where = input.where.trim(); if (typeof input.notes === "string") ne.notes = input.notes.trim();
      await write("events", input.id, ne);
      return { result: "updated", action: `Updated event: ${ne.title}` };
    }
    case "add_lead_note": {
      const l = (d.leads || {})[input.lead_id]; if (!l) return { result: "error: no lead with that id" };
      const note = String(input.note || "").trim(); if (!note) return { result: "error: note is required" };
      const nl: any = { ...l, notes: (l.notes ? l.notes + "\n" : "") + `${today.slice(5).replace("-", "/")}: ${note}`, updatedAt: Date.now() };
      if (typeof input.next_step === "string" && input.next_step.trim()) nl.nextStep = input.next_step.trim();
      if (isDate(input.next_date)) nl.nextDate = input.next_date;
      await write("leads", input.lead_id, nl);
      return { result: "noted", action: `Noted on ${l.name}` };
    }
    case "log_dupr": {
      const r = num(input.rating); if (!r || r < 1 || r > 8) return { result: "error: rating must be between 1 and 8" };
      await write("dupr", today, { date: today, rating: r });
      return { result: "logged", action: `Logged DUPR ${r}` };
    }
  }
  return { result: "error: unknown tool" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (url.searchParams.has("status")) return json({ ok: true, hasKey: !!apiKey, model: MODEL });
  if (req.method !== "POST") return json({ ok: true, hint: "POST {message, history, tz, today, now}" });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sign in to use the assistant." }, 401);
    const supaUrl = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const { data: userData, error: userErr } = await createClient(supaUrl, anon).auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Your sign-in was not accepted. Sign out and back in, then try again." }, 401);
    const uid = userData.user.id;
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set yet. Add it under Edge Functions › Secrets (step 3), then try again." }, 500);
    let body: any = {}; try { body = await req.json(); } catch (_e) { body = {}; }
    const message = String(body.message || "").trim();
    if (!message) return json({ error: "Say something first." }, 400);
    const today = isDate(body.today) ? body.today : new Date().toISOString().slice(0, 10);
    const now = isTime(body.now) ? body.now : "12:00";
    const tz = String(body.tz || "UTC").slice(0, 60);

    const admin = createClient(supaUrl, service, { auth: { persistSession: false } });
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("docs").select("collection,id,data").eq("owner", uid).range(from, from + 999);
      if (error) return json({ error: "Could not read your data: " + error.message }, 500);
      rows.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    const d = byCol(rows);
    const context = buildContext(d, today, now, tz);

    const history: any[] = (Array.isArray(body.history) ? body.history : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-16).map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    while (history.length && history[0].role !== "user") history.shift();
    const messages: any[] = [...history, { role: "user", content: message }];

    const client = new Anthropic({ apiKey });
    const actions: string[] = [];
    let reply = "";
    for (let round = 0; round < 6; round++) {
      const resp: any = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: "CONTEXT (live, in Logan's time zone):\n\n" + context },
        ],
        tools: TOOLS,
        messages,
      });
      if (resp.stop_reason === "refusal") { reply = reply || "I can't help with that one."; break; }
      const text = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      if (text) reply = text;
      if (resp.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: resp.content }); continue; }
      const uses = (resp.content || []).filter((b: any) => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || !uses.length) break;
      messages.push({ role: "assistant", content: resp.content });
      const results: any[] = [];
      for (const u of uses) {
        let r: { result: string; action?: string };
        try { r = await runTool(admin, uid, u.name, u.input || {}, today, d); } catch (e: any) { r = { result: "error: " + ((e && e.message) || String(e)) }; }
        if (r.action) actions.push(r.action);
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.result, is_error: r.result.startsWith("error") });
      }
      messages.push({ role: "user", content: results });
    }
    return json({ reply: reply || (actions.length ? "Done." : "I didn't get an answer back. Try again."), actions, model: MODEL });
  } catch (e: any) {
    console.error(e);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY under Edge Functions › Secrets." }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Anthropic is rate-limiting right now. Try again in a minute." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `Anthropic answered ${e.status}: ${e.message}` }, 502);
    return json({ error: String((e && e.message) || e) }, 500);
  }
});
