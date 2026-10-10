// Email outreach: the app's side of the engine in supabase/functions/outreach/index.ts.
// Default campaigns, reading a contact spreadsheet, and the same email rendering the engine uses,
// so the preview in the app is exactly what goes out. Pure functions with no DOM and no app state,
// so a test can run them (and check they match the engine's copy).

export const STATUSES = {
  hold: 'Check first', queued: 'Queued', active: 'In sequence', done: 'Finished', hot: 'Hot', replied: 'Replied',
  no: 'Not interested', unsub: 'Unsubscribed', bounced: 'Bounced', paused: 'Paused',
};
export const SEND_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_SETTINGS = {
  enabled: false, fromName: 'Logan Newman', website: 'logandnewman.com', address: '', forwardTo: '',
  days: SEND_DAYS, start: '08:30', end: '16:30', tz: 'America/Chicago', capMax: 50, capStart: 20, capStep: 5, gap: 6,
};
export const withDefaults = s => ({ ...DEFAULT_SETTINGS, ...(s || {}), days: Array.isArray(s && s.days) && s.days.length ? s.days : DEFAULT_SETTINGS.days });

const FOLLOW_UP_HOME = [
  { wait: 3, body: 'Hi {greeting},\n\nJust bumping this up in case it got buried. Happy to put together a free mockup of a {business} app, no strings attached.\n\nWant me to send it over?' },
  { wait: 5, body: "Hi {greeting},\n\nI'll stop here so I'm not cluttering your inbox. If an app for {business} ever makes sense, just reply to this email and I'll put the mockup together." },
];
const FOLLOW_UP_DESK = [
  { wait: 3, body: 'Hi {greeting},\n\nJust bumping this up in case it got buried. Happy to show you how it would work for {business}, no strings attached.\n\nWould a quick call this week work?' },
  { wait: 5, body: "Hi {greeting},\n\nI'll stop here so I'm not cluttering your inbox. If you ever want every call answered and more jobs booked at {business}, just reply to this email." },
];
// Each campaign has a first email and two follow-ups in the same thread. {question} and {features}
// come from the business's type, so a med spa, a chiropractor and a pickleball club each read right.
export const DEFAULT_CAMPAIGNS = {
  'home-screen': {
    name: 'Own the Home Screen', status: 'paused', reviewed: false, cap: 30, order: 1,
    offer: "A custom app on your clients' home screens: $7,500, or about $625 a month over 12 months with Klarna.",
    price: "It's $7,500, or 12 monthly payments of about $625 with Klarna (subject to approval).",
    steps: [
      { wait: 0, subject: 'Quick question about {business}', body: 'Hi {greeting},\n\n{question}\n\n{features}\n\n{price}\n\nWant me to send a free mockup of what the {business} app could look like?' },
      ...FOLLOW_UP_HOME,
    ],
    segments: {
      medspa: { label: 'Med spas and aesthetics', question: 'Quick question: when a regular wants to rebook, how do they reach you today? A booking link, a call, a DM?',
        features: "I build custom apps for med spas that sit right on your clients' home screens. One tap to book, your memberships and specials in one place, and a push notification whenever you have an opening or a promo to fill." },
      wellness: { label: 'Wellness and IV clinics', question: 'Quick question: when a regular wants to book again, how do they reach you today? A booking link, a call, a DM?',
        features: "I build custom apps for wellness and IV clinics that sit right on your clients' home screens. One tap to book a drip or a visit, your memberships and packages in one place, and a push notification whenever you have an opening or a special to fill." },
      chiro: { label: 'Chiropractors', question: 'Quick question: when a patient needs their next adjustment, how do they book today? A link, a call, a text?',
        features: "I build custom apps for chiropractic offices that sit right on your patients' home screens. One tap to book an adjustment, their care plan and packages in one place, and a reminder so they keep their visits." },
      club: { label: 'Clubs and courts', question: 'Quick question: how do your members book courts and sign up for leagues today? An app, a website, a group text?',
        features: "I build custom apps for clubs that sit right on your members' home screens, with your name on them. One tap to book a court or join a league, your events in one place, and a push notification when courts open up." },
      studio: { label: 'Studios and gyms', question: 'Quick question: how do your members book classes today? An app, a website, a text?',
        features: "I build custom apps for studios that sit right on your members' home screens, with your brand on them. One tap to book a class, memberships and packs in one place, and a push notification when a spot opens up." },
      general: { label: 'Everyone else', question: 'Quick question: when a customer wants to book with you again, how do they reach you today? A link, a call, a DM?',
        features: "I build custom apps that sit right on your customers' home screens, with your brand on them. One tap to book, your offers in one place, and a push notification whenever you have an opening or a promo to fill." },
    },
  },
  'front-desk': {
    name: 'Front Desk AI', status: 'paused', reviewed: false, cap: 20, order: 2,
    offer: 'An AI front desk that answers every call and text, plus full-service marketing.',
    price: '',
    steps: [
      { wait: 0, subject: 'Quick question about {business}', body: 'Hi {greeting},\n\n{question}\n\n{features}\n\n{price}\n\nWant me to show you how it would work for {business}? It takes about 10 minutes.' },
      ...FOLLOW_UP_DESK,
    ],
    segments: {
      services: { label: 'Service businesses', question: 'Quick question: what happens when someone calls {business} after hours or while your crew is on a job?',
        features: 'I run Front Desk AI. It answers every call and text, day or night, and books the job, so a lead never goes to voicemail. We also handle the rest of your marketing for you: your website, Google profile, ads and reviews.' },
      dental: { label: 'Dental offices', question: 'Quick question: how many calls does your front desk miss during lunch, after hours or while the team is with patients?',
        features: 'I run Front Desk AI. It answers every call and text, day or night, and books new-patient visits and cleanings, so no one goes to voicemail. We also handle the rest of your marketing for you: your website, Google profile, ads and reviews.' },
      general: { label: 'Everyone else', question: "Quick question: what happens when someone calls {business} after hours or while you're busy with a customer?",
        features: 'I run Front Desk AI. It answers every call and text, day or night, and books the appointment, so a lead never goes to voicemail. We also handle the rest of your marketing for you: your website, Google profile, ads and reviews.' },
    },
  },
};
// Which campaign a business fits when you import "by type".
export const campaignFor = segment => (['dental', 'services'].includes(segment) ? 'front-desk' : 'home-screen');

