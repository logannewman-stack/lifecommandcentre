// Email outreach and the pipeline: the app's side of the engine in supabase/functions/outreach/index.ts.
// Every business is one lead (leads/<id>). A lead in an email campaign carries `seq`, its place in that
// campaign's sequence. The rules between the "shared rules" markers are repeated in the engine (a test
// compares the two), so the preview in the app is exactly what goes out, and a stage you move in the app
// follows the same rules as one a reply moves. Pure functions with no DOM and no app state.

// ---- shared rules ----
export const SEND_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const FINDER_AREAS = 'Des Moines, IA; West Des Moines, IA; Urbandale, IA; Ankeny, IA; Johnston, IA; Clive, IA; Waukee, IA; Altoona, IA; Grimes, IA; Ames, IA; ' +
  'Cedar Rapids, IA; Iowa City, IA; Davenport, IA; Bettendorf, IA; Waterloo, IA; Cedar Falls, IA; Sioux City, IA; Council Bluffs, IA; Dubuque, IA; Marion, IA; ' +
  'Phoenix, AZ; Scottsdale, AZ; Mesa, AZ; Chandler, AZ; Gilbert, AZ; Tempe, AZ; Glendale, AZ; Peoria, AZ; Surprise, AZ; Goodyear, AZ; Queen Creek, AZ; ' +
  'Fountain Hills, AZ; Tucson, AZ; Flagstaff, AZ; Prescott, AZ';
