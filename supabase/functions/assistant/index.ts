// Life Command Center: the in-app assistant.
//
// A Supabase Edge Function that lets you talk to Claude inside the app. It checks that
// the request comes from your signed-in account, loads your plan, to-dos, calls, calendar
// and numbers with the service role, and answers with Claude Opus 5.5. Through tools it can
// move, skip, add and change blocks (for one day or every week), check things off, add
// to-dos and one-off items, note leads, and log your check-in, sessions and DUPR.
//
// Deploy it as "assistant" with "Verify JWT" turned off, then add the secret
// ANTHROPIC_API_KEY under Edge Functions → Secrets. The app walks you through it:
// Plan → This device → Assistant. After an update, paste the new code over the old one.
//
//   GET  ?status=1  → {ok, hasKey, model, version}
//   POST            → {message, history, tz, today, now} → {reply, actions}
// deno-lint-ignore-file no-explicit-any
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ---- pure logic (no imports; the Deno test imports this section) ----
export const FN_VERSION = 5;
export const MODEL = "claude-opus-5-5";
const AREAS = ["Sales", "Build", "Pickleball", "Body", "Money", "Move", "DoD", "Fix", "Other"];
const SESSION_TYPES = ["Drill", "Competitive", "Rec play", "Tournament", "Lesson"];
const WEEKLY_KINDS = ["task", "session", "gym", "mobility", "watch", "calls", "marker"];
const ONEOFF_KINDS = ["event", "session", "task", "gym", "mobility", "watch", "marker"];
const ONEOFF_TAG: any = { event: "EVENT", task: "TO-DO", gym: "GYM", mobility: "MOBILITY", watch: "STUDY", marker: "NOTE", calls: "CALLS" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_LONG: any = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };
const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (s: string, n: number) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
const dowOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const weekStartOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return addDays(s, -back); };
const num = (v: any) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const money = (n: any) => "$" + Math.round(n || 0).toLocaleString("en-US");
const fmtTap = (t: any) => { let [h, m] = String(t || "0:0").split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${pad(m || 0)} ${ap}`; };
const fmtDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };
const isDate = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = (s: any) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const toMin = (t: any) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const hhmm = (m: number) => { m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const byStart = (a: any, b: any) => toMin(a.start) - toMin(b.start);
const clip = (s: any, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const str = (v: any) => (typeof v === "string" ? v.trim() : "");
const uid36 = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
// Same rule as the app and patch_doc: objects merge, everything else (arrays too) replaces.
export function merge(a: any, b: any): any { const out: any = isObj(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) ? merge(out[k], v) : v; return out; }
export function byCol(rows: any[]) { const o: any = {}; for (const r of rows) ((o[r.collection] ||= {})[r.id] = r.data); return o; }
const weekdays = (v: any) => (Array.isArray(v) ? v : [v]).map((x: any) => String(x || "").slice(0, 3)).map((x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).filter((x: string) => WEEK.includes(x)).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i);
function daysLabel(days: string[]) {
  const set = WEEK.filter((x) => days.includes(x));
  if (set.length === 7) return "every day";
  if (set.join() === "Mon,Tue,Wed,Thu,Fri") return "every weekday";
  if (set.length === 1) return "every " + DOW_LONG[set[0]];
  return set.slice(0, -1).join(", ") + " and " + set[set.length - 1];
}
const nameOf = (i: any) => i.tag || clip(String(i.text || "").split(/[.:,]/)[0], 32) || "that block";
// A one-off item (the events collection) as a block of the day's plan.
export function oneoffItem(id: string, e: any) {
  const kind = e.kind && e.kind !== "event" ? e.kind : "event";
  const mins = Math.max(0, toMin(e.end || e.start) - toMin(e.start));
  return { key: "ev-" + id, eventId: id, oneoff: true, start: e.start, end: e.end || e.start, kind,
    tag: e.tag || (kind === "session" ? (e.sessionType || "Court time") : (ONEOFF_TAG[kind] || "EVENT")),
    text: e.title + (e.where ? " at " + e.where : ""),
    sessionType: kind === "session" ? (e.sessionType || "Drill") : undefined,
    hours: kind === "session" ? (Math.round(mins / 30) / 2 || 1) : undefined,
    quota: kind === "calls" ? (Number(e.quota) || 10) : undefined, region: kind === "calls" ? (e.region || "") : undefined,
    movedFromDay: e.from && e.from.date ? e.from.date : undefined };
}
// A date's plan: the weekly plan for its weekday with that date's moves, plus one-off items.
export function itemsForDay(d: any, date: string) {
  const sched = (((d.config || {}).schedule || {}).days || {})[dowOf(date)] || [];
  const mv = (((d.days || {})[date] || {}).moves) || {};
  const base = sched.map((i: any) => { const m = mv[i.key]; return m && m.start ? { ...i, start: m.start, end: m.end || i.end, movedFrom: i.start } : i; });
  const extra = Object.entries(d.events || {}).filter(([, e]: any) => e && e.date === date && e.start).map(([id, e]: any) => oneoffItem(id, e));
  return [...base, ...extra].sort(byStart);
}

export const SYSTEM = `You are the assistant inside Life Command Center, Logan's personal daily-plan app (one user, not a product). The CONTEXT block holds Logan's live data: today's and tomorrow's plan with block keys in [brackets], one-off changes for the coming week, the weekly plan, to-dos, calls and pipeline, this week's numbers against targets, roadmap, money, body, pickleball sessions and calendar. You can change things with tools.

How to talk: plain, direct, second person, short. Lead with the answer. Use the real numbers. One or two short paragraphs or a tight list is plenty. Begin the visible answer immediately.

The schedule has two layers:
- The weekly plan repeats every week, one list per weekday.
- One-off changes apply to a single date: move_block (a new time, or to_date to move it to another day), skip_block (cancel it for that date), add_event (an extra item that date).
"Cancel", "skip", "drop it today" and "not doing X today" all mean skip_block. When a whole day is not happening (sick, traveling, "take today off"), use set_day_off: nothing that date counts as late or turns into a make-up. "Reschedule", "move" and "push back" mean move_block. When Logan names a date or says today, tomorrow or a weekday, change only that date. Change the weekly plan (edit_weekly_block, add_weekly_block, remove_weekly_block) only when Logan says every, always, each week or from now on, or asks to change the routine. Use the keys exactly as the context shows them.

When Logan says how a day is really going ("woke up at 8, pickleball at 11, meeting at 1, pickleball at 4"), rebuild that day: add what has a time with add_event, then move the day's remaining blocks into the free time closest to their usual time with move_block (calls first, then build and other work, then the rest), shorten a long block to fit when that helps, and cancel what doesn't fit with skip_block. Logan's own pickleball replaces the day's planned court time, so cancel that. Then say in a short list what was added, moved and canceled.

When you move or add something, look at that day's plan for overlaps. If Logan asked to make room, move or skip the blocks in the way yourself; otherwise say in one line what it overlaps and offer to fix it. Pickleball is court time: add it with kind "session" and the right session_type so it counts toward the week. When Logan says something is done, check it off with check_block, then use log_session for a record or notes. Use log_checkin for weight, sleep, energy, top 3 and the morning note.

Doing things: use the tools, then confirm in a line or two what changed, with times. Dates resolve from today's date in the context ("tomorrow", "Friday", "next week") and times for tools are 24-hour HH:MM in Logan's time zone. If a request is ambiguous (which lead, which day, what time), ask one short question instead of guessing. Never invent data; if it is not in the context, say so.

Coaching: when Logan asks what to focus on, point at the next block, the numbers behind for the week and the leads due now. Sundays are rest days: church, rest and pickleball; nothing counts as late. The big arcs: the Dec 1 gate ($10K saved and $3K a month signed), the move to Scottsdale on Jan 1, DUPR 5.1 by Dec 31, 5.3 by Mar 31, 5.5 by Jun 30, start weight minus 10 lb by Dec 31.`;

const DAYS_PROP = { type: "array", items: { type: "string", enum: WEEK }, description: "Weekdays, like [\"Mon\",\"Wed\"]" };
export const TOOLS: any[] = [
  { name: "move_block", description: "Reschedule a block on one date only; the weekly plan stays the same. key is the [key] from the plan. If end is left out the block keeps its length. reset: true puts it back at its usual time. to_date moves it to another day instead: it is canceled on date and added there as a one-off (start optional, it keeps its time). Works for one-off items (keys starting ev-) too.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, key: { type: "string" }, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" }, to_date: { type: "string", description: "YYYY-MM-DD, to move it to another day" }, reset: { type: "boolean" } }, required: ["date", "key"] } },
  { name: "skip_block", description: "Cancel a block for one date (no make-up is created), or put it back with skip: false.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, key: { type: "string" }, skip: { type: "boolean" } }, required: ["date", "key"] } },
  { name: "set_day_off", description: "Make a whole date a day off, like a rest day: nothing that date counts as late and nothing turns into a make-up. off: false makes the date count again.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, off: { type: "boolean" } }, required: ["date"] } },
  { name: "check_block", description: "Mark a block in today's plan done, or not done with done: false. Checking off court time logs a session.", input_schema: { type: "object", properties: { key: { type: "string" }, done: { type: "boolean" } }, required: ["key"] } },
  { name: "add_event", description: "Add a one-off item to one date: an appointment, a demo, a flight, extra pickleball or a gym session. It shows in that day's plan and nudges Logan. Use kind \"session\" with session_type for pickleball so it counts toward the week. Times are 24-hour HH:MM; end defaults to an hour after start.", input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" }, kind: { type: "string", enum: ONEOFF_KINDS }, session_type: { type: "string", enum: SESSION_TYPES }, label: { type: "string", description: "Optional short tag shown in caps, like DEMO" }, where: { type: "string" }, notes: { type: "string" } }, required: ["title", "date", "start"] } },
  { name: "update_event", description: "Change or remove a one-off item by its id (the part after ev- in its key).", input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, date: { type: "string" }, start: { type: "string" }, end: { type: "string" }, kind: { type: "string", enum: ONEOFF_KINDS }, session_type: { type: "string", enum: SESSION_TYPES }, where: { type: "string" }, notes: { type: "string" }, remove: { type: "boolean" } }, required: ["id"] } },
  { name: "edit_weekly_block", description: "Change a block of the weekly plan on the listed weekdays: times, label, details, type or the make-up flag. Only the fields you pass change; a new start without an end keeps each day's length. Weekdays that don't have the block get a copy.", input_schema: { type: "object", properties: { key: { type: "string" }, days: DAYS_PROP, start: { type: "string" }, end: { type: "string" }, label: { type: "string" }, details: { type: "string" }, kind: { type: "string", enum: WEEKLY_KINDS }, session_type: { type: "string", enum: SESSION_TYPES }, carry: { type: "boolean", description: "If missed, it comes back the next day as a make-up" } }, required: ["key", "days"] } },
  { name: "add_weekly_block", description: "Add a new block to the weekly plan on the listed weekdays.", input_schema: { type: "object", properties: { days: DAYS_PROP, start: { type: "string" }, end: { type: "string" }, label: { type: "string", description: "Short name shown in caps, like GYM" }, details: { type: "string" }, kind: { type: "string", enum: WEEKLY_KINDS }, session_type: { type: "string", enum: SESSION_TYPES }, carry: { type: "boolean" } }, required: ["days", "start", "label"] } },
  { name: "remove_weekly_block", description: "Take a block out of the weekly plan on the listed weekdays.", input_schema: { type: "object", properties: { key: { type: "string" }, days: DAYS_PROP }, required: ["key", "days"] } },
  { name: "add_task", description: "Add a to-do. Pick the due date (YYYY-MM-DD) from Logan's words: today, tomorrow, Friday, next Monday.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, area: { type: "string", enum: AREAS }, notes: { type: "string" } }, required: ["title", "due"] } },
  { name: "update_task", description: "Change an existing to-do by id (ids are in brackets): rename, move the due date, mark done or not done, drop it, or set notes.", input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, due: { type: "string" }, done: { type: "boolean" }, dropped: { type: "boolean" }, notes: { type: "string" } }, required: ["id"] } },
  { name: "add_lead_note", description: "Append a dated note to a lead by id, and optionally set its next step and next date (YYYY-MM-DD).", input_schema: { type: "object", properties: { lead_id: { type: "string" }, note: { type: "string" }, next_step: { type: "string" }, next_date: { type: "string" } }, required: ["lead_id", "note"] } },
  { name: "log_checkin", description: "Save today's morning check-in from what Logan says. Only the fields you pass change.", input_schema: { type: "object", properties: { weight: { type: "number" }, sleep: { type: "number", description: "Hours" }, energy: { type: "number", description: "1 to 10" }, top3: { type: "array", items: { type: "string" }, maxItems: 3 }, note: { type: "string" } } } },
  { name: "log_session", description: "Log a pickleball session, or add the record and notes to one already logged (ids are in brackets under SESSIONS). Checking off court time already logs a session, so update that one instead of adding a second.", input_schema: { type: "object", properties: { id: { type: "string" }, date: { type: "string" }, type: { type: "string", enum: SESSION_TYPES }, hours: { type: "number" }, games: { type: "number" }, won: { type: "number" }, rated: { type: "boolean" }, partner: { type: "string" }, opponents: { type: "string" }, went_well: { type: "string" }, work_on: { type: "string" }, notes: { type: "string" } } } },
  { name: "log_dupr", description: "Record today's DUPR doubles rating, for example 4.912.", input_schema: { type: "object", properties: { rating: { type: "number" } }, required: ["rating"] } },
];

export function buildContext(d: any, today: string, now: string, tz: string) {
  const cfg = d.config || {}, profile = cfg.profile || {}, T = profile.targets || {};
  const sched = (cfg.schedule || {}).days || {};
  const days = d.days || {}, tasks = d.tasks || {}, leads = d.leads || {}, events = d.events || {}, sessions = d.sessions || {}, dupr = d.dupr || {}, weeks = d.weeks || {};
  const restDays = Array.isArray(profile.restDays) ? profile.restDays : ["Sun"];
  const dow = dowOf(today), day = days[today] || {}, checks = day.checks || {};
  const rest = restDays.includes(dow) || !!day.off;
  const dialsFor = (dd: any, region: string) => ((dd && dd.calls) || []).filter((c: any) => c.dial && (!region || c.region === region)).length;
  const lines: string[] = [];
  lines.push(`Today is ${DOW_LONG[dow]} ${today}, ${fmtTap(now)} in ${tz}.${day.off ? " Today is a day off: nothing counts as late." : rest ? " Today is a rest day: nothing counts as late." : ""}`);
  const gate = profile.gate || {};
  lines.push(`Logan. Move to Scottsdale on ${profile.moveDate || "?"}. Gate on ${gate.date || "?"}: ${money(gate.saved)} saved and ${money(gate.monthly)} a month signed. DUPR start ${profile.duprStart || "?"}, checkpoints ${(profile.duprCheckpoints || []).map((c: any) => `${c.target} by ${c.date}`).join(", ") || "-"}. Start weight ${profile.startWeight || "?"} lb, goal weight ${profile.goalWeight || "not set"}. Rest days: ${restDays.join(", ")}.`);
  lines.push(`Weekly targets: dials ${T.dials}, owner conversations ${T.convos}, demos ${T.demos}, proposals ${T.proposals}, deals ${T.deals}, mockups ${T.mockups}, DMs ${T.dms}, drill sessions ${T.drill}, competitive sessions ${T.competitive}, gym ${T.gym}, mobility ${T.mobility} min, pro video ${T.proMinutes} min.`);
  const status = (i: any) => {
    if (i.kind === "marker") return "";
    if ((day.skips || {})[i.key]) return " [off today]";
    if (i.kind === "checkin") return day.am && day.am.savedAt ? " [done]" : "";
    if (i.kind === "checkout") return day.pm && day.pm.savedAt ? " [done]" : "";
    if (i.kind === "calls") return ` [${dialsFor(day, i.region)}/${i.quota} dials${checks[i.key] ? ", done" : ""}]`;
    return checks[i.key] ? " [done]" : "";
  };
  const planLine = (i: any, date: string, withStatus: boolean) => `- ${i.start}-${i.end || i.start} [${i.key}] ${i.tag ? i.tag + ": " : ""}${clip(i.text, 90)}${i.kind === "session" ? ` (court time: ${i.sessionType || "Drill"})` : ""}${withStatus ? status(i) : (((days[date] || {}).skips || {})[i.key] ? " [off this date]" : "")}${i.movedFrom ? ` (moved from ${i.movedFrom}, this date only)` : ""}${i.oneoff ? " (one-off)" : ""}`;
  lines.push(`TODAY'S PLAN (${dow} ${today}):\n` + (itemsForDay(d, today).map((i: any) => planLine(i, today, true)).join("\n") || "- nothing planned"));
  if (day.am && day.am.savedAt) lines.push(`Morning check-in: weight ${day.am.weight ?? "-"}, sleep ${day.am.sleep ?? "-"} h, energy ${day.am.energy ?? "-"}/10. Top 3: ${(day.am.top3 || []).filter((x: any) => x && x.t).map((x: any) => `${x.t}${x.done ? " (done)" : ""}`).join("; ") || "-"}.${day.am.note ? ` Note: ${day.am.note}` : ""}`);
  else lines.push("Morning check-in: not saved yet today.");
  if (day.pm && day.pm.savedAt) lines.push(`Evening check-out saved. Win: ${day.pm.win || "-"}. Fix for tomorrow: ${day.pm.fix || "-"}.`);
  const tm = addDays(today, 1);
  lines.push(`TOMORROW'S PLAN (${dowOf(tm)} ${tm}${(days[tm] || {}).off ? ", a day off" : ""}):\n` + (itemsForDay(d, tm).map((i: any) => planLine(i, tm, false)).join("\n") || "- nothing planned"));
  const later: string[] = [];
  for (let n = 2; n <= 7; n++) {
    const dd = addDays(today, n), x = days[dd] || {}, bits: string[] = x.off ? ["day off"] : [];
    for (const [k, m] of Object.entries(x.moves || {}) as any) if (m && m.start) bits.push(`[${k}] moved to ${m.start}-${m.end || m.start}`);
    for (const [k, v] of Object.entries(x.skips || {})) if (v) bits.push(`[${k}] off`);
    for (const [id, e] of Object.entries(events) as any) if (e && e.date === dd && e.start) bits.push(`[ev-${id}] ${e.start}-${e.end || e.start} ${e.title}${e.kind && e.kind !== "event" ? ` (${e.kind === "session" ? e.sessionType || "court time" : e.kind})` : ""}`);
    if (bits.length) later.push(`- ${dowOf(dd)} ${dd}: ${bits.join("; ")}`);
  }
  lines.push(`ONE-OFF CHANGES for the 6 days after tomorrow:\n${later.join("\n") || "- none"}`);
  lines.push("WEEKLY PLAN (repeats every week; [key] start-end LABEL: details):\n" + WEEK.map((w) => `${w}${restDays.includes(w) ? " (rest day)" : ""}: ` + ((sched[w] || []).slice().sort(byStart).map((i: any) => `[${i.key}] ${i.start}-${i.end || i.start} ${i.tag ? i.tag + ": " : ""}${clip(i.text, 40)}${i.kind === "session" ? ` (court time: ${i.sessionType || "Drill"})` : ""}`).join(" | ") || "nothing")).join("\n"));
  const open = Object.entries(tasks).map(([id, x]: any) => ({ id, ...x })).filter((x: any) => x.title && !x.done && !x.dropped && x.due).sort((a: any, b: any) => String(a.due).localeCompare(b.due));
  const overdue = open.filter((x: any) => x.due < today), dueToday = open.filter((x: any) => x.due === today), soon = open.filter((x: any) => x.due > today && x.due <= addDays(today, 14));
  const tline = (x: any) => `- [${x.id}] ${x.title} (due ${x.due}${x.area ? ", " + x.area : ""}${x.kind && x.kind !== "task" ? ", " + x.kind : ""}${x.notes ? ", notes: " + clip(x.notes, 80) : ""})`;
  lines.push(`TO-DOS. Overdue (${overdue.length}):\n${overdue.slice(0, 20).map(tline).join("\n") || "- none"}\nDue today (${dueToday.length}):\n${dueToday.slice(0, 25).map(tline).join("\n") || "- none"}\nNext 14 days (${soon.length}):\n${soon.slice(0, 25).map(tline).join("\n") || "- none"}`);
  const doneToday = Object.values(tasks).filter((x: any) => x && x.done && x.doneOn === today);
  if (doneToday.length) lines.push(`Done today: ${doneToday.map((x: any) => x.title).join("; ")}.`);
  const allLeads = Object.entries(leads).map(([id, l]: any) => ({ id, ...l }));
  const due = allLeads.filter((l: any) => l.stage !== "Lost" && l.nextDate && l.nextDate <= today).sort((a: any, b: any) => ((a.type === "Cold" ? 1 : 0) - (b.type === "Cold" ? 1 : 0)) || String(a.nextDate).localeCompare(b.nextDate));
  const stages: any = {}; allLeads.forEach((l: any) => { stages[l.stage || "?"] = (stages[l.stage || "?"] || 0) + 1; });
  const won = allLeads.filter((l: any) => l.stage === "Won");
  const callBlocks = itemsForDay(d, today).filter((i: any) => i.kind === "calls").map((i: any) => `${i.region === "IA" ? "Iowa" : i.region === "AZ" ? "Arizona" : i.region || "all"} ${dialsFor(day, i.region)}/${i.quota}`);
  lines.push(`CALLS today: ${callBlocks.join(", ") || "no call blocks today"}. Conversations today ${(day.calls || []).filter((c: any) => c.convo).length}, demos booked today ${(day.calls || []).filter((c: any) => c.demo).length}. Pipeline: ${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}. Won clients: ${won.map((l: any) => `${l.name} (${money(l.monthly)}/mo)`).join(", ") || "none"}.\nLeads due now (${due.length}, showing ${Math.min(due.length, 30)}):\n${due.slice(0, 30).map((l: any) => `- [${l.id}] ${l.name}${l.business ? ", " + l.business : ""} | ${l.type}/${l.stage}${l.region ? "/" + l.region : ""} | next: ${l.nextStep || "-"} (${l.nextDate})${l.phone ? " | " + l.phone : ""}`).join("\n") || "- none"}`);
  const ws = weekStartOf(today);
  const st: any = { dials: 0, convos: 0, demos: 0, dms: 0, proposals: 0, deals: 0, mockups: 0, cash: 0, gym: 0, mobility: 0, drill: 0, competitive: 0, checkins: 0 };
  for (let i = 0; i < 7; i++) {
    const dd = addDays(ws, i); if (dd > today) break;
    const x = days[dd] || {}, pm = x.pm || {}, ch = x.checks || {};
    (x.calls || []).forEach((c: any) => { if (c.dial) st.dials++; if (c.convo) st.convos++; if (c.demo) st.demos++; if (c.dm) st.dms++; });
    st.proposals += num(pm.proposals) || 0; st.deals += num(pm.deals) || 0; st.mockups += num(pm.mockups) || 0; st.cash += num(pm.cash) || 0; st.dms += num(pm.dms) || 0;
    if (x.am && x.am.savedAt) st.checkins++;
    itemsForDay(d, dd).forEach((i: any) => { if (!ch[i.key]) return; if (i.kind === "gym") st.gym++; if (i.kind === "mobility") st.mobility += i.minutes || 15; });
  }
  Object.values(sessions).forEach((s: any) => { if (s && s.date >= ws && s.date <= today) { if (s.type === "Drill") st.drill++; if (["Competitive", "Tournament"].includes(s.type)) st.competitive++; } });
  lines.push(`THIS WEEK so far (week of ${ws}): dials ${st.dials}/${T.dials}, conversations ${st.convos}/${T.convos}, demos ${st.demos}/${T.demos}, proposals ${st.proposals}/${T.proposals}, deals ${st.deals}/${T.deals}, mockups ${st.mockups}/${T.mockups}, DMs ${st.dms}/${T.dms}, cash in ${money(st.cash)}, drill ${st.drill}/${T.drill}, competitive ${st.competitive}/${T.competitive}, gym ${st.gym}/${T.gym}, mobility ${st.mobility}/${T.mobility} min, check-ins ${st.checkins}/7.`);
  const rm = ((cfg.roadmap || {}).weeks || []).slice().sort((a: any, b: any) => String(a.start).localeCompare(b.start));
  let cur: any = null, next: any = null; rm.forEach((w: any) => { if (w.start <= today) cur = w; else if (!next) next = w; });
  if (cur) lines.push(`ROADMAP this week: ${cur.focus}. Must-dos: ${cur.musts || "-"}`);
  if (next) lines.push(`Next week on the roadmap: ${next.focus}.`);
  const m = cfg.money || {}; const plan = (m.plan || []).slice().sort((a: any, b: any) => String(a.date).localeCompare(b.date)); let target: any = null; plan.forEach((p: any) => { if (p.date <= addDays(ws, 6)) target = p; });
  lines.push(`MONEY: Scottsdale account ${m.scottsdale != null ? money(m.scottsdale) : "not entered yet"}, taxes ${m.taxes != null ? money(m.taxes) : "not entered yet"}${m.updated ? `, updated ${m.updated}` : ""}.${target ? ` Savings plan for ${target.date}: ${money(target.amount)}.` : ""} Rule for every payment: 25% taxes, 50% Scottsdale, 25% bills.`);
  const wts = Object.values(days).filter((x: any) => x && x.date && x.am && num(x.am.weight)).map((x: any) => ({ d: x.date, w: num(x.am.weight) as number })).sort((a: any, b: any) => a.d.localeCompare(b.d));
  const last7 = wts.filter((x: any) => x.d > addDays(today, -7)); const a7 = last7.length ? last7.reduce((a: number, b: any) => a + b.w, 0) / last7.length : null;
  const dl = Object.values(dupr).filter((x: any) => x && x.date && num(x.rating)).sort((a: any, b: any) => a.date.localeCompare(b.date)); const latest: any = dl[dl.length - 1];
  lines.push(`BODY: latest weight ${wts.length ? `${wts[wts.length - 1].w} lb on ${wts[wts.length - 1].d}` : "none yet"}${a7 ? `, 7-day average ${a7.toFixed(1)}` : ""}. DUPR: ${latest ? `${latest.rating} on ${latest.date}` : "no entry yet"}.`);
  const sessLine = ([id, s]: any) => `[${id}] ${s.date} ${s.type || "?"} ${s.hours || "?"} h${num(s.games) ? `, ${num(s.won) || 0}-${(num(s.games) as number) - (num(s.won) || 0)}` : ""}${s.workOn ? `, work on: ${clip(s.workOn, 60)}` : ""}`;
  const sess = Object.entries(sessions).filter(([, s]: any) => s && s.date);
  lines.push(`SESSIONS today: ${sess.filter(([, s]: any) => s.date === today).map(sessLine).join("; ") || "none logged yet"}. Recent: ${sess.filter(([, s]: any) => s.date < today).sort((a: any, b: any) => b[1].date.localeCompare(a[1].date)).slice(0, 5).map(sessLine).join("; ") || "-"}.`);
  const ahead = Object.entries(events).map(([id, e]: any) => ({ id, ...e })).filter((e: any) => e.date >= today && e.date <= addDays(today, 30)).sort((a: any, b: any) => (a.date + a.start).localeCompare(b.date + b.start));
  lines.push(`CALENDAR, one-off items in the next 30 days (${ahead.length}):\n${ahead.slice(0, 30).map((e: any) => `- [ev-${e.id}] ${e.date} ${e.start}${e.end ? "-" + e.end : ""} ${e.title}${e.where ? " at " + e.where : ""}`).join("\n") || "- nothing"}`);
  const lastWeek = weeks[addDays(ws, -7)] || {}; if (lastWeek.fix || lastWeek.leak) lines.push(`Last Sunday review: leak "${lastWeek.leak || "-"}", fix "${lastWeek.fix || "-"}".`);
  return lines.join("\n\n");
}