// ---- the same rules as the engine (kept in sync; the tests compare them) ----
export function segmentOf(type) {
  const t = String(type || '').toLowerCase();
  if (/dental|dentist|orthodont|endodont|periodont|oral surg/.test(t)) return 'dental';
  if (/med ?spa|aesthetic|injector|botox|laser|skin|derma|body contour|cosmetic|beauty/.test(t)) return 'medspa';
  if (/\biv\b|iv\/|wellness|infusion|hydration|longevity|hormone|weight loss/.test(t)) return 'wellness';
  if (/chiro/.test(t)) return 'chiro';
  if (/pickleball|club|court|tennis|golf/.test(t)) return 'club';
  if (/pilates|yoga|fitness|gym|recovery|barre|studio|crossfit|boxing/.test(t)) return 'studio';
  if (/hvac|plumb|roof|electric|landscap|lawn|clean|pest|detail|car wash|contract|remodel|paint|garage|pool|handyman|mover|moving|junk|pressure|window|fence|concrete|solar|tree|carpet|floor|construction|home service|restoration|locksmith|towing|mechanic|auto repair|salon|barber|groom|service/.test(t)) return 'services';
  return 'general';
}
const NAMES = new Set(('aaron abby adam alex alexis ali alicia allison amanda amber amy andrea andrew angela anna ashley beth brandon brenda brian brittany brooke ' +
  'caitlin carla carrie casey cassie chad chelsea chris christina christine cindy claire courtney crystal dan dana daniel danielle dave david dawn deb debbie denise ' +
  'diana donna dustin elena elizabeth emily emma eric erica erin gina hannah heather holly jackie jade jamie jason jen jenn jenna jennifer jess jessica jill jodi ' +
  'john jordan josh julie justin kara karen kate katie kayla kelly kelsey kim kimberly kris krista kristen kristin kyle laura lauren leah lindsey lisa liz lori ' +
  'lucy maria marie mark mary megan melissa meredith michael michelle mike molly monica nancy natalie nicole nikki paige pam rachel rebecca robert robin ryan sam ' +
  'samantha sandra sara sarah scott shannon sharon shelby stacey stacy stephanie steve sue susan suzie tammy tara taylor tiffany tina tom tracy trisha valerie ' +
  'vanessa whitney').split(' '));
