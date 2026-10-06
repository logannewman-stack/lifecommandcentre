// Build my day: fit a day's plan around what is set.
// You say when you start and what has a time ("up at 8, pickleball 11, meeting at 1, pickleball at 4").
// Those go on the plan, the day's other blocks move into the free time closest to where they were,
// the most important first, and whatever doesn't fit is canceled for that day.
// Pure functions with no DOM and no app state, so a Node test can run them.
import { parseQuick } from './quickadd.js';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const up5 = (m) => Math.ceil(m / 5) * 5;

// When the day starts: "woke up at 8", "I'm up at 7:30", or a short "start at 9", "free from 2".
const WAKE_START = /^(?:i\s*(?:'?m|am)?\s+)?(?:woke(?:\s+up)?|wake(?:\s+up)?|waking(?:\s+up)?|got\s+up|get(?:ting)?\s+up|up|awake|out of bed)\b/i;
const PLAIN_START = /^(?:i\s*(?:'?m|am)?\s+)?(?:start(?:ing|ed)?|begin(?:ning)?|free)\s*(?:at|from|@|around|by)?\s*\d/i;
// Words people say before the thing itself: "then I have pickleball at 11", "and a meeting at 1"
const FILLER = /^(?:(?:and|then|so|but|also|plus|after that|i\s+(?:have|had|got|'ve got|need to|want to|will|'ll|am going to)|i've got|there'?s|there is|a|an|my|the|got|have)\s+)+/i;

// One line about the day: when it starts and what is set. Returns
//   {start: 'HH:MM' | null, items: [{title, start, end, type, sessionType}], left: [text with no time]}
export function parseDayText(text, today, now) {
  const out = { start: null, items: [], left: [] };
  const pieces = [];
  String(text || '').split(/\n|[,;]|\.(?:\s|$)|\b(?:and then|after that)\b|\bthen\b/i).forEach((p) => {
    p = p.trim(); if (!p) return;
    // "pickleball at 11 and a meeting at 1": split on "and" only when every part has a time.
    const parts = p.split(/\s+(?:and|&|\+)\s+/i);
    if (parts.length > 1 && parts.every((x) => parseQuick(x, today, now).hasTime)) pieces.push(...parts);
    else pieces.push(p);
  });
  for (let p of pieces) {
    p = p.replace(FILLER, '').trim(); if (!p) continue;
    const q = parseQuick(p, today, now);
    if (WAKE_START.test(p) || PLAIN_START.test(p)) {
      let start = q.hasTime ? q.start : null;
      if (!start) { const m = p.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i); if (m) start = parseQuick('at ' + m[0], today, now).start; }
      if (start) out.start = start;
      continue;
    }
    if (!q.hasTime) { out.left.push(p); continue; }
    out.items.push({ title: q.title, start: q.start, end: q.end, type: q.type === 'task' ? 'event' : q.type, sessionType: q.sessionType });
  }
  return out;
}

// The order blocks get the free time in when not everything fits: money first.
const PRIORITY = { checkin: 0, calls: 1, task: 2, session: 3, gym: 4, mobility: 5, dupr: 6, watch: 7 };
const MEAL = /\b(breakfast|lunch|dinner|meal)\b/i;
const WAKE = /\bwake\b/i;

// items: the day as the app shows it, in time order:
//   [{key, start, end, kind, tag, text, oneoff, done, skipped, sessionType}]
// fixed: what is set, from parseDayText(...).items. opts: {start: 'HH:MM' | null, now: 'HH:MM' | null}
//   start is when you begin (defaults to now for today, or the first block for another day);
//   now (today only) keeps anything from being planned in the past.
// Returns {plan, canceled, hidden, from, to}:
//   plan:     [{key, start, end, status, was?, item}] for everything from `from` on, in time order;
//             status is new | keep | moved | shorter | done | fixed (a one-off already there)
//   canceled: [{key, item, why: 'covered' | 'room'}]  covered: your own court time replaces it
//   hidden:   keys of notes (wake up, shower…) that now sit inside another block
export function buildDay(items, fixed = [], opts = {}) {
  const all = items.map((i) => ({ i, s: toMin(i.start), e: Math.max(toMin(i.end || i.start), toMin(i.start)) }));
  const now = opts.now ? up5(toMin(opts.now)) : null;
  const first = all.length ? Math.min(...all.map((x) => x.s)) : 7 * 60;
  const startAt = opts.start ? toMin(opts.start) : (now ?? first);
  const from = Math.max(startAt, now ?? 0);
  const checkout = all.find((x) => x.i.kind === 'checkout' && !x.i.skipped);
  const to = Math.max(from, checkout ? checkout.s : 21 * 60);

  const busy = [];
  const out = new Map(); // key -> {start, end, status, was}
  const hit = (s, e) => busy.some(([a, b]) => a < e && s < b);
  const take = (s, e) => busy.push([s, e]);
  const gaps = () => {
    const bs = busy.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const g = []; let c = from;
    for (const [a, b] of bs) { if (a > c) g.push([c, a]); c = Math.max(c, b); }
    if (to > c) g.push([c, to]);
    return g;
  };
  // The free slot closest to where a block was; when none is long enough, the closest one that is
  // at least half of it (short blocks don't shrink). `near` caps how far it may go, `later` keeps it
  // from moving earlier. null when nothing fits.
  const place = (dur, orig, minDur, near, later) => {
    let best = null;
    for (const [a, b] of gaps()) {
      if (b - a < dur || (later && b - dur < orig)) continue;
      const s = Math.min(Math.max(orig, a), b - dur), d = Math.abs(s - orig);
      if (near != null && d > near) continue;
      if (!best || d < best.d || (d === best.d && s < best.s)) best = { s, e: s + dur, d };
    }
    if (best || near != null) return best;
    for (const [a, b] of gaps()) {
      if (b - a < minDur) continue;
      const d = Math.abs(a - orig);
      if (!best || d < best.d || (d === best.d && b - a > best.e - best.s)) best = { s: a, e: b, d, short: true };
    }
    return best;
  };
  const set = (x, s, e, status) => { out.set(x.i.key, { start: hm(s), end: hm(e), status, was: status === 'moved' || status === 'shorter' ? x.i.start : undefined }); x.s = s; x.e = e; };

  // 1. What can't move: what you typed, one-offs already on the day, what's done, the check-out.
  const news = fixed.filter((f) => f && f.start).map((f, n) => ({ key: 'new-' + n, f, s: toMin(f.start), e: Math.max(toMin(f.end || f.start), toMin(f.start) + 5) }));
  news.forEach((x) => take(x.s, x.e));
  const hasCourt = news.some((x) => x.f.type === 'session') || all.some((x) => x.i.oneoff && x.i.kind === 'session' && !x.i.skipped);
  for (const x of all) {
    if (x.i.skipped) continue;
    if (x.i.oneoff) { take(x.s, x.e); out.set(x.i.key, { start: x.i.start, end: x.i.end, status: 'fixed' }); }
    else if (x.i.kind !== 'marker' && x.i.done) { take(x.s, x.e); out.set(x.i.key, { start: x.i.start, end: x.i.end, status: 'done' }); }
    else if (x === checkout) { take(x.s, x.e); out.set(x.i.key, { start: x.i.start, end: x.i.end, status: 'keep' }); }
  }

  // 2. Waking up moves to when you start, and meals move out of the way of what is set.
  const notes = all.filter((x) => x.i.kind === 'marker' && !x.i.skipped);
  const wake = notes.find((x) => WAKE.test(x.i.text || ''));
  if (wake && opts.start && wake.s < startAt) { const d = Math.max(5, wake.e - wake.s); set(wake, startAt, startAt + d, 'moved'); if (startAt + d > from) take(Math.max(from, startAt), startAt + d); }
  // A meal moves later (up to 3 hours), or a little earlier if it must. A meal you typed replaces it.
  const hidden = [];
  for (const x of notes) {
    const meal = (String(x.i.text || '').match(MEAL) || [])[1];
    if (!meal || x === wake || x.s < from || x.s >= to) continue;
    if (news.some((n) => new RegExp('\\b' + meal + '\\b', 'i').test(n.f.title || ''))) { hidden.push(x.i.key); continue; }
    const d = Math.max(5, x.e - x.s);
    if (!hit(x.s, x.s + d)) { take(x.s, x.s + d); continue; }
    const p = place(d, x.s, d, 180, true) || place(d, x.s, d, 45);
    if (p) { set(x, p.s, p.e, 'moved'); take(p.s, p.e); }
  }

  // 3. Blocks that still fit where they are stay; the rest move, most important first.
  const flex = all.filter((x) => x.i.kind !== 'marker' && !x.i.oneoff && !x.i.skipped && !x.i.done && x !== checkout);
  const movers = [];
  for (const x of flex) {
    if (x.s >= from && x.e <= to && !hit(x.s, x.e)) { take(x.s, x.e); out.set(x.i.key, { start: x.i.start, end: x.i.end, status: 'keep' }); }
    else movers.push(x);
  }
  const canceled = [];
  // Most important kind first; within a kind, what's still ahead before what you already missed.
  movers.sort((a, b) => (PRIORITY[a.i.kind] ?? 8) - (PRIORITY[b.i.kind] ?? 8) || (a.s < from) - (b.s < from) || a.s - b.s);
  for (const x of movers) {
    if (x.i.kind === 'session' && hasCourt) { canceled.push({ key: x.i.key, item: x.i, why: 'covered' }); continue; }
    if (x.s >= to) { out.set(x.i.key, { start: x.i.start, end: x.i.end, status: 'keep' }); continue; } // after the work day: leave it
    const dur = Math.max(5, x.e - x.s), minDur = dur <= 30 ? dur : Math.max(30, Math.round(dur / 10) * 5);
    const p = place(dur, x.s, minDur);
    if (!p) { canceled.push({ key: x.i.key, item: x.i, why: 'room' }); continue; }
    set(x, p.s, p.e, p.short ? 'shorter' : (p.s === toMin(x.i.start) ? 'keep' : 'moved'));
    take(p.s, p.e);
  }

  // 4. Notes that now sit inside a block go quiet for the day.
  for (const x of notes) {
    if (out.has(x.i.key) || hidden.includes(x.i.key) || x === wake || x.s < from || x.s >= to || MEAL.test(x.i.text || '')) continue;
    if (hit(x.s, Math.max(x.e, x.s + 1))) hidden.push(x.i.key);
  }

  const plan = [];
  for (const x of news) plan.push({ key: x.key, start: x.f.start, end: x.f.end, status: 'new', item: x.f });
  for (const x of all) {
    if (x.i.skipped || hidden.includes(x.i.key) || canceled.some((c) => c.key === x.i.key)) continue;
    const o = out.get(x.i.key) || { start: x.i.start, end: x.i.end, status: 'keep' };
    if (toMin(o.end || o.start) <= from && toMin(o.start) < from && o.status !== 'moved') continue; // earlier today, untouched
    plan.push({ key: x.i.key, start: o.start, end: o.end, status: o.status, was: o.was, item: x.i });
  }
  plan.sort((a, b) => toMin(a.start) - toMin(b.start) || (a.status === 'new' ? -1 : 0));
  return { plan, canceled, hidden, from: hm(from), to: hm(to) };
}