export const FINDER_DEFAULTS = {
  enabled: false, perDay: 50, budget: 3, model: 'claude-opus-5-5', review: false,
  targets: {
    'front-desk': { on: true, niches: 'HVAC, plumber, electrician, roofer, landscaping, lawn care, house cleaning, carpet cleaning, pest control, garage door repair, pool service, handyman, house painter, remodeling contractor, tree service, junk removal, moving company, pressure washing, auto repair, auto detailing, towing, locksmith, appliance repair, water damage restoration, dentist, orthodontist, pediatric dentist, cosmetic dentist', areas: FINDER_AREAS },
    'home-screen': { on: false, niches: 'med spa, IV therapy, chiropractor, pilates studio, yoga studio, boutique gym, pickleball club, hair salon, massage therapy', areas: FINDER_AREAS },
  },
};
export const DEFAULT_SETTINGS = {
  enabled: false, fromName: 'Logan Newman', website: 'logandnewman.com', address: '', forwardTo: '',
  days: SEND_DAYS, start: '08:30', end: '16:30', tz: 'America/Chicago', capMax: 50, capStart: 20, capStep: 5, gap: 6,
};
function finderWithDefaults(f) {
  const x = f && typeof f === 'object' ? f : {}, targets = {};
  for (const [k, def] of Object.entries(FINDER_DEFAULTS.targets)) targets[k] = { ...def, ...((x.targets || {})[k] || {}) };
  for (const [k, v] of Object.entries(x.targets || {})) if (!targets[k] && v) targets[k] = { on: false, niches: '', areas: '', ...v };
  return { ...FINDER_DEFAULTS, ...x, targets };
}
export const withDefaults = s => ({ ...DEFAULT_SETTINGS, ...(s || {}), days: Array.isArray(s && s.days) && s.days.length ? s.days : DEFAULT_SETTINGS.days, finder: finderWithDefaults(s && s.finder) });
const num = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
export const isEmail = e => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(String(e || '').trim());
export const STATE_TZ = { AZ: 'America/Phoenix', IA: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago',
  NE: 'America/Chicago', KS: 'America/Chicago', TX: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', ND: 'America/Chicago',
  CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver', MT: 'America/Denver', ID: 'America/Boise', NV: 'America/Los_Angeles',
  CA: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles', FL: 'America/New_York', GA: 'America/New_York',
  NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York', MI: 'America/Detroit', TN: 'America/Chicago' };
export const tzFor = (l, s) => (l && l.tz) || STATE_TZ[String((l && (l.state || l.region)) || '').toUpperCase()] || (s && s.tz) || 'America/Chicago';
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
export function addSendDays(iso, n, days) {
  let d = iso, k = 0, guard = 0;
  while (k < n && guard++ < 90) { d = addD(d, 1); if (days.includes(dowD(d))) k++; }
  return d;
}
export function sendDaysSince(from, to, days) {
  let n = 0, d = from, guard = 0;
  while (d < to && guard++ < 400) { d = addD(d, 1); if (days.includes(dowD(d))) n++; }
  return n;
}
export function dailyCap(settings, today) {
  const s = withDefaults(settings), max = num(s.capMax, 50), start = Math.min(max, num(s.capStart, 20)), step = num(s.capStep, 5);
  return s.startedOn ? Math.min(max, start + step * sendDaysSince(s.startedOn, today, s.days)) : start;
}
export function segmentOf(type) {
  const t = String(type || '').toLowerCase();
  if (/dental|dentist|orthodont|endodont|periodont|oral surg/.test(t)) return 'dental';
  if (/med ?spa|aesthetic|injector|botox|laser|skin|derma|body contour|cosmetic|beauty/.test(t)) return 'medspa';
  if (/\biv\b|iv\/|wellness|infusion|hydration|longevity|hormone|weight loss/.test(t)) return 'wellness';
  if (/chiro/.test(t)) return 'chiro';
  if (/pickleball|club|court|tennis|golf/.test(t)) return 'club';
  if (/pilates|yoga|fitness|gym|recovery|barre|studio|crossfit|boxing/.test(t)) return 'studio';
  if (/hvac|plumb|roof|electric|landscap|lawn|clean|pest|detail|car wash|contract|remodel|paint|garage|pool|handyman|mover|moving|junk|pressure|window|fence|concrete|solar|tree|carpet|floor|construction|home service|restoration|locksmith|towing|mechanic|auto repair|appliance|salon|barber|groom|massage|service/.test(t)) return 'services';
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
const NOT_NAMES = /^(owner|owners|manager|office|front|reception|admin|doctor|team|staff|info|sales|marketing|general|operations|director|president|ceo|founder|partner|partners|hygienist|practice|business|contact|main|billing|service|support|the|unknown|none|na)$/i;
// The name in "Hi Beth,": a first name you saved, the contact's first name, or one the address makes plain.
export function firstNameOf(l) {
  if (!l) return '';
  if (l.firstName) return String(l.firstName).trim();
  const c = String(l.contact || '').replace(/\([^)]*\)/g, ' ').replace(/^\s*(dr|mr|mrs|ms|miss)\.?\s+/i, '').trim().split(/\s+/)[0] || '';
  if (/^[A-Z][a-z]{1,14}$/.test(c) && !NOT_NAMES.test(c)) return c;
  return firstNameFrom(l.email);
}
export const bizName = l => String((l && (l.name || l.business)) || '').trim();
export function renderText(tpl, l, c, s) {
  const segs = (c && c.segments) || {}, seg = segs[(l && (l.segment || segmentOf(l.kind || l.business))) || 'general'] || segs.general || {};
  const name = bizName(l), first = firstNameOf(l);
  const v = {
    business: name || 'your business', greeting: first || `${name || 'there'} team`, first_name: first, city: (l && l.city) || '',
    question: seg.question || '', features: seg.features || '', price: (c && c.price) || '', name: (s && s.fromName) || '', website: (s && s.website) || '',
  };
  const fill = t => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return fill(fill(String(tpl || ''))).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function composeEmail(l, c, settings, step) {
  const s = withDefaults(settings), steps = (c && c.steps) || [], st = steps[step];
  if (!st) return null;
  const first = renderText(steps[0].subject || '', l, c, s);
  const subject = step === 0 ? first : (/^re:/i.test(first) ? first : 'Re: ' + first);
  const body = renderText(st.body || '', l, c, s);
  const footer = [s.fromName, s.website, String(s.address || '').trim()].filter(Boolean).join('\n') + `\n\nNot interested? Reply "no thanks" and I won't email again.`;
  const text = `${body}\n\n${footer}`;
  const missing = [...new Set(((subject + '\n' + text).match(/\{\w+\}/g) || []))];
  return { subject, text, missing };
}
// The pipeline. A stage you or a reply moves a lead to can stop its emails: anyone past Contacted is
// talking to you, closed or parked, so a cold sequence would be wrong.
export const STAGES = ['New lead', 'Contacted', 'Talking', 'Demo booked', 'Proposal sent', 'Won', 'Not now', 'Lost'];
export const STAGE_RANK = { 'New lead': 0, Contacted: 1, Talking: 2, 'Demo booked': 3, 'Proposal sent': 4, Won: 5 };
export const HOT = ['interested', 'question', 'referral'];
export const REPLY_STAGE = { interested: 'Talking', question: 'Talking', referral: 'Talking', not_now: 'Not now', not_interested: 'Lost', unsubscribe: 'Lost' };
export const SUPPRESS = { not_interested: true, unsubscribe: true, bounce: true };
export const LIVE_SEQ = ['hold', 'queued', 'active', 'paused'];
const msOf = now => (now instanceof Date ? now.getTime() : Number(now) || Date.now());
export function stagePatch(l, to, by, now) {
  const from = (l && l.stage) || 'New lead', at = msOf(now);
  if (!STAGES.includes(to) || from === to) return {};
  const patch = { stage: to, stageAt: at, history: [...((l && l.history) || []), { at, from, to, by }].slice(-25) };
  const seq = l && l.seq;
  if (seq && LIVE_SEQ.includes(seq.status) && !['New lead', 'Contacted'].includes(to)) patch.seq = { ...seq, status: 'stopped', nextOn: null, stoppedWhy: to };
  return patch;
}
// What a reply does to its lead: the stage it moves to, the end of the sequence, and for a hot one a
// spot on the call list today.
export function replyPatch(l, label, info, now, today) {
  if (label === 'auto' || !l) return {};
  const at = msOf(now), from = l.stage || 'New lead', to = REPLY_STAGE[label];
  const patch = { reply: { label, at: new Date(at).toISOString(), summary: String((info && info.summary) || '').slice(0, 200) } };
  const moves = to === 'Talking' ? ['Not now', 'Lost'].includes(from) || (STAGE_RANK[from] ?? -1) < STAGE_RANK.Talking : !!to && from !== 'Won';
  if (moves) Object.assign(patch, stagePatch(l, to, 'reply', at));
  if (l.seq) patch.seq = { ...l.seq, status: label === 'bounce' ? 'bounced' : 'replied', nextOn: null };
  if (label === 'bounce') patch.emailBad = true;
  if (SUPPRESS[label]) patch.dnc = true;
  if (HOT.includes(label)) {
    patch.callList = true;
    if (!l.type || l.type === 'Cold') patch.type = 'Warm';
    patch.nextStep = label === 'referral' ? 'They pointed you to someone. Reach out' : label === 'question' ? 'Answer their question' : 'Answer their email';
    patch.nextDate = today;
  }
  return patch;
}
// Starts a campaign for a lead. Every key of the old sequence is set, so a server-side merge replaces it.
export function enrollPatch(l, cid, today, hold) {
  const prev = l && l.seq;
  const threads = [...new Set([...((l && l.threads) || []), ...(prev && prev.threadId ? [prev.threadId] : [])])].slice(-10);
  return {
    seq: { campaign: cid, status: hold ? 'hold' : 'queued', step: 0, startedAt: today, nextOn: null, threadId: null, rfcId: null, lastAt: null,
      sendingStep: null, sendingAt: null, failCount: 0, lastError: null, pausedWhy: null, stoppedWhy: null },
    enrolled: { ...((l && l.enrolled) || {}), [cid]: today }, threads,
  };
}
// ---- end shared rules ----

export const SEQ_STATUS = { hold: 'Check first', queued: 'Up next', active: 'In sequence', done: 'Finished', replied: 'Replied', paused: 'Paused', stopped: 'Stopped', bounced: 'Bounced' };
export const nextSendDay = (iso, days) => { let d = iso, guard = 0; while (!days.includes(dowD(d)) && guard++ < 8) d = addD(d, 1); return d; };
const FOLLOW_UP_HOME = [
  { wait: 3, body: 'Hi {greeting},\n\nJust bumping this up in case it got buried. Happy to put together a free mockup of a {business} app, no strings attached.\n\nWant me to send it over?' },
  { wait: 5, body: "Hi {greeting},\n\nI'll stop here so I'm not cluttering your inbox. If an app for {business} ever makes sense, just reply to this email and I'll put the mockup together." },
];
const FOLLOW_UP_DESK = [
  { wait: 3, body: 'Hi {greeting},\n\nJust bumping this up in case it got buried. Happy to show you how it would work for {business}, no strings attached.\n\nWould a quick call this week work?' },
  { wait: 5, body: "Hi {greeting},\n\nI'll stop here so I'm not cluttering your inbox. If you ever want every call answered and more jobs booked at {business}, just reply to this email." },
];
const EVERYONE = { general: { label: 'Everyone', question: '', features: '' } };
// Two cold campaigns, each a first email and two follow-ups in the same thread; {question} and {features}
// come from the business's type. Two more start from the pipeline: Check back for leads parked in Not now,
// and Proposal follow-up for leads in Proposal sent. None sends until you approve it.
export const DEFAULT_CAMPAIGNS = {
  'home-screen': {
    name: 'Own the Home Screen', kind: 'cold', status: 'paused', reviewed: false, cap: 30, order: 1,
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
    name: 'Front Desk AI', kind: 'cold', status: 'paused', reviewed: false, cap: 20, order: 2,
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
  'check-back': {
    name: 'Check back', kind: 'stage', status: 'paused', reviewed: false, cap: 10, order: 3, trigger: { stage: 'Not now', days: 60 },
    offer: 'Checking back with businesses that said the timing was wrong.', price: '',
    steps: [{ wait: 0, subject: 'Checking back, {business}', body: "Hi {greeting},\n\nWhen we talked a while back, the timing wasn't right, so I'm checking back.\n\nIs now a better time? If it is, just reply and I'll send over the details for {business}." }],
    segments: EVERYONE,
  },
  'proposal': {
    name: 'Proposal follow-up', kind: 'stage', status: 'paused', reviewed: false, cap: 10, order: 4, trigger: { stage: 'Proposal sent', days: 2 },
    offer: 'Following up on a proposal you sent.', price: '',
    steps: [
      { wait: 0, subject: 'The proposal for {business}', body: "Hi {greeting},\n\nI wanted to make sure the proposal for {business} came through, and see if you have any questions.\n\nHappy to walk through it on a quick call whenever works for you." },
      { wait: 4, body: "Hi {greeting},\n\nJust following up on the proposal. If anything in it needs to change to work for {business}, tell me and I'll adjust it." },
    ],
    segments: EVERYONE,
  },
};
// Which cold campaign a business fits when you import "by type".
export const campaignFor = segment => (['dental', 'services'].includes(segment) ? 'front-desk' : 'home-screen');
export const liveCampaign = c => !!(c && c.status === 'running' && c.reviewed && (c.steps || []).length);

export const leadIdFor = email => 'e-' + String(email || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const domainOf = u => { try { return new URL(/^https?:\/\//i.test(String(u)) ? String(u) : 'https://' + String(u)).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } };
// Shared mail services: an address there says nothing about which business it belongs to.
const FREE_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'comcast.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'verizon.net', 'mchsi.com', 'q.com', 'centurylink.net', 'frontier.com', 'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'zoho.com']);
const normName = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(llc|inc|co|corp|the|pllc|pc|ltd)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);

// What goes out next, in the engine's order: follow-ups that are due, then new contacts.
export function upNext(leads, campaigns, settings, now = new Date(), suppressed = new Set()) {
  const s = withDefaults(settings), out = [];
  for (const [id, l] of Object.entries(leads || {})) {
    const q = l && l.seq;
    if (!q || !['queued', 'active'].includes(q.status) || q.sendingStep != null || l.dnc || l.emailBad) continue;
    const c = (campaigns || {})[q.campaign]; if (!liveCampaign(c)) continue;
    const email = String(l.email || '').toLowerCase(); if (!isEmail(email) || suppressed.has(email)) continue;
    const step = Number(q.step) || 0; if (step >= c.steps.length) continue;
    const today = localClock(tzFor(l, s), now).date, due = step > 0 ? q.nextOn : today;
    out.push({ id, l, step, campaign: q.campaign, due, ready: !due || due <= today, rank: [step > 0 && due <= today ? 0 : 1, due || '', l.createdAt || 0] });
  }
  return out.sort((a, b) => { for (let i = 0; i < 3; i++) { if (a.rank[i] < b.rank[i]) return -1; if (a.rank[i] > b.rank[i]) return 1; } return 0; });
}

// A spreadsheet export (CSV or tab-separated) as rows of {header: value}. Handles quotes, commas and line breaks in cells.
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
// Contacts from a spreadsheet, as changes to your leads. A business you already have (same id, email,
// website or name) gets the email and the campaign; anyone else becomes a new lead that stays off your
// call list. Businesses you're already talking to, clients and lost leads are not emailed.
// Returns {create: [{id, doc}], update: [{id, patch, name, enroll}], skipped: {dup, suppressed, noEmail, engaged}, held}.
export function importLeads(rows, { campaign = 'auto', leads = {}, suppressed = new Set(), now = Date.now(), today = '' } = {}) {
  const byEmail = {}, byDomain = {}, byName = {};
  for (const [id, l] of Object.entries(leads || {})) {
    if (!l) continue;
    if (l.email) byEmail[String(l.email).toLowerCase()] = id;
    const dm = domainOf(l.website); if (dm) byDomain[dm] = byDomain[dm] || id;
    const n = normName(l.name); if (n) (byName[n] = byName[n] || []).push(id);
  }
  const create = [], update = [], skipped = { dup: 0, suppressed: 0, noEmail: 0, engaged: 0 }, seen = new Set(), touched = new Set();
  let held = 0;
  for (const r of rows || []) {
    const email = pick(r, ['email', 'email address', 'e-mail', 'emails', 'email_1', 'contact email', 'work email', 'primary email']).split(/[\s,;]+/)[0].toLowerCase();
    if (!isEmail(email)) { skipped.noEmail++; continue; }
    if (seen.has(email)) { skipped.dup++; continue; }
    seen.add(email);
    if (suppressed.has(email)) { skipped.suppressed++; continue; }
    const type = pick(r, ['type', 'category', 'industry', 'business type', 'subtypes', 'main category']);
    const segment = segmentOf(type), cid = campaign === 'auto' ? campaignFor(segment) : campaign;
    const confidence = pick(r, ['confidence']) || 'Good', hold = /check/i.test(confidence);
    const name = pick(r, ['business', 'company', 'company name', 'name', 'business name', 'organization', 'account name']) || email.split('@')[1];
    const website = pick(r, ['website', 'site', 'url', 'domain', 'company website']), phone = pick(r, ['phone', 'phone number', 'company phone', 'phone_1']);
    const city = pick(r, ['city', 'town']), state = pick(r, ['state', 'region', 'state code']).toUpperCase().slice(0, 2);
    const firstName = pick(r, ['first name', 'first_name', 'firstname', 'contact first name']) || firstNameFrom(email);
    const foundAt = pick(r, ['found_at', 'found at', 'source url']);
    const appId = pick(r, ['app_id', 'lead_id']);
    const eDom = email.split('@')[1];
    let id = appId && leads[appId] ? appId : byEmail[email] || (domainOf(website) && byDomain[domainOf(website)]) || (!FREE_DOMAINS.has(eDom) && byDomain[eDom]) || '';
    if (!id) { const same = (byName[normName(name)] || []).find(x => { const l = leads[x]; return (digits(phone) && digits(l.phone) === digits(phone)) || (state && (l.state || l.region) === state); }); if (same) id = same; }
    if (id && touched.has(id)) { skipped.dup++; continue; }
    if (id) {
      touched.add(id);
      const l = leads[id];
      if (l.seq && (LIVE_SEQ.includes(l.seq.status) || l.seq.sendingStep != null)) { skipped.dup++; continue; }
      const info = {};
      if (!l.email) info.email = email;
      if (!l.city && city) info.city = city;
      if (!l.state && state) info.state = state;
      if (!l.kind && type) info.kind = type;
      if (!l.segment) info.segment = segment;
      if (!l.firstName && firstName && !firstNameOf(l)) info.firstName = firstName;
      if (foundAt && !l.foundAt) info.foundAt = foundAt;
      if (!l.confidence) info.confidence = confidence;
      if ((l.email && l.email.toLowerCase() !== email) || l.dnc || !['New lead', 'Contacted', undefined, ''].includes(l.stage)) {
        skipped.engaged++; if (Object.keys(info).length) update.push({ id, patch: info, name: l.name, enroll: false });
        continue;
      }
      if (hold) held++;
      update.push({ id, patch: { ...info, ...enrollPatch(l, cid, today, hold) }, name: l.name, enroll: true });
      continue;
    }
    if (hold) held++;
    const at = now + create.length;
    create.push({ id: leadIdFor(email), doc: {
      name, business: [type, city].filter(Boolean).join(', '), contact: '', email, firstName, phone, website, city, state,
      region: ['IA', 'AZ'].includes(state) ? state : '', kind: type, segment, type: 'Cold', stage: 'New lead', stageAt: at,
      source: 'Import', foundAt, confidence, callList: false, touches: 0, notes: '', createdAt: at, updatedAt: at,
      history: [{ at, from: '', to: 'New lead', by: 'import' }], ...enrollPatch(null, cid, today, hold),
    } });
  }
  return { create, update, skipped, held };
}

// How warm a lead is, 0 to 100, from its stage, its last reply and how recent that was.
const BASE = { 'New lead': 10, Contacted: 20, Talking: 62, 'Demo booked': 75, 'Proposal sent': 85, 'Not now': 25 };
const BONUS = { interested: 20, question: 14, referral: 8, other: 6, not_now: 0 };
export function heatOf(l, now = Date.now()) {
  if (!l) return { score: 0, label: 'Cold', cls: 'cold' };
  if (l.stage === 'Won') return { score: 100, label: 'Client', cls: 'client' };
  if (l.stage === 'Lost' || l.dnc) return { score: 0, label: 'Dead', cls: 'dead' };
  let score = BASE[l.stage] ?? 10;
  const r = l.reply, rAt = r && r.at ? Date.parse(r.at) : 0, days = rAt ? (now - rAt) / 86400000 : Infinity;
  if (r && days <= 30) score += BONUS[r.label] || 0;
  const touch = Math.max(rAt || 0, l.lastTouch ? Date.parse(l.lastTouch + 'T12:00:00') || 0 : 0, l.stageAt && (STAGE_RANK[l.stage] ?? 0) >= 2 ? Number(l.stageAt) : 0);
  const age = touch ? (now - touch) / 86400000 : Infinity;
  if (age <= 2) score += 12; else if (age <= 7) score += 8; else if (age <= 30) score += 3; else if ((STAGE_RANK[l.stage] ?? 0) >= 2) score -= 12;
  score = Math.max(1, Math.min(99, Math.round(score)));
  return score >= 60 ? { score, label: 'Hot', cls: 'hot' } : score >= 30 ? { score, label: 'Warm', cls: 'warm' } : { score, label: 'Cold', cls: 'cold' };
}

// Counts for a campaign (or all of them): who is in it, who was emailed, who answered.
export function campaignStats(leads, campaign) {
  const list = Object.values(leads || {}).filter(l => l && l.seq && (!campaign || l.seq.campaign === campaign));
  const by = {}; list.forEach(l => { by[l.seq.status] = (by[l.seq.status] || 0) + 1; });
  const emailed = list.filter(l => (Number(l.seq.step) || 0) > 0).length;
  const sent = list.reduce((a, l) => a + (Number(l.seq.step) || 0), 0);
  const answered = list.filter(l => l.seq.status === 'replied' && l.reply && !['bounce', 'auto'].includes(l.reply.label)).length;
  const hot = list.filter(l => l.seq.status === 'replied' && l.reply && HOT.includes(l.reply.label)).length;
  return { total: list.length, by, emailed, sent, answered, hot, rate: emailed ? Math.round(answered / emailed * 100) : 0 };
}