export function firstNameFrom(email) {
  const local = String(email || '').split('@')[0].toLowerCase().split(/[._+-]/)[0];
  return NAMES.has(local) ? local[0].toUpperCase() + local.slice(1) : '';
}
export function renderText(tpl, p, c, s) {
  const segs = (c && c.segments) || {}, seg = segs[(p && p.segment) || 'general'] || segs.general || {};
  const v = {
    business: (p && p.business) || 'your business', greeting: (p && p.firstName) || `${(p && p.business) || 'there'} team`,
    first_name: (p && p.firstName) || '', city: (p && p.city) || '', question: seg.question || '', features: seg.features || '',
    price: (c && c.price) || '', name: (s && s.fromName) || '', website: (s && s.website) || '',
  };
  const fill = t => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return fill(fill(String(tpl || ''))).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function composeEmail(p, c, settings, step) {
  const s = withDefaults(settings), steps = (c && c.steps) || [], st = steps[step];
  if (!st) return null;
  const first = renderText(steps[0].subject || '', p, c, s);
  const subject = step === 0 ? first : (/^re:/i.test(first) ? first : 'Re: ' + first);
  const body = renderText(st.body || '', p, c, s);
  const footer = [s.fromName, s.website, String(s.address || '').trim()].filter(Boolean).join('\n') + `\n\nNot interested? Reply "no thanks" and I won't email again.`;
  const text = `${body}\n\n${footer}`;
  const missing = [...new Set(((subject + '\n' + text).match(/\{\w+\}/g) || []))];
  return { subject, text, missing };
}
export const isEmail = e => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(String(e || '').trim());
export const STATE_TZ = { AZ: 'America/Phoenix', IA: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago',
  NE: 'America/Chicago', KS: 'America/Chicago', TX: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', ND: 'America/Chicago',
  CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver', MT: 'America/Denver', ID: 'America/Boise', NV: 'America/Los_Angeles',
  CA: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles', FL: 'America/New_York', GA: 'America/New_York',
  NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York', MI: 'America/Detroit', TN: 'America/Chicago' };
export const tzFor = (p, s) => (p && p.tz) || STATE_TZ[String((p && p.state) || '').toUpperCase()] || (s && s.tz) || 'America/Chicago';
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function localClock(tz, date = new Date()) {
  let parts;
  const opts = { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || 'UTC' }).formatToParts(date); }
  catch (e) { parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).formatToParts(date); }
  const get = t => (parts.find(p => p.type === t) || {}).value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { dow: get('weekday'), date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(hour) * 60 + Number(get('minute')) };
}
const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowD = iso => DOWS[new Date(iso + 'T12:00:00Z').getUTCDay()];
export function sendDaysSince(from, to, days) {
  let n = 0, d = from, guard = 0;
  while (d < to && guard++ < 400) { d = addD(d, 1); if (days.includes(dowD(d))) n++; }
  return n;
}
const numOr = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
export function dailyCap(settings, today) {
  const s = withDefaults(settings), max = numOr(s.capMax, 50), start = Math.min(max, numOr(s.capStart, 20)), step = numOr(s.capStep, 5);
  return s.startedOn ? Math.min(max, start + step * sendDaysSince(s.startedOn, today, s.days)) : start;
}
// The next day the engine sends, from a local date: today if it's a sending day, else the next one.
export function nextSendDay(iso, days) { let d = iso, guard = 0; while (!days.includes(dowD(d)) && guard++ < 8) d = addD(d, 1); return d; }
// Follow-ups wait in sending days, so a Sunday off doesn't count toward the wait.
export function addSendDays(iso, n, days) {
  let d = iso, k = 0, guard = 0;
  while (k < n && guard++ < 90) { d = addD(d, 1); if (days.includes(dowD(d))) k++; }
  return d;
}
// What a reply means for the contact, and which replies mean never email again.
export const STATUS_FOR = { interested: 'hot', question: 'hot', referral: 'hot', not_now: 'replied', not_interested: 'no', unsubscribe: 'unsub', bounce: 'bounced', other: 'replied' };
export const SUPPRESS = { not_interested: true, unsubscribe: true, bounce: true };
// ---- end shared rules ----