// Runs one tool call. `store` reads and writes this user's documents: get(col, id), put(col, id, data), del(col, id).
// `d` is the in-memory copy of the user's data; it is kept in step so later calls see earlier changes.
export async function runTool(store: any, name: string, input: any, today: string, d: any): Promise<{ result: string; action?: string }> {
  input = input || {};
  const put = async (col: string, id: string, data: any) => { await store.put(col, id, data); (d[col] ||= {})[id] = data; return data; };
  const patch = async (col: string, id: string, p: any) => put(col, id, merge((await store.get(col, id)) || {}, p));
  const del = async (col: string, id: string) => { await store.del(col, id); if (d[col]) delete d[col][id]; };
  const schedule = async () => { const s = (await store.get("config", "schedule")) || {}; return { ...s, days: { ...(s.days || {}) } }; };
  const saveSchedule = async (s: any) => { await put("config", "schedule", s); (d.config ||= {}).schedule = s; };
  const dateOf = (v: any) => (isDate(v) ? v : today);
  const err = (m: string) => ({ result: "error: " + m });
  switch (name) {
    case "move_block": {
      const date = dateOf(input.date), key = String(input.key || "");
      const it: any = itemsForDay(d, date).find((i: any) => i.key === key);
      if (!it) return err(`no block [${key}] on ${date}`);
      const len = Math.max(0, toMin(it.end || it.start) - toMin(it.start));
      if (isDate(input.to_date) && input.to_date !== date) {
        const start = isTime(input.start) ? input.start : it.start;
        const end = isTime(input.end) ? input.end : hhmm(toMin(start) + len);
        if (toMin(end) < toMin(start)) return err("end is before start");
        if (it.oneoff) {
          const e = (d.events || {})[it.eventId]; if (!e) return err("that one-off item is gone");
          await put("events", it.eventId, { ...e, date: input.to_date, start, end, updatedAt: Date.now() });
          return { result: `moved [${key}] to ${input.to_date} ${start}-${end}`, action: `Moved ${nameOf(it)} to ${fmtDay(input.to_date)}, ${fmtTap(start)}` };
        }
        if (["checkin", "checkout", "dupr"].includes(it.kind)) return err("check-in, check-out and DUPR stay on their own day");
        const id = "ev-" + uid36();
        const doc: any = { title: it.text || it.tag || "Block", tag: it.tag || "", date: input.to_date, start, end, where: "", notes: "", kind: it.kind, from: { date, key }, createdAt: Date.now(), updatedAt: Date.now() };
        if (it.kind === "session") doc.sessionType = it.sessionType || "Drill";
        if (it.kind === "calls") { doc.quota = it.quota || 10; doc.region = it.region || ""; }
        await put("events", id, doc);
        await patch("days", date, { date, skips: { [key]: true } });
        return { result: `moved [${key}] to ${input.to_date} as [ev-${id}]; canceled on ${date}`, action: `Moved ${nameOf(it)} to ${fmtDay(input.to_date)}, ${fmtTap(start)}` };
      }
      if (it.oneoff) {
        const e = (d.events || {})[it.eventId]; if (!e) return err("that one-off item is gone");
        if (!isTime(input.start)) return err("start (HH:MM) is required for a one-off item");
        const end = isTime(input.end) ? input.end : hhmm(toMin(input.start) + len);
        if (toMin(end) < toMin(input.start)) return err("end is before start");
        await put("events", it.eventId, { ...e, start: input.start, end, updatedAt: Date.now() });
        return { result: `moved [${key}] to ${input.start}-${end}`, action: `Moved ${nameOf(it)} to ${fmtTap(input.start)}–${fmtTap(end)}, ${fmtDay(date)}` };
      }
      const base = (((d.config || {}).schedule || {}).days || {})[dowOf(date)].find((i: any) => i.key === key);
      if (input.reset) {
        await patch("days", date, { date, moves: { [key]: null } });
        return { result: `[${key}] back at ${base.start}`, action: `Put ${nameOf(it)} back at ${fmtTap(base.start)}, ${fmtDay(date)}` };
      }
      if (!isTime(input.start)) return err("start (HH:MM) is required");
      const end = isTime(input.end) ? input.end : hhmm(toMin(input.start) + len);
      if (toMin(end) < toMin(input.start)) return err("end is before start");
      const usual = input.start === base.start && end === (base.end || base.start);
      await patch("days", date, { date, moves: { [key]: usual ? null : { start: input.start, end } } });
      return { result: `moved [${key}] to ${input.start}-${end} on ${date} only`, action: `Moved ${nameOf(it)} to ${fmtTap(input.start)}–${fmtTap(end)}, ${fmtDay(date)} only` };
    }
    case "skip_block": {
      const date = dateOf(input.date), key = String(input.key || "");
      const it: any = itemsForDay(d, date).find((i: any) => i.key === key);
      if (!it) return err(`no block [${key}] on ${date}`);
      const skip = input.skip !== false;
      await patch("days", date, { date, skips: { [key]: skip } });
      return { result: skip ? `[${key}] is off ${date}` : `[${key}] is back on ${date}`, action: `${skip ? "Took" : "Put"} ${nameOf(it)} ${skip ? "off" : "back on"} ${fmtDay(date)}` };
    }
    case "set_day_off": {
      const date = dateOf(input.date), off = input.off !== false;
      await patch("days", date, { date, off });
      return { result: off ? `${date} is a day off` : `${date} counts again`, action: off ? `Made ${fmtDay(date)} a day off` : `${fmtDay(date)} counts again` };
    }
    case "check_block": {
      const key = String(input.key || "");
      const it: any = itemsForDay(d, today).find((i: any) => i.key === key);
      if (!it) return err(`no block [${key}] today`);
      if (it.kind === "marker") return err("that is a note, not something to check off");
      if (it.kind === "checkin" || it.kind === "checkout") return err("the check-in is saved with log_checkin, and the check-out is done in the app");
      const on = input.done !== false;
      await patch("days", today, { date: today, checks: { [key]: on } });
      let extra = "";
      if (it.kind === "session") {
        const sid = `auto-${today}-${key}`, s = (d.sessions || {})[sid];
        if (on && !s) { await put("sessions", sid, { date: today, type: it.sessionType || "Drill", hours: it.hours || 2, rated: false, auto: true, createdAt: Date.now() }); extra = `; session [${sid}] logged`; }
        if (!on && s && s.auto && !num(s.games) && !s.wentWell && !s.workOn && !s.notes) await del("sessions", sid);
      }
      return { result: `${on ? "done" : "not done"}${extra}`, action: `${on ? "Checked off" : "Unchecked"} ${nameOf(it)}` };
    }
    case "add_event": {
      const title = str(input.title);
      if (!title || !isDate(input.date) || !isTime(input.start)) return err("title, date (YYYY-MM-DD) and start (HH:MM, 24-hour) are required");
      const end = isTime(input.end) ? input.end : hhmm(toMin(input.start) + 60);
      if (toMin(end) < toMin(input.start)) return err("end is before start");
      const id = "ev-" + uid36();
      const doc: any = { title, date: input.date, start: input.start, end, where: str(input.where), notes: str(input.notes), createdAt: Date.now(), updatedAt: Date.now() };
      if (str(input.label)) doc.tag = str(input.label);
      if (ONEOFF_KINDS.includes(input.kind) && input.kind !== "event") { doc.kind = input.kind; if (input.kind === "session") doc.sessionType = SESSION_TYPES.includes(input.session_type) ? input.session_type : "Rec play"; }
      await put("events", id, doc);
      return { result: `added [ev-${id}]`, action: `Added ${title}: ${fmtDay(input.date)}, ${fmtTap(input.start)}–${fmtTap(end)}` };
    }
    case "update_event": {
      const id = String(input.id || "").replace(/^ev-(?=ev-)/, "");
      const e = (d.events || {})[id]; if (!e) return err("no one-off item with that id");
      if (input.remove) { await del("events", id); return { result: "removed", action: `Removed ${e.title}` }; }
      const ne: any = { ...e, updatedAt: Date.now() };
      if (str(input.title)) ne.title = str(input.title);
      if (isDate(input.date)) ne.date = input.date;
      if (isTime(input.start)) ne.start = input.start;
      if (isTime(input.end)) ne.end = input.end;
      if (typeof input.where === "string") ne.where = input.where.trim();
      if (typeof input.notes === "string") ne.notes = input.notes.trim();
      if (ONEOFF_KINDS.includes(input.kind)) { delete ne.kind; delete ne.sessionType; if (input.kind !== "event") ne.kind = input.kind; }
      if (ne.kind === "session") ne.sessionType = SESSION_TYPES.includes(input.session_type) ? input.session_type : (ne.sessionType || "Rec play");
      if (toMin(ne.end || ne.start) < toMin(ne.start)) return err("end is before start");
      await put("events", id, ne);
      return { result: "updated", action: `Updated ${ne.title}: ${fmtDay(ne.date)}, ${fmtTap(ne.start)}` };
    }
    case "edit_weekly_block": {
      const key = String(input.key || ""), days = weekdays(input.days);
      if (!days.length) return err("days are required, like [\"Mon\"]");
      const s = await schedule();
      const src: any = WEEK.map((w) => (s.days[w] || []).find((i: any) => i.key === key)).find(Boolean);
      if (!src) return err(`no block [${key}] in the weekly plan`);
      const ch: any = {};
      if (typeof input.label === "string") ch.tag = input.label.trim();
      if (typeof input.details === "string") ch.text = input.details.trim();
      if (WEEKLY_KINDS.includes(input.kind) && !["checkin", "checkout", "dupr"].includes(src.kind)) ch.kind = input.kind;
      if (SESSION_TYPES.includes(input.session_type)) ch.sessionType = input.session_type;
      if (typeof input.carry === "boolean") ch.carry = input.carry;
      for (const w of days) {
        const arr = [...(s.days[w] || [])], i = arr.findIndex((x: any) => x.key === key);
        const cur = i >= 0 ? arr[i] : { ...src };
        const nx: any = { ...cur, ...ch };
        if (isTime(input.start)) { nx.start = input.start; nx.end = isTime(input.end) ? input.end : hhmm(toMin(input.start) + Math.max(0, toMin(cur.end || cur.start) - toMin(cur.start))); }
        else if (isTime(input.end)) nx.end = input.end;
        if (toMin(nx.end || nx.start) < toMin(nx.start)) return err(`end is before start on ${w}`);
        if (nx.kind === "session") { nx.sessionType = nx.sessionType || "Drill"; nx.hours = Math.round((toMin(nx.end) - toMin(nx.start)) / 30) / 2 || nx.hours || 1; }
        if (i >= 0) arr[i] = nx; else arr.push(nx);
        s.days[w] = arr.sort(byStart);
      }
      await saveSchedule(s);
      return { result: `updated [${key}] on ${days.join(", ")}`, action: `Changed ${nameOf(src)} for ${daysLabel(days)}` };
    }
    case "add_weekly_block": {
      const days = weekdays(input.days), label = str(input.label);
      if (!days.length || !label || !isTime(input.start)) return err("days, label and start (HH:MM) are required");
      const end = isTime(input.end) ? input.end : hhmm(toMin(input.start) + 60);
      if (toMin(end) < toMin(input.start)) return err("end is before start");
      const kind = WEEKLY_KINDS.includes(input.kind) ? input.kind : "task";
      const item: any = { key: "b" + uid36(), start: input.start, end, tag: label, text: str(input.details), kind };
      if (kind === "session") { item.sessionType = SESSION_TYPES.includes(input.session_type) ? input.session_type : "Drill"; item.hours = Math.round((toMin(end) - toMin(input.start)) / 30) / 2 || 1; }
      if (kind === "calls") { item.quota = 10; item.region = ""; }
      if (kind === "mobility" || kind === "watch") item.minutes = Math.max(5, toMin(end) - toMin(input.start));
      if (input.carry === true) item.carry = true;
      const s = await schedule();
      for (const w of days) s.days[w] = [...(s.days[w] || []), { ...item }].sort(byStart);
      await saveSchedule(s);
      return { result: `added [${item.key}] on ${days.join(", ")}`, action: `Added ${label} to ${daysLabel(days)}, ${fmtTap(input.start)}–${fmtTap(end)}` };
    }
    case "remove_weekly_block": {
      const key = String(input.key || ""), days = weekdays(input.days);
      if (!days.length) return err("days are required");
      const s = await schedule(); let n = 0, label = key;
      for (const w of days) { const arr = s.days[w] || [], f = arr.find((x: any) => x.key === key); if (f) { label = nameOf(f); n++; s.days[w] = arr.filter((x: any) => x.key !== key); } }
      if (!n) return err(`[${key}] is not on those days`);
      await saveSchedule(s);
      return { result: `removed [${key}]`, action: `Took ${label} out of ${daysLabel(days)}` };
    }
    case "add_task": {
      const title = str(input.title), due = isDate(input.due) ? input.due : today;
      if (!title) return err("title is required");
      const id = "u-" + uid36();
      await put("tasks", id, { title, due, origDue: due, area: AREAS.includes(input.area) ? input.area : "Other", notes: str(input.notes), done: false, kind: "task", createdAt: Date.now() });
      return { result: `added task ${id}`, action: `Added to-do: ${title} (due ${fmtDay(due)})` };
    }
    case "update_task": {
      const x = (d.tasks || {})[input.id]; if (!x) return err("no task with that id");
      const nx: any = { ...x };
      if (str(input.title)) nx.title = str(input.title);
      if (isDate(input.due)) { nx.origDue = x.origDue || x.due; nx.due = input.due; }
      if (typeof input.done === "boolean") { nx.done = input.done; nx.doneOn = input.done ? today : null; }
      if (typeof input.dropped === "boolean") { nx.dropped = input.dropped; if (input.dropped) nx.droppedOn = today; }
      if (typeof input.notes === "string") nx.notes = input.notes.trim();
      await put("tasks", input.id, nx);
      return { result: "updated", action: `${nx.dropped ? "Dropped" : nx.done ? "Completed" : "Updated"} to-do: ${nx.title}` };
    }
    case "add_lead_note": {
      const l = (d.leads || {})[input.lead_id]; if (!l) return err("no lead with that id");
      const note = str(input.note); if (!note) return err("note is required");
      const nl: any = { ...l, notes: (l.notes ? l.notes + "\n" : "") + `${today.slice(5).replace("-", "/")}: ${note}`, updatedAt: Date.now() };
      if (str(input.next_step)) nl.nextStep = str(input.next_step);
      if (isDate(input.next_date)) nl.nextDate = input.next_date;
      await put("leads", input.lead_id, nl);
      return { result: "noted", action: `Noted on ${l.name}` };
    }
    case "log_checkin": {
      const cur = ((d.days || {})[today] || {}).am || {};
      const am: any = {};
      const w = num(input.weight); if (w !== null) am.weight = w;
      const sl = num(input.sleep); if (sl !== null) am.sleep = sl;
      const en = num(input.energy); if (en !== null) am.energy = Math.max(1, Math.min(10, Math.round(en)));
      if (Array.isArray(input.top3)) am.top3 = input.top3.map((t: any) => String(t || "").trim()).filter(Boolean).slice(0, 3).map((t: string) => ({ t, done: !!(cur.top3 || []).find((x: any) => x && x.t === t && x.done) }));
      if (typeof input.note === "string") am.note = input.note.trim();
      if (!Object.keys(am).length) return err("nothing to save");
      am.savedAt = new Date().toISOString();
      await patch("days", today, { date: today, am });
      return { result: "saved", action: `Saved your check-in${am.weight ? `: ${am.weight} lb` : ""}` };
    }
    case "log_session": {
      const id = input.id && (d.sessions || {})[input.id] ? String(input.id) : "";
      const s: any = id ? { ...d.sessions[id] } : { date: dateOf(input.date), type: "Drill", hours: 2, rated: false, createdAt: Date.now() };
      if (isDate(input.date)) s.date = input.date;
      if (SESSION_TYPES.includes(input.type)) s.type = input.type;
      for (const k of ["hours", "games", "won"]) { const n = num(input[k]); if (n !== null) s[k] = n; }
      if (typeof input.rated === "boolean") s.rated = input.rated;
      for (const [k, f] of [["partner", "partner"], ["opponents", "opponents"], ["went_well", "wentWell"], ["work_on", "workOn"], ["notes", "notes"]]) if (typeof input[k] === "string") s[f] = input[k].trim();
      if (num(s.won) !== null && num(s.games) !== null && (num(s.won) as number) > (num(s.games) as number)) return err("won is more than games");
      const sid = id || "s-" + uid36();
      await put("sessions", sid, s);
      const rec = num(s.games) ? `: ${num(s.won) || 0}-${(num(s.games) as number) - (num(s.won) || 0)}` : "";
      return { result: `saved [${sid}]`, action: `${id ? "Updated" : "Logged"} ${s.type} session, ${fmtDay(s.date)}${rec}` };
    }
    case "log_dupr": {
      const r = num(input.rating); if (!r || r < 1 || r > 8) return err("rating must be between 1 and 8");
      await put("dupr", today, { date: today, rating: r });
      return { result: "logged", action: `Logged DUPR ${r}` };
    }
  }
  return err("unknown tool");
}
// ---- end pure logic ----

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (url.searchParams.has("status")) return json({ ok: true, hasKey: !!apiKey, model: MODEL, version: FN_VERSION });
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
    // Reads go to the database right before each write, so a change made on a phone a second ago is kept.
    const store = {
      get: async (col: string, id: string) => { const { data, error } = await admin.from("docs").select("data").match({ owner: uid, collection: col, id }).maybeSingle(); if (error) throw new Error(error.message); return data ? data.data : null; },
      put: async (col: string, id: string, data: any) => { const { error } = await admin.from("docs").upsert({ owner: uid, collection: col, id, data, updated_at: new Date().toISOString() }, { onConflict: "owner,collection,id" }); if (error) throw new Error(error.message); },
      del: async (col: string, id: string) => { const { error } = await admin.from("docs").delete().match({ owner: uid, collection: col, id }); if (error) throw new Error(error.message); },
    };

    const history: any[] = (Array.isArray(body.history) ? body.history : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-16).map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    while (history.length && history[0].role !== "user") history.shift();
    const messages: any[] = [...history, { role: "user", content: message }];

    const client = new Anthropic({ apiKey });
    const actions: string[] = [];
    let reply = "";
    // Built once per question: the system prompt must stay byte-identical across the tool rounds,
    // or the thinking blocks passed back between rounds stop being valid.
    const context = buildContext(d, today, now, tz);
    for (let round = 0; round < 8; round++) {
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
        try { r = await runTool(store, u.name, u.input || {}, today, d); } catch (e: any) { r = { result: "error: " + ((e && e.message) || String(e)) }; }
        if (r.action) actions.push(r.action);
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.result, is_error: r.result.startsWith("error") });
      }
      messages.push({ role: "user", content: results });
    }
    return json({ reply: reply || (actions.length ? "Done." : "I didn't get an answer back. Try again."), actions, model: MODEL, version: FN_VERSION });
  } catch (e: any) {
    console.error(e);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY under Edge Functions › Secrets." }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Anthropic is rate-limiting right now. Try again in a minute." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `Anthropic answered ${e.status}: ${e.message}` }, 502);
    return json({ error: String((e && e.message) || e) }, 500);
  }
});
