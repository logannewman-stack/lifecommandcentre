// Smart add: turns one line like "Pickleball Thu 6-8am", "Call Lisa tomorrow" or
// "Gym every Mon, Wed, Fri 6:30pm" into something the app can file.
// Pure functions with no DOM and no app state, so a Node test can run them.
//
// parseQuick(text, today, now) returns
//   {kind: 'task' | 'oneoff' | 'weekly', title, date, start, end, type, sessionType, days, area, hasTime, hasDate}
//   - task:    a to-do due on `date` (null when the line names no date; the caller picks one)
//   - oneoff:  an item on `date`'s plan from `start` to `end` ("HH:MM", 24-hour)
//   - weekly:  a block on every `days` weekday ("Mon", …); start/end are null when no time was given
//   `type` is the block type: event | session | gym | mobility | watch | task.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = '(?:sun(?:day)?s?|mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?)';
const dayName = (w) => DOW.find((d) => w.toLowerCase().startsWith(d.toLowerCase()));

// What kind of block a line describes, from its words.
const TYPE_WORDS = [
  ['session', /\b(pick(?:le)? ?(?:a )?ball|drill(?:s|ing)?|dink(?:s|ing)?|open play|rec play|scrimmage|match(?:es)?|tournament|ladder|league|clinic|lessons?|court time)\b/],
  ['gym', /\b(gym|lift(?:ing)?|weights|workout|work out|leg day|push day|pull day)\b/],
  ['mobility', /\b(stretch(?:ing)?|mobility|yoga|foam roll(?:ing)?)\b/],
  ['watch', /\b(watch (?:pro|film|tape|video)|film study|video study)\b/],
];
const sessionTypeOf = (s) => /tournament/.test(s) ? 'Tournament'
  : /\b(lesson|clinic|coach)\b/.test(s) ? 'Lesson'
  : /\bdrill/.test(s) ? 'Drill'
  : /\b(match|matches|ladder|league|competitive|compete|games?)\b/.test(s) ? 'Competitive'
  : 'Rec play';
// Which part of life a to-do belongs to. The first match wins, most specific first.
const AREA_WORDS = [
  ['DoD', /\b(dod|amiel)\b/],
  ['Money', /\b(pay|paid|bank|invoice|tax|taxes|bill|bills|budget|deposit|collect|money|venmo|transfer)\b|\$\d/],
  ['Move', /\b(move|moving|apartment|lease|scottsdale|rent|truck|pack|packing|movers)\b/],
  ['Pickleball', /\b(pick(?:le)? ?(?:a )?ball|drill|dupr|tournament|coach|paddle|court|dink|serve)\b/],
  ['Body', /\b(gym|weigh|weight|calories?|protein|sleep|workout|run|eat|meal|doctor|dentist|stretch)\b/],
  ['Build', /\b(app|apps|site|website|build|code|bug|deploy|feature|design|innerboard|update|updates|launch)\b/],
  ['Sales', /\b(call|text|email|e-mail|dm|follow ?up|lead|leads|demo|proposal|pitch|client|prospect|mockups?|referrals?|close)\b/],
];
const DEFAULT_MINUTES = { event: 60, session: 120, gym: 60, mobility: 15, watch: 30, task: 60 };

// Hour and minute to minutes since midnight. `ap` is am/pm when written; otherwise the hour decides:
// 6 to 11 mean morning, 12 is noon, 1 to 5 mean afternoon. "tonight" or "morning" in the line tip it.
function toMinutes(h, m, ap, hint) {
  if (h > 23 || m > 59) return null;
  if (ap) {
    if (h > 12 || h === 0) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return h * 60 + m;
  }
  if (h >= 13 || h === 0) return h * 60 + m;
  if (hint === 'pm') return (h < 12 ? h + 12 : 12) * 60 + m;
  if (hint === 'am') return (h === 12 ? 0 : h) * 60 + m;
  if (h === 12) return 12 * 60 + m;
  if (h <= 5) return (h + 12) * 60 + m;
  return h * 60 + m;
}
const apOf = (s) => (s ? s[0].toLowerCase() : null);