// What goes out next, in the engine's order: follow-ups that are due, then new contacts.
export function upNext(prospects, campaigns, settings, now = new Date(), suppressed = new Set()) {
  const s = withDefaults(settings), live = c => c && c.status === 'running' && c.reviewed && (c.steps || []).length;
  const out = [];
  for (const [id, p] of Object.entries(prospects || {})) {
    if (!p || !['queued', 'active'].includes(p.status) || p.sendingStep != null) continue;
    const c = (campaigns || {})[p.campaign]; if (!live(c)) continue;
    const email = String(p.email || '').toLowerCase(); if (!isEmail(email) || suppressed.has(email)) continue;
    const step = Number(p.step) || 0; if (step >= c.steps.length) continue;
    const today = localClock(tzFor(p, s), now).date;
    const due = step > 0 ? p.nextOn : today;
    out.push({ id, p, step, campaign: p.campaign, due, ready: !due || due <= today, rank: [step > 0 && due <= today ? 0 : 1, due || '', p.createdAt || 0] });
  }
  return out.sort((a, b) => { for (let i = 0; i < 3; i++) { if (a.rank[i] < b.rank[i]) return -1; if (a.rank[i] > b.rank[i]) return 1; } return 0; });
}

export const prospectId = email => 'p-' + String(email || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A spreadsheet export (CSV) as rows of {header: value}. Handles quotes, commas and line breaks in cells.
export function parseCSV(text) {
  const rows = [], src = String(text || '').replace(/^﻿/, '');
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(c => String(c).trim()));
  if (!clean.length) return [];
  const head = clean[0].map(h => String(h).trim().toLowerCase());
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()])));
}
const pick = (row, names) => { for (const n of names) { const v = row[n]; if (v) return String(v).trim(); } return ''; };
// Contacts from a spreadsheet, ready to save. Column names from Apollo, Outscraper, Google Sheets
// and the list Claude made all work. Returns {add: [{id, doc}], skipped: {dup, suppressed, noEmail}, held}.
export function prospectsFromRows(rows, { campaign = 'auto', existing = {}, suppressed = new Set(), now = Date.now() } = {}) {
  const add = [], seen = new Set(), skipped = { dup: 0, suppressed: 0, noEmail: 0 };
  let held = 0;
  for (const r of rows || []) {
    const email = pick(r, ['email', 'email address', 'e-mail', 'emails', 'email_1', 'contact email', 'work email', 'primary email']).split(/[\s,;]+/)[0].toLowerCase();
    if (!isEmail(email)) { skipped.noEmail++; continue; }
    const id = prospectId(email);
    if (seen.has(id) || existing[id]) { skipped.dup++; continue; }
    if (suppressed.has(email)) { skipped.suppressed++; continue; }
    seen.add(id);
    const type = pick(r, ['type', 'category', 'industry', 'business type', 'subtypes', 'main category']);
    const segment = segmentOf(type);
    const confidence = pick(r, ['confidence']) || 'Good';
    const hold = /check/i.test(confidence);
    if (hold) held++;
    add.push({ id, doc: {
      campaign: campaign === 'auto' ? campaignFor(segment) : campaign,
      business: pick(r, ['business', 'company', 'company name', 'name', 'business name', 'organization', 'account name']) || email.split('@')[1],
      email, firstName: pick(r, ['first name', 'first_name', 'firstname', 'contact first name']) || firstNameFrom(email),
      type, segment, city: pick(r, ['city', 'town']), state: pick(r, ['state', 'region', 'state code']).toUpperCase().slice(0, 2),
      phone: pick(r, ['phone', 'phone number', 'company phone', 'phone_1']), website: pick(r, ['website', 'site', 'url', 'domain', 'company website']),
      source: pick(r, ['source']) || 'Import', foundAt: pick(r, ['found_at', 'found at', 'source url']), confidence, leadId: pick(r, ['app_id', 'lead_id']),
      status: hold ? 'hold' : 'queued', step: 0, createdAt: now + add.length,
    } });
  }
  return { add, skipped, held };
}

// Counts for the command center: by status, and what has been sent and answered.
export function outreachStats(prospects, campaign) {
  const list = Object.values(prospects || {}).filter(p => p && (!campaign || p.campaign === campaign));
  const by = {}; list.forEach(p => { by[p.status] = (by[p.status] || 0) + 1; });
  const emailed = list.filter(p => (Number(p.step) || 0) > 0).length;
  const sent = list.reduce((a, p) => a + (Number(p.step) || 0), 0);
  const answered = list.filter(p => ['hot', 'replied', 'no', 'unsub'].includes(p.status)).length;
  return { total: list.length, by, emailed, sent, answered, hot: by.hot || 0, rate: emailed ? Math.round(answered / emailed * 100) : 0 };
}