export function parseQuick(text, today, now = '12:00') {
  // Dictation writes "a.m." and "pick a ball"; read them as am and pickleball.
  const raw = String(text || '').trim().replace(/\b([ap])\.\s?m\b\.?/gi, '$1m').replace(/\bpick(?:le)?\s?(?:a\s?)?ball\b/gi, 'pickleball');
  let work = ' ' + raw.replace(/\s+/g, ' ') + ' ';
  const low = () => work.toLowerCase();
  const cut = (re) => { const m = low().match(re); if (!m) return null; work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length); return m; };
  const hint = /\b(tonight|evening|night|dinner|after work)\b/.test(raw.toLowerCase()) ? 'pm' : /\b(morning|breakfast|sunrise)\b/.test(raw.toLowerCase()) ? 'am' : null;
  const out = { kind: 'task', title: '', date: null, start: null, end: null, type: 'task', sessionType: null, days: null, area: 'Other', hasTime: false, hasDate: false };

  // Every week: "every Mon, Wed and Fri", "every weekday", "daily", "mondays and thursdays".
  let m;
  if ((m = cut(new RegExp(`\\b(?:every|each)\\s+(day|weekday|weekdays|weekend|${DAY}(?:\\s*(?:,|and|&|/|\\+)?\\s*${DAY})*)\\b`)))) {
    const what = m[1];
    out.days = what === 'day' ? WEEK.slice() : /^weekdays?$/.test(what) ? WEEK.slice(0, 5) : what === 'weekend' ? ['Sat', 'Sun'] : [...new Set(what.match(new RegExp(DAY, 'g')).map(dayName))];
  } else if (cut(/\b(daily|every day)\b/)) out.days = WEEK.slice();
  else if (cut(/\b(on )?weekdays\b/)) out.days = WEEK.slice(0, 5);
  else if ((m = cut(new RegExp(`\\b(?:on\\s+)?((?:mon|tues|wednes|thurs|fri|satur|sun)days(?:\\s*(?:,|and|&|/)\\s*(?:mon|tues|wednes|thurs|fri|satur|sun)days)*)\\b`)))) {
    out.days = [...new Set(m[1].match(/(mon|tues|wednes|thurs|fri|satur|sun)days/g).map(dayName))];
  }
  if (out.days) out.days = WEEK.filter((d) => out.days.includes(d));

  // A day: today, tomorrow, a weekday, "next week", "in 3 days", 10/12, Oct 12.
  if (!out.days) {
    const dow = parseISO(today).getDay();
    if (cut(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/)) out.date = today;
    else if (cut(/\b(?:tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)\b/)) out.date = addDays(today, 1);
    else if (cut(/\bnext week\b/)) out.date = addDays(today, ((8 - dow) % 7) || 7);
    else if ((m = cut(/\bin (\d{1,2}) days?\b/))) out.date = addDays(today, Number(m[1]));
    else if ((m = cut(new RegExp(`\\b(?:on\\s+)?(?:next\\s+|this\\s+)?(${DAY})\\b`)))) {
      const target = DOW.indexOf(dayName(m[1]));
      out.date = addDays(today, ((target - dow + 7) % 7) || 7);
    } else if ((m = cut(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const mo = Number(m[1]), da = Number(m[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : parseISO(today).getFullYear();
        let d = `${y}-${pad(mo)}-${pad(da)}`;
        if (!m[3] && d < addDays(today, -60)) d = `${y + 1}-${pad(mo)}-${pad(da)}`;
        out.date = d;
      }
    } else if ((m = cut(new RegExp(`\\b(?:on\\s+)?(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      const mo = MONTHS.indexOf(m[1]) + 1, da = Number(m[2]), y = parseISO(today).getFullYear();
      let d = `${y}-${pad(mo)}-${pad(da)}`;
      if (d < addDays(today, -60)) d = `${y + 1}-${pad(mo)}-${pad(da)}`;
      out.date = d;
    }
    out.hasDate = !!out.date;
  }

  // A time: a range like 6-8am, 12 to 2, 4:30-6:30pm, or one time like at 2, 2pm, 6:30, noon.
  let start = null, end = null;
  if ((m = cut(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/))) {
    const h1 = Number(m[1]), m1 = Number(m[2] || 0), h2 = Number(m[4]), m2 = Number(m[5] || 0);
    let a1 = apOf(m[3]), a2 = apOf(m[6]);
    if (!a1 && a2 && h1 <= 12 && h2 <= 12) a1 = (h1 % 12) * 60 + m1 > (h2 % 12) * 60 + m2 && a2 === 'p' ? 'a' : a2;
    start = toMinutes(h1, m1, a1, hint);
    if (start !== null) {
      if (a2 || h2 >= 13) end = toMinutes(h2, m2, a2, null);
      else {
        end = start >= 12 * 60 ? (h2 < 12 ? h2 + 12 : 12) * 60 + m2 : (h2 === 12 ? 12 * 60 : h2 * 60) + m2;
        if (end <= start) end += end < 12 * 60 ? 12 * 60 : 0;
      }
      if (end === null || end <= start || end > 24 * 60 - 1) end = null;
    }
  } else if (cut(/\b(?:at\s+|@\s*)?noon\b/)) start = 12 * 60;
  else if ((m = cut(/(?:\bat\s+|@\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/)) || (m = cut(/\b(\d{1,2}):(\d{2})\s*(am|pm|a|p)?\b/)) || (m = cut(/\b(\d{1,2})()\s*(am|pm)\b/))) {
    start = toMinutes(Number(m[1]), Number(m[2] || 0), apOf(m[3]), hint);
  }
  if (start !== null && end === null) {
    if ((m = cut(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/))) end = start + Math.round(Number(m[1]) * 60);
    else if ((m = cut(/\b(?:for\s+)?(\d{1,3})\s*(?:m|min|mins|minutes)\b/))) end = start + Number(m[1]);
  }
  out.hasTime = start !== null;

  // Title: what is left, tidied.
  let title = work.replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:on|at|from|for|by|every|this|next|of|-|–|,)\s+)+/i, '')
    .replace(/(?:\s+(?:on|at|from|for|by|every|this|next|and|-|–|,))+$/i, '')
    .replace(/[\s,.;:-]+$/, '').trim();
  const lt = (title || raw).toLowerCase();
  const found = TYPE_WORDS.find(([, re]) => re.test(lt));
  out.type = found ? found[0] : (out.hasTime ? 'event' : 'task');
  if (out.type === 'session') out.sessionType = sessionTypeOf(lt);
  if (!title) title = out.type === 'session' ? 'Pickleball' : out.type === 'gym' ? 'Gym' : out.type === 'mobility' ? 'Mobility' : 'Untitled';
  out.title = title.charAt(0).toUpperCase() + title.slice(1);
  const area = AREA_WORDS.find(([, re]) => re.test(lt));
  out.area = area ? area[0] : 'Other';

  if (out.days) {
    out.kind = 'weekly';
    if (out.type === 'event') out.type = 'task';
  } else if (out.hasTime) {
    out.kind = 'oneoff';
    out.date = out.date || today;
  } else {
    out.kind = 'task';
    out.type = 'task';
  }
  if (start !== null) {
    out.start = hm(start);
    out.end = hm(Math.min(end !== null ? end : start + (DEFAULT_MINUTES[out.type] || 60), 24 * 60 - 1));
  }
  return out;
}
