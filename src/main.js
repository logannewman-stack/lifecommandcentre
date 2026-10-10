import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { supabase, config as sbConfig, configSource, saveConfig, clearConfig } from './supabase.js';
import { createDb } from './db.js';
import { parseQuick } from './quickadd.js';
import { parseDayText, buildDay } from './planday.js';
import { SEQ_STATUS, DEFAULT_CAMPAIGNS, withDefaults as outSettings, sendingState, launchWrites, composeEmail, segmentOf, parseCSV, importLeads, campaignStats, tzFor, localClock, dailyCap, nextSendDay, upNext, isEmail, SUPPRESS, HOT, LIVE_SEQ, stagePatch, replyPatch, enrollPatch, heatOf, liveCampaign, leadIdFor } from './outreach.js';
import REMINDERS_FN from '../supabase/functions/reminders/index.ts?raw';
import CRON_SQL from '../supabase/functions/reminders/cron.sql?raw';
import ASSISTANT_FN from '../supabase/functions/assistant/index.ts?raw';
import OUTREACH_FN from '../supabase/functions/outreach/index.ts?raw';
import OUTREACH_CRON from '../supabase/functions/outreach/cron.sql?raw';

(() => {
'use strict';

/* ---------- constants ---------- */
const COLS = ['config','days','tasks','leads','sessions','dupr','weeks','meta','push','events','chat','campaigns','prospects','replies','outreach','suppress'];
const VIEWS = [['today','Today'],['calls','Pipeline'],['email','Email'],['week','Week'],['log','Log'],['plan','Plan']];
const ICONS = {
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9.5 15 2 2 3.5-3.5"/></svg>',
  calls: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="4.6" height="16" rx="1.6"/><rect x="9.7" y="4" width="4.6" height="11" rx="1.6"/><rect x="15.9" y="4" width="4.6" height="7" rx="1.6"/></svg>',
  email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.8 7.2 8.2 6 8.2-6"/></svg>',
  week: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V11M10 20V4M16 20v-6M3 20h18"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5.5-5.5 4 4L21 7"/><path d="M15 7h6v6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"/></svg>',
};
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
// The version inside each Edge Function's code. A deployed function reports its own in ?status=1,
// so the setup sheets can say when Supabase is still running an older copy.
const fnVersion = src => Number((String(src).match(/FN_VERSION = (\d+)/) || [])[1] || 1);
const ASSISTANT_V = fnVersion(ASSISTANT_FN), REMINDERS_V = fnVersion(REMINDERS_FN), OUTREACH_V = fnVersion(OUTREACH_FN);
const THEMES = ['auto','light','dark'];
// The Sunday that Fresh start installs when "Sundays are rest days" is on.
const REST_SUNDAY = [
  {key:'checkin', start:'08:30', end:'08:35', tag:'CHECK IN', text:'Weight, sleep, energy and your top 3. Two minutes.', kind:'checkin'},
  {key:'mobility', start:'08:35', end:'08:50', tag:'MOBILITY', text:'15 min of easy mobility.', kind:'mobility', minutes:15},
  {key:'morning', start:'08:50', end:'10:15', tag:'', text:'Easy morning: breakfast, coffee, get ready.', kind:'marker'},
  {key:'church', start:'10:30', end:'13:00', tag:'CHURCH', text:'Phone away. Be there.', kind:'marker'},
  {key:'lunch', start:'13:00', end:'14:00', tag:'', text:'Lunch with people you like.', kind:'marker'},
  {key:'rest', start:'14:00', end:'15:00', tag:'', text:'Rest: nap, walk, read. No laptop.', kind:'marker'},
  {key:'play', start:'15:00', end:'17:00', tag:'PLAY', text:'Open play for fun. No drilling, no scorekeeping unless you want to.', kind:'session', sessionType:'Rec play', hours:2},
  {key:'free', start:'17:00', end:'18:30', tag:'', text:"Free: girlfriend, family, friends. Grab the week's groceries if you need them.", kind:'marker'},
  {key:'dinner', start:'18:30', end:'19:30', tag:'', text:'Dinner. Then easy.', kind:'marker'},
  {key:'review', start:'19:30', end:'19:50', tag:'REVIEW + PLAN', text:"20 min: biggest leak + one fix (Week tab), read next week in the Roadmap, glance at Monday's calls.", kind:'task'},
  {key:'watch', start:'20:30', end:'21:00', tag:'WATCH', text:'30 min of pro pickleball, only if you feel like it.', kind:'watch', minutes:30},
  {key:'checkout', start:'21:00', end:'21:15', tag:'CHECK OUT', text:'Your numbers fill in by themselves. Add your win, tomorrow\'s fix and notes.', kind:'checkout'},
  {key:'bed', start:'22:30', end:'23:59', tag:'', text:'Bed. Alarm 6:30.', kind:'marker'},
];
const STAGES = ['New lead','Contacted','Talking','Demo booked','Proposal sent','Won','Not now','Lost'];
const STAGE_RANK = {'New lead':0,'Contacted':1,'Talking':2,'Demo booked':3,'Proposal sent':4,'Won':5};
const SESSION_TYPES = ['Drill','Competitive','Rec play','Tournament','Lesson'];
const AREAS = ['Sales','Build','Pickleball','Body','Money','Move','DoD','Fix','Other'];
const CADENCE = [
  {type:'call', label:'Call (touch 1 of 5)'},
  {type:'call', gap:2, label:'Call again (touch 2 of 5)'},
  {type:'dm', gap:2, label:'Instagram DM (touch 3 of 5)'},
  {type:'call', gap:3, label:'Call (touch 4 of 5)'},
  {type:'email', gap:6, label:'Last email (touch 5 of 5)'}
];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DOW_LONG = {Sun:'Sunday', Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday'};
// What a block can be. "session:<type>" is pickleball court time: checking it off logs a session.
// The third value limits a type to one-off items ('day') or to the weekly plan ('week').
const ITEM_TYPES = [
  ['event','Appointment or event','day'],
  ['session:Drill','Pickleball: drill'],
  ['session:Competitive','Pickleball: competitive'],
  ['session:Rec play','Pickleball: rec play'],
  ['session:Tournament','Pickleball: tournament'],
  ['session:Lesson','Pickleball: lesson'],
  ['task','To-do block'],
  ['gym','Gym'],
  ['mobility','Mobility'],
  ['watch','Pro video or study'],
  ['calls','Call block'],
  ['marker','Just a note, no checkbox'],
];
const ONEOFF_TAG = {event:'EVENT', task:'TO-DO', gym:'GYM', mobility:'MOBILITY', watch:'STUDY', marker:'NOTE', calls:'CALLS'};

/* ---------- state ---------- */
const S = {
  dbState:'loading', err:null,
  data:{config:{},days:{},tasks:{},leads:{},sessions:{},dupr:{},weeks:{},meta:{},push:{},events:{},chat:{},campaigns:{},prospects:{},replies:{},outreach:{},suppress:{}},
  got:{},
  view:'today', drafts:{}, openItem:null, editAM:false, editPM:false,
  callFilter:'due', search:'', leadForm:null,
  weekOffset:0, weekDay:null, day:null, modal:null, toast:null, lastUndo:null, confirm:null,
  sync:null, email:'', installEvt:null, installDismissed:undefined, updateApp:null,
  connectBusy:false, connectErr:null, loginBusy:false, loginErr:null, notif:null, notifBusy:false, callMode:null,
  chatBusy:false, chatErr:null, listening:false, assist:null, swipeKey:null, flash:null,
  outEng:null, emFilter:'all', emCamp:'all', emSearch:'', emLimit:40, emReplies:'all', emRLimit:25, emImport:null, emTestBusy:false,
  pipeView:'board', pipeHeat:'all', pipeSource:'all', pipeStage:'all', pipeSort:'heat', pipeLimit:50
};
let db = null;
let theme = 'auto';
try { const v = localStorage.getItem('lcc-theme'); if (THEMES.includes(v)) theme = v; } catch(e) {}
function applyTheme() {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  try { localStorage.setItem('lcc-theme', theme); } catch(e) {}
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (theme === 'auto') m.content = (m.media || '').includes('dark') ? '#0E1320' : '#F2F4F7';
    else m.content = bg;
  });
}
try { const v = localStorage.getItem('lcc-view'); if (v && VIEWS.some(x => x[0] === v)) S.view = v; } catch(e) {}
try { const v = localStorage.getItem('lcc-pipe-view'); if (['board','calls','all'].includes(v)) S.pipeView = v; } catch(e) {}
if (location.hash && VIEWS.some(x => '#' + x[0] === location.hash)) S.view = location.hash.slice(1);

/* ---------- utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y, (m||1)-1, d||1); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate()+n); return iso(d); };
const todayISO = () => iso(new Date());
const dowOf = s => DOW[parseISO(s).getDay()];
const weekStartOf = s => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return iso(d); };
const daysBetween = (a,b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const fmtDay = s => s ? parseISO(s).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : '';
const fmtShort = s => s ? parseISO(s).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
const fmtLong = s => parseISO(s).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
const toMin = t => { if (!t) return 0; const [h,m] = t.split(':').map(Number); return h*60+(m||0); };
const nowMin = () => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); };
const fmtT = t => { if (!t) return ''; let [h,m] = t.split(':').map(Number); h = h%12 || 12; return `${h}:${pad(m)}`; };
const fmtTap = t => { if (!t) return ''; const [h] = t.split(':').map(Number); return fmtT(t) + (h >= 12 ? ' pm' : ' am'); };
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/[$,\s]/g,'')); return isFinite(n) ? n : null; };
const money = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const nextWeekday = s => { let d = addDays(s,1); while (['Sat','Sun'].includes(dowOf(d))) d = addDays(d,1); return d; };
const regionName = r => r === 'IA' ? 'Iowa' : r === 'AZ' ? 'Arizona' : '';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtMins = n => n >= 60 ? `${Math.floor(n/60)} h${n % 60 ? ' ' + (n % 60) + ' min' : ''}` : `${n} min`;
function deepMerge(a, b) {
  const out = (a && typeof a === 'object' && !Array.isArray(a)) ? {...a} : {};
  for (const [k,v] of Object.entries(b || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  }
  return out;
}
const draft = (id, def) => S.drafts[id] !== undefined ? S.drafts[id] : (def ?? '');
const fval = id => S.drafts[id] !== undefined ? S.drafts[id] : (document.getElementById(id) || {}).value || '';
const clearDrafts = prefix => { Object.keys(S.drafts).forEach(k => { if (k.startsWith(prefix)) delete S.drafts[k]; }); };

/* ---------- data getters ---------- */
const cfg = () => S.data.config || {};
const profile = () => cfg().profile || {};
const targets = () => profile().targets || {};
const scheduleFor = d => ((cfg().schedule || {}).days || {})[dowOf(d)] || [];
const roadmap = () => ((cfg().roadmap || {}).weeks || []).slice().sort((a,b) => a.start < b.start ? -1 : 1);
const roadmapFor = d => { let cur = null; roadmap().forEach(w => { if (w.start <= d) cur = w; }); return cur; };
const dayOf = d => S.data.days[d] || {};
const restDays = () => { const r = profile().restDays; return Array.isArray(r) ? r : ['Sun']; };
const eventsOn = d => Object.entries(S.data.events || {}).map(([id, e]) => ({id, ...e})).filter(e => e.date === d && e.start).sort((a,b) => a.start < b.start ? -1 : 1);
const byStart = (a, b) => toMin(a.start) - toMin(b.start);
const hhmm = m => { m = Math.max(0, Math.min(24*60 - 1, Math.round(m))); return `${pad(Math.floor(m/60))}:${pad(m % 60)}`; };
const isHM = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const minsOf = i => Math.max(0, toMin(i.end || i.start) - toMin(i.start));
// A one-off item (events collection) as a block. It can be any type: an appointment, court time, gym…
const eventItem = e => {
  const kind = e.kind && e.kind !== 'event' ? e.kind : 'event', mins = minsOf(e);
  return {key:'ev-' + e.id, start:e.start, end:e.end || e.start, kind, eventId:e.id, oneoff:true, notes:e.notes,
    tag: e.tag || (kind === 'session' ? (e.sessionType || 'Court time') : (ONEOFF_TAG[kind] || 'EVENT')),
    text: e.title + (e.where ? ' · ' + e.where : ''),
    sessionType: kind === 'session' ? (e.sessionType || 'Drill') : undefined,
    hours: kind === 'session' ? (Math.round(mins / 30) / 2 || 1) : undefined,
    minutes: ['mobility','watch'].includes(kind) && mins ? mins : undefined,
    quota: kind === 'calls' ? (Number(e.quota) || 10) : undefined, region: kind === 'calls' ? (e.region || '') : undefined,
    movedFromDay: e.from && e.from.date ? e.from.date : undefined};
};
// One-off moves for a date: days/<date>.moves = {key: {start, end}}. null means back to the usual time.
const movesOn = d => dayOf(d).moves || {};
// Everything on a given day: the weekly schedule with that date's moves, plus one-off items, in time order.
const itemsFor = d => {
  const mv = movesOn(d);
  return [...scheduleFor(d).map(i => { const m = mv[i.key]; return m && m.start ? {...i, start:m.start, end:m.end || i.end, movedFrom:i.start, movedFromEnd:i.end} : i; }),
    ...eventsOn(d).map(eventItem)].sort(byStart);
};
// What a day's plan shows: notes (wake up, shower…) that Build my day hid for that date stay out.
const planItems = d => itemsFor(d).filter(i => i.kind !== 'marker' || !((dayOf(d).skips || {})[i.key]));
const templateDay = dow => clone(((cfg().schedule || {}).days || {})[dow] || []);
const templateItem = (dow, key) => (((cfg().schedule || {}).days || {})[dow] || []).find(i => i.key === key);
const typeOf = i => i.kind === 'session' ? 'session:' + (i.sessionType || 'Drill') : (i.kind || 'task');
const splitType = v => { const [kind, st] = String(v || 'task').split(':'); return {kind, sessionType: kind === 'session' ? (st || 'Drill') : undefined}; };
const carryable = kind => ['task','gym','mobility','watch','session','dupr'].includes(kind);
const itemName = i => i.tag || String(i.text || '').split(/[.:,·]/)[0].trim().slice(0, 32) || 'Block';
const listNames = xs => { const n = xs.map(itemName); return n.length <= 2 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
// The other blocks that share any time with start–end on a date.
function overlaps(date, start, end, exceptKey) {
  const s = toMin(start), e = Math.max(toMin(end || start), s + 1);
  return itemsFor(date).filter(i => { const a = toMin(i.start), b = Math.max(toMin(i.end || i.start), a + 1); return i.key !== exceptKey && a < e && s < b; });
}
function daysLabel(days) {
  const set = WEEK_ORDER.filter(x => days.includes(x));
  if (set.length === 7) return 'every day';
  if (set.join() === 'Mon,Tue,Wed,Thu,Fri') return 'every weekday';
  if (set.length === 1) return 'every ' + DOW_LONG[set[0]];
  return set.slice(0, -1).join(', ') + ' and ' + set[set.length - 1];
}
const nextDow = (from, dow) => { for (let n = 0; n < 7; n++) { const d = addDays(from, n); if (dowOf(d) === dow) return d; } return from; };
const fmtDayLong = s => s ? parseISO(s).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'}) : '';
const dayWord = d => d === todayISO() ? 'today' : d === addDays(todayISO(), 1) ? 'tomorrow' : fmtDay(d);
// Rest days come from the profile; any single day can also be taken off (days/<date>.off).
const isRestDay = d => restDays().includes(dowOf(d)) || !!dayOf(d).off;
const isCheckable = i => i.kind !== 'marker';
const dialsFor = (d, region) => (dayOf(d).calls || []).filter(c => c.dial && (!region || c.region === region)).length;
const callsCount = (d, f) => (dayOf(d).calls || []).filter(c => c[f]).length;
function isDone(i, d) {
  const day = dayOf(d);
  if (day.skips && day.skips[i.key]) return true;
  switch (i.kind) {
    case 'checkin': return !!(day.am && day.am.savedAt);
    case 'checkout': return !!(day.pm && day.pm.savedAt);
    case 'calls': return !!(day.checks && day.checks[i.key]) || dialsFor(d, i.region) >= (i.quota || 0);
    case 'dupr': return !!(day.checks && day.checks[i.key]) || Object.values(S.data.dupr).some(x => x.date === d);
    case 'marker': return false;
    default: return !!(day.checks && day.checks[i.key]);
  }
}
const isSkipped = (i, d) => !!((dayOf(d).skips || {})[i.key]);
const liveTasks = () => Object.entries(S.data.tasks).map(([id,t]) => ({id, ...t})).filter(t => t.title);
const tasksCarried = d => liveTasks().filter(t => !t.done && !t.dropped && t.due && t.due < d).sort((a,b) => a.due < b.due ? -1 : a.due > b.due ? 1 : (a.title < b.title ? -1 : 1));
const tasksDue = d => liveTasks().filter(t => !t.done && !t.dropped && t.due === d).sort((a,b) => (a.kind === 'fix' ? -1 : 0) - (b.kind === 'fix' ? -1 : 0) || (a.title < b.title ? -1 : 1));
const tasksDoneOn = d => liveTasks().filter(t => t.done && t.doneOn === d);
function leadsDue(d) {
  return Object.entries(S.data.leads).map(([id,l]) => ({id, ...l}))
    .filter(l => l.stage !== 'Lost' && l.callList !== false && l.nextDate && l.nextDate <= d);
}
const leadSortDue = (a,b) => {
  const g = l => l.type === 'Cold' ? (l.region === 'IA' ? 1 : l.region === 'AZ' ? 2 : 3) : 0;
  return g(a) - g(b) || (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''));
};
function weights() {
  return Object.values(S.data.days).filter(d => d.date && d.am && num(d.am.weight)).map(d => ({date:d.date, w:num(d.am.weight)})).sort((a,b) => a.date < b.date ? -1 : 1);
}
function avg7(end) {
  const from = addDays(end, -6);
  const ws = weights().filter(x => x.date >= from && x.date <= end);
  return ws.length ? ws.reduce((a,b) => a + b.w, 0) / ws.length : null;
}
function duprList() { return Object.values(S.data.dupr).filter(x => x.date && num(x.rating)).sort((a,b) => a.date < b.date ? -1 : 1); }
function lastFix(d) {
  const ws = weekStartOf(d);
  const w = S.data.weeks[addDays(ws,-7)] || {};
  return w.fix || '';
}

/* ---------- writes ---------- */
const queues = {};
function enqueue(path, fn) {
  const p = (queues[path] || Promise.resolve()).catch(() => {}).then(fn);
  queues[path] = p.catch(e => { writeError(e); });
  return queues[path];
}
function writeError(e) {
  const code = e && e.code;
  const msg = code === 'quota_exceeded' ? 'Storage is full. Delete old sessions or leads, then try again.'
    : code === 'invalid_argument' ? "Couldn't save that. Make sure you're signed in to your own account."
    : "Couldn't save. Check your connection and try again.";
  toast(msg);
}
function setDoc(col, id, data) {
  if (!db) return Promise.resolve();
  S.data[col] = {...S.data[col], [id]: data};
  return enqueue(col + '/' + id, () => db.collection(col).doc(id).set(data));
}
function patchDoc(col, id, patch) {
  if (!db) return Promise.resolve();
  S.data[col] = {...S.data[col], [id]: deepMerge((S.data[col] || {})[id] || {}, patch)};
  return enqueue(col + '/' + id, () => db.collection(col).doc(id).update(patch));
}
function delDoc(col, id) {
  if (!db) return Promise.resolve();
  if (S.data[col]) { const o = {...S.data[col]}; delete o[id]; S.data[col] = o; }
  return enqueue(col + '/' + id, () => db.collection(col).doc(id).delete());
}
const patchDay = (d, patch) => patchDoc('days', d, deepMerge({date:d}, patch));
// Undo for schedule edits: a list of writes that put things back.
function runOps(ops) { (ops || []).forEach(op => { if (op.set) setDoc(...op.set); else if (op.patch) patchDoc(...op.patch); else if (op.del) delDoc(...op.del); }); }

/* ---------- moving blocks ---------- */
// Move a block on one date ('day'), or in the weekly plan for that weekday ('week').
// One-off items move themselves. Returns a short description for the toast, or '' when nothing moved.
function moveBlock(date, key, start, end, scope) {
  const i = itemsFor(date).find(x => x.key === key);
  if (!i || !isHM(start)) return '';
  if (!isHM(end) || toMin(end) < toMin(start)) end = start;
  const when = `${fmtTap(start)}${end !== start ? '–' + fmtTap(end) : ''}`;
  if (i.eventId) {
    const e = (S.data.events || {})[i.eventId]; if (!e) return '';
    S.lastUndo = {type:'restore', ops:[{set:['events', i.eventId, clone(e)]}]};
    setDoc('events', i.eventId, {...e, start, end, updatedAt:Date.now()});
    return `Moved ${itemName(i)} to ${when}.`;
  }
  const dow = dowOf(date);
  if (scope === 'week') {
    const arr = templateDay(dow), ti = arr.find(x => x.key === key); if (!ti) return '';
    const prevMove = movesOn(date)[key];
    S.lastUndo = {type:'restore', ops:[{patch:['config', 'schedule', {days:{[dow]:templateDay(dow)}}]}, ...(prevMove ? [{patch:['days', date, {moves:{[key]:prevMove}}]}] : [])]};
    ti.start = start; ti.end = end;
    if (ti.kind === 'session') ti.hours = Math.round((toMin(end) - toMin(start)) / 30) / 2 || ti.hours;
    patchDoc('config', 'schedule', {days:{[dow]:arr.sort(byStart)}});
    if (prevMove) patchDay(date, {moves:{[key]:null}});
    return `Moved ${itemName(i)} to ${when} every ${DOW_LONG[dow]}.`;
  }
  const ti = templateItem(dow, key); if (!ti) return '';
  S.lastUndo = {type:'restore', ops:[{patch:['days', date, {moves:{[key]:movesOn(date)[key] || null}}]}]};
  const usual = ti.start === start && (ti.end || ti.start) === end;
  patchDay(date, {moves:{[key]: usual ? null : {start, end}}});
  return usual ? `${itemName(i)} is back at ${when}.` : `Moved ${itemName(i)} to ${when}, ${dayWord(date)} only.`;
}
// Reschedule to another date: cancel it on this date and put a one-off copy on the new one.
// One-off items just change their date.
function moveToDay(date, key, toDate) {
  const i = itemsFor(date).find(x => x.key === key);
  if (!i || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || toDate === date) return '';
  const when = `${dayWord(toDate)} at ${fmtTap(i.start)}`;
  if (i.eventId) {
    const e = (S.data.events || {})[i.eventId]; if (!e) return '';
    S.lastUndo = {type:'restore', ops:[{set:['events', i.eventId, clone(e)]}]};
    setDoc('events', i.eventId, {...e, date:toDate, updatedAt:Date.now()});
    return `Moved ${itemName(i)} to ${when}.`;
  }
  if (['checkin','checkout','dupr'].includes(i.kind)) return '';
  const id = 'ev-' + Date.now().toString(36);
  const doc = {title:i.text || i.tag || 'Block', tag:i.tag || '', date:toDate, start:i.start, end:i.end || i.start, where:'', notes:'', kind:i.kind, from:{date, key}, createdAt:Date.now(), updatedAt:Date.now()};
  if (i.kind === 'session') doc.sessionType = i.sessionType || 'Drill';
  if (i.kind === 'calls') { doc.quota = i.quota || 10; doc.region = i.region || ''; }
  const prevSkip = !!((dayOf(date).skips || {})[key]);
  setDoc('events', id, doc);
  patchDay(date, {skips:{[key]:true}});
  S.lastUndo = {type:'restore', ops:[{del:['events', id]}, {patch:['days', date, {skips:{[key]:prevSkip}}]}]};
  return `Moved ${itemName(i)} to ${when}. It's canceled ${dayWord(date)}.`;
}
function moveBy(date, key, mins, scope) {
  const i = itemsFor(date).find(x => x.key === key); if (!i) return;
  const len = minsOf(i), start = hhmm(toMin(i.start) + mins);
  const msg = moveBlock(date, key, start, hhmm(Math.min(toMin(start) + len, 24*60 - 1)), scope);
  if (msg) { S.flash = {key, at:Date.now()}; toast(msg, true); }
}
// The Starts / Ends boxes in a block sheet. Changing the start keeps the length.
function moveTime(el) {
  const d = el.dataset, date = d.date || todayISO(), i = itemsFor(date).find(x => x.key === d.key);
  if (!i || !isHM(el.value)) return;
  let start = i.start, end = i.end || i.start;
  if (el.id === 'mv-start') { start = el.value; end = hhmm(Math.min(toMin(start) + minsOf(i), 24*60 - 1)); }
  else { end = el.value; if (toMin(end) < toMin(start)) { toast('The end is before the start. Change the start first.'); return; } }
  const msg = moveBlock(date, d.key, start, end, (S.modal && S.modal.scope) || 'day');
  if (msg) { S.flash = {key:d.key, at:Date.now()}; toast(msg, true); }
}
function resetMove(date, key) {
  const ti = templateItem(dowOf(date), key); if (!ti) return;
  S.lastUndo = {type:'restore', ops:[{patch:['days', date, {moves:{[key]:movesOn(date)[key] || null}}]}]};
  patchDay(date, {moves:{[key]:null}});
  toast(`${itemName(ti)} is back at ${fmtTap(ti.start)}.`, true);
}

/* ---------- fresh start ---------- */
// The Monday the app went live. The first load after this version applies a fresh start
// once by itself, so nothing from before shows as late and Sundays rest, without a tap.
const AUTO_FRESH_DATE = '2026-10-05';
function applyFreshStart(date, sun) {
  const t = todayISO();
  let moved = 0, dropped = 0, leadsMoved = 0;
  for (const x of liveTasks()) {
    if (x.done || x.dropped) continue;
    const {id, ...body} = x;
    if (['makeup','top3'].includes(x.kind)) { setDoc('tasks', id, {...body, dropped:true, droppedOn:t}); dropped++; }
    else if (x.due && x.due < date) { setDoc('tasks', id, {...body, due:date, origDue:x.origDue || x.due}); moved++; }
  }
  for (const [id, l] of Object.entries(S.data.leads)) {
    if (l.stage !== 'Lost' && l.nextDate && l.nextDate < date) { setDoc('leads', id, {...l, nextDate:date, updatedAt:Date.now()}); leadsMoved++; }
  }
  setDoc('meta', 'rollover', {through:addDays(date, -1), at:new Date().toISOString(), created:0, freshStart:date});
  const prof = {startDate:date}; if (sun) prof.restDays = ['Sun'];
  patchDoc('config', 'profile', prof);
  if (sun) patchDoc('config', 'schedule', {days:{Sun:REST_SUNDAY}});
  return {moved, dropped, leadsMoved};
}
// Both one-time runs decide once per page load and record themselves before any other write:
// a sync update can briefly hand back the stored copy of meta while later writes are queued.
let autoFreshChecked = false, restartChecked = false;
function maybeAutoFreshStart() {
  if (autoFreshChecked) return false;
  autoFreshChecked = true;
  const setup = S.data.meta.setup || {}, roll = S.data.meta.rollover || {};
  if (setup.freshStart || roll.freshStart) return false;
  if ((profile().startDate || '') >= AUTO_FRESH_DATE) return false;
  const t = todayISO(), date = t > AUTO_FRESH_DATE ? t : AUTO_FRESH_DATE;
  patchDoc('meta', 'setup', {freshStart:date, at:new Date().toISOString(), version:APP_VERSION});
  const r = applyFreshStart(date, true);
  toast(`Fresh start: the plan begins ${fmtDay(date)}. ${plural(r.moved,'to-do')} and ${plural(r.leadsMoved,'follow-up')} moved there. Sundays are rest days.`);
  return true;
}

// Asked for on Monday, Oct 5: "start everything tomorrow". Monday held work on the Leah Roling
// app (InnerBoard OS) and three pickleball sessions (6 to 8, 12 to 2, 4:30 to 6:30). On the first
// load on or before Tuesday this runs once: a fresh start on Tuesday that leaves Sunday's plan
// alone, Monday as a day off, and Monday's work recorded. Every write checks first, so nothing
// you already logged is doubled. Recorded in meta/setup.restart.
const RESTART_DATE = '2026-10-06';
function maybeRestart() {
  if (restartChecked) return false;
  restartChecked = true;
  const setup = S.data.meta.setup || {};
  if (setup.restart || todayISO() > RESTART_DATE) return false;
  patchDoc('meta', 'setup', {restart:RESTART_DATE, restartAt:new Date().toISOString(), version:APP_VERSION});
  const mon = addDays(RESTART_DATE, -1);
  const r = applyFreshStart(RESTART_DATE, false);
  patchDay(mon, {off:true});
  const logged = logMonday(mon);
  toast(`Fresh start: everything begins ${todayISO() === RESTART_DATE ? 'today' : 'tomorrow'}, ${fmtDay(RESTART_DATE)}. Monday is a day off${logged ? `. Logged ${logged}` : ''}. ${plural(r.moved, 'to-do')} and ${plural(r.leadsMoved, 'follow-up')} moved to ${fmtDay(RESTART_DATE)}.`, false, {act:'toast-close', label:'Got it', sticky:true});
  return true;
}
function logMonday(mon) {
  const sess = S.data.sessions || {}, ch = dayOf(mon).checks || {};
  const parts = [];
  let n = 0;
  const logBlock = (key, type, hours) => {
    const sid = `auto-${mon}-${key}`;
    if (!sess[sid]) { setDoc('sessions', sid, {date:mon, type, hours, rated:false, auto:true, createdAt:Date.now()}); }
    if (!ch[key]) patchDay(mon, {checks:{[key]:true}});
    n++;
  };
  for (const key of ['drill', 'play']) {
    const b = scheduleFor(mon).find(i => i.key === key && i.kind === 'session');
    if (b) logBlock(key, b.sessionType || 'Rec play', b.hours || 2);
  }
  const noon = eventsOn(mon).map(eventItem).find(i => i.kind === 'session' && toMin(i.start) >= 11*60 && toMin(i.start) <= 13*60);
  const other = Object.entries(S.data.sessions || {}).some(([id, x]) => x && x.date === mon && id !== `auto-${mon}-drill` && id !== `auto-${mon}-play`);
  if (noon) logBlock(noon.key, noon.sessionType || 'Rec play', noon.hours || 2);
  else if (!other) { setDoc('sessions', `s-${mon}-noon`, {date:mon, type:'Rec play', hours:2, rated:false, notes:'12 to 2 pm', createdAt:Date.now()}); n++; }
  else n++;
  if (n) parts.push(`your ${n === 1 ? 'pickleball session' : n + ' pickleball sessions'}`);
  const wid = `w-${mon}-innerboard`;
  if (!S.data.tasks[wid]) setDoc('tasks', wid, {title:'Updates on the Leah Roling app (InnerBoard OS)', due:mon, origDue:mon, area:'Build', notes:'', done:true, doneOn:mon, kind:'task', createdAt:Date.now()});
  const leadId = S.data.leads['leah-roling-innerboard-os'] ? 'leah-roling-innerboard-os' : Object.keys(S.data.leads).find(id => /roling/i.test(S.data.leads[id].name || ''));
  const line = `${mon.slice(5).replace('-', '/')}: Worked on app updates.`;
  if (leadId && !String(S.data.leads[leadId].notes || '').includes(line)) patchDoc('leads', leadId, {notes:(S.data.leads[leadId].notes ? S.data.leads[leadId].notes + '\n' : '') + line, updatedAt:Date.now()});
  parts.push('the InnerBoard app work');
  return parts.join(' and ');
}

/* ---------- rollover automation ---------- */
let rollTimer = null, rolling = false;
const allLoaded = () => COLS.every(c => S.got[c]);
function maybeRollover() {
  if (!db || !allLoaded() || rolling || !cfg().schedule || !db.status().loaded) return;
  maybeAutoFreshStart();
  maybeRestart();
  maybeSeedOutreach();
  const y = addDays(todayISO(), -1);
  const through = (S.data.meta.rollover || {}).through;
  if (through && through >= y) return;
  clearTimeout(rollTimer);
  rollTimer = setTimeout(runRollover, 2500);
}
async function runRollover() {
  if (rolling) return; rolling = true;
  try {
    const t = todayISO(), y = addDays(t, -1);
    const through = (S.data.meta.rollover || {}).through;
    if (through && through >= y) return;
    let start = through ? addDays(through, 1) : y;
    if (daysBetween(start, y) > 2) start = addDays(y, -2);
    const appStart = profile().startDate || start;
    if (start < appStart) start = appStart;
    const made = [];
    for (let d = start; d <= y; d = addDays(d, 1)) {
      const day = dayOf(d), next = addDays(d, 1), dw = dowOf(d);
      for (const i of isRestDay(d) ? [] : scheduleFor(d)) {
        if (isSkipped(i, d)) continue;
        if (i.kind === 'calls') {
          const short = (i.quota || 0) - dialsFor(d, i.region);
          if (short > 0 && !(day.checks || {})[i.key]) made.push({id:`mk-${d}-${i.key}`, title:`Make up ${short} ${regionName(i.region)} dials (short on ${dw})`, due:next, area:'Sales', kind:'makeup'});
        } else if (i.carry && !isDone(i, d)) {
          made.push({id:`mk-${d}-${i.key}`, title:`Make up: ${i.short || i.text} (missed ${dw})`, due:next, area:i.area || 'Other', kind:'makeup'});
        }
      }
      ((day.am || {}).top3 || []).forEach((x, n) => {
        if (x && x.t && !x.done) made.push({id:`t3-${d}-${n}`, title:x.t, notes:`From ${dw}'s top 3`, due:next, area:'Other', kind:'top3'});
      });
    }
    for (const m of made) {
      if (S.data.tasks[m.id]) continue;
      const {id, ...body} = m;
      await setDoc('tasks', id, {...body, done:false, origDue:body.due, createdAt:Date.now()});
    }
    await setDoc('meta', 'rollover', {through:y, at:new Date().toISOString(), created:made.length});
    if (made.length) toast(`${plural(made.length,'unfinished item')} from yesterday moved to today.`);
  } catch (e) { writeError(e); }
  finally { rolling = false; }
}

/* ---------- rendering ---------- */
let rq = false, pendingRender = false;
function isTyping() {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest('#app,#modal')) return false;
  return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['checkbox','radio','button','submit'].includes(a.type));
}
function scheduleRender() {
  if (rq) return; rq = true;
  requestAnimationFrame(() => { rq = false; if (isTyping()) { pendingRender = true; return; } render(); });
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !isTyping()) { pendingRender = false; render(); } }, 0));

function render() {
  renderHeader();
  const app = document.getElementById('app');
  let html;
  if (S.dbState === 'config') html = connectView();
  else if (S.dbState === 'auth') html = loginView();
  else if (S.dbState === 'error') html = `<div class="card empty"><b>Couldn't load your data.</b><br>${esc(S.err || 'Check your connection and try again.')}<div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="retry">Try again</button><button class="btn ghost" data-act="signout">Sign out</button></div></div>`;
  else if (!allLoaded()) html = `<div class="skel"><div class="skel-line w40"></div><div class="skel-box"></div><div class="skel-box tall"></div></div>`;
  else if (!cfg().schedule) html = importView();
  else html = ({today:viewToday, calls:viewPipeline, email:viewEmail, week:viewWeek, log:viewLog, plan:viewPlan})[S.view]();
  app.innerHTML = html;
  renderTabs(); renderModal(); renderToast();
}
function renderHeader() {
  const t = todayISO(), p = profile();
  const days = p.moveDate ? Math.max(0, daysBetween(t, p.moveDate)) : null;
  document.getElementById('hdr').innerHTML = `<div class="min0"><div class="eyebrow">Life Command Center${syncChip()}</div><h1>${esc(fmtLong(t))}</h1></div>` +
    (days !== null ? `<div class="count"><b>${days}</b><span>days to<br>Scottsdale</span></div>` : '');
}
function renderTabs() {
  const fab = document.getElementById('fab');
  if (fab) fab.hidden = !(S.dbState === 'ok' && allLoaded() && cfg().schedule);
  if (S.dbState !== 'ok') { document.getElementById('tabs').innerHTML = ''; return; }
  const due = allLoaded() && !isRestDay(todayISO()) ? leadsDue(todayISO()).length : 0;
  const hot = allLoaded() ? emHot().length : 0;
  const badge = k => k === 'calls' && due ? `<span class="badge">${due}</span>` : k === 'email' && hot ? `<span class="badge hot" title="Hot replies">${hot}</span>` : '';
  document.getElementById('tabs').innerHTML = VIEWS.map(([k,l]) =>
    `<button data-act="view" data-v="${k}" class="${S.view === k ? 'on' : ''}" aria-current="${S.view === k ? 'page' : 'false'}">${ICONS[k]}<span>${l}</span>${badge(k)}</button>`).join('');
}

/* ----- TODAY ----- */
function viewToday() {
  if (S.day && S.day > todayISO()) return viewDay(S.day);
  S.day = null;
  const t = todayISO(), day = dayOf(t), items = planItems(t), rest = isRestDay(t);
  const checkable = items.filter(isCheckable);
  const doneN = checkable.filter(i => isDone(i, t)).length;
  const carried = tasksCarried(t), due = tasksDue(t), doneTasks = tasksDoneOn(t);
  const wk = roadmapFor(t);
  const pct = checkable.length ? Math.round(doneN / checkable.length * 100) : 0;
  const behind = rest ? 0 : checkable.filter(i => !isDone(i,t) && toMin(i.end || i.start) <= nowMin()).length;
  // On a laptop the main column holds the plan and the side column the forms; on a phone
  // the ord-* classes put everything back in one sensible order.
  const main = [
    wk ? `<div class="week-banner ord-1"><div class="eyebrow">This week</div><b>${esc(wk.focus)}</b>${wk.musts ? `<details><summary>Must-dos this week</summary><div class="meta" style="margin-top:4px;color:var(--ink-2)">${esc(wk.musts)}</div></details>` : ''}</div>` : '',
    rest && day.off ? `<div class="rest-banner ord-2"><div class="eyebrow">Day off</div><b>Today doesn't count.</b><div class="meta">Nothing is late and nothing turns into a make-up.${profile().startDate === addDays(t, 1) ? ' Everything starts fresh tomorrow.' : ''} Check off anything you did anyway.</div><div class="btnrow" style="margin-top:8px"><button class="btn sm ghost" data-act="day-off" data-on="0">It's not a day off</button></div></div>`
    : rest ? `<div class="rest-banner ord-2"><div class="eyebrow">Rest day</div><b>Church, rest and pickleball.</b><div class="meta">Nothing counts as late today.${carried.length ? ` ${plural(carried.length,'to-do')} will be waiting for you tomorrow.` : ''}</div></div>` : '',
    `<div class="progress ord-3 ${pct === 100 ? 'good' : ''}"><div class="bar"><i style="width:${pct}%"></i></div><span class="meta mono">${doneN}/${checkable.length} blocks</span>${behind ? `<button class="pill warn tap" data-act="catchup" title="Sort out what you missed">${behind} behind · Catch up</button>` : ''}${carried.length && !rest ? `<span class="pill bad">${carried.length} carried over</span>` : ''}</div>`,
    nowCard(items.filter(i => !(isCheckable(i) && isSkipped(i, t))), t),
    `<section class="card ord-7"><div class="card-h"><h2>Today's plan</h2><div class="btnrow"><button class="btn sm" data-act="sched-open" data-date="${t}">Edit</button><button class="btn sm" data-act="quick-open">+ Add</button></div></div>${buildBar(t)}${planList(items, t, day)}</section>`,
  ];
  const side = [
    amCard(t, day),
    carried.length && !rest ? `<section class="card ord-6"><div class="card-h"><h2>Carried over</h2><span class="meta">Not done yet, so they moved to today</span></div>${taskList(carried, t)}</section>` : '',
    `<section class="card ord-8"><div class="card-h"><h2>To-dos due today</h2><span class="meta">${due.length ? plural(due.length,'item') : 'All clear'}</span></div>
      ${due.length + carried.length > 6 && !rest ? `<div class="overload"><span>${due.length + carried.length} to-dos today${carried.length ? ', counting the carried-over ones. That' : ''} is a lot.</span><button class="btn sm" data-act="spread">Spread over the week</button></div>` : ''}
      ${taskList(due, t) || '<div class="meta">Nothing else due today.</div>'}
      ${addTaskForm('qt', t)}
      ${doneTasks.length ? `<details style="margin-top:8px"><summary>Done today (${doneTasks.length})</summary>${doneTasks.map(x => taskRow(x, t)).join('')}</details>` : ''}
    </section>`,
    pipeTodayCard(t),
    pmCard(t, day)
  ];
  return dayStrip(t) + installBanner() + tipBanner() + `<div class="two"><div class="main">${main.join('')}</div><div class="side">${side.join('')}</div></div>`;
}
// Today, tomorrow and the rest of the week, one tap each, plus the whole week at a glance.
function dayStrip(sel) {
  const t = todayISO();
  const chips = [0,1,2,3,4,5,6].map(n => {
    const d = addDays(t, n), on = d === sel, lbl = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${dowOf(d)} ${parseISO(d).getDate()}`;
    return `<button class="${on ? 'on' : ''} ${isRestDay(d) ? 'rest' : ''}" data-act="day-go" data-date="${d}" aria-pressed="${on}">${esc(lbl)}</button>`;
  }).join('');
  return `<nav class="daystrip" aria-label="Pick a day">${chips}<button class="wk" data-act="week-open">Week</button></nav>`;
}
// Canceled blocks fold into one line under the plan; Show puts them back in place.
function planList(items, d, day) {
  const off = items.filter(i => isCheckable(i) && isSkipped(i, d));
  const shown = S.showCanceled ? items : items.filter(i => !off.includes(i));
  return shown.map(i => planRow(i, d, day)).join('') + (off.length ? `<div class="canceled-foot"><span class="meta">Canceled ${d === todayISO() ? 'today' : 'this day'}: ${esc(listNames(off))}</span><button class="btn sm ghost" data-act="show-canceled">${S.showCanceled ? 'Hide' : 'Show'}</button></div>` : '');
}
const buildBar = d => `<button class="buildbar" data-act="build-open" data-date="${d}"><b>${d === todayISO() ? 'Build my day' : 'Build ' + esc(dayWord(d))}</b><span>Say what's set, like "up at 8, pickleball 11, meeting at 1", and the rest fits around it.</span></button>`;
// Any other day, laid out like Today: its plan, its to-dos, and the same ways to change them.
function viewDay(d) {
  const t = todayISO(), day = dayOf(d), items = planItems(d), rest = isRestDay(d), due = tasksDue(d);
  const blocks = items.filter(isCheckable), canceled = blocks.filter(i => isSkipped(i, d)).length, oneoffs = items.filter(i => i.eventId).length;
  const name = d === addDays(t, 1) ? 'Tomorrow' : DOW_LONG[dowOf(d)];
  const main = [
    `<div class="dayhead ord-1"><div class="min0"><div class="eyebrow">${d === addDays(t, 1) ? 'Tomorrow' : 'Planning ahead'}</div><h2>${esc(fmtDayLong(d))}</h2><div class="meta">${plural(blocks.length - canceled, 'block')}${oneoffs ? ` · ${plural(oneoffs, 'one-off')}` : ''}${canceled ? ` · ${canceled} canceled` : ''} · ${due.length ? plural(due.length, 'to-do') : 'no to-dos'}</div></div><button class="btn sm ghost" data-act="day-go" data-date="${t}">Back to today</button></div>`,
    day.off ? `<div class="rest-banner ord-2"><div class="eyebrow">Day off</div><b>This day doesn't count.</b><div class="meta">Nothing is late and nothing turns into a make-up.</div><div class="btnrow" style="margin-top:8px"><button class="btn sm ghost" data-act="day-off" data-on="0" data-date="${d}">It's not a day off</button></div></div>`
      : rest ? `<div class="rest-banner ord-2"><div class="eyebrow">Rest day</div><b>Church, rest and pickleball.</b><div class="meta">Nothing counts as late that day.</div></div>` : '',
    `<section class="card ord-7"><div class="card-h"><h2>${esc(name)}'s plan</h2><div class="btnrow"><button class="btn sm" data-act="sched-open" data-date="${d}">Edit</button><button class="btn sm" data-act="quick-open" data-date="${d}">+ Add</button></div></div>${buildBar(d)}
      ${items.length ? planList(items, d, day) : '<div class="meta">Nothing planned.</div>'}
      ${day.off ? '' : `<div class="planfoot"><button class="btn sm ghost" data-act="day-off" data-on="1" data-date="${d}">Take this day off</button></div>`}</section>`,
  ];
  const side = [
    `<section class="card ord-8"><div class="card-h"><h2>To-dos due ${esc(d === addDays(t, 1) ? 'tomorrow' : fmtDay(d))}</h2><span class="meta">${due.length ? plural(due.length, 'item') : 'None yet'}</span></div>
      ${taskList(due, d)}${addTaskForm('qd', d)}</section>`,
  ];
  return dayStrip(d) + `<div class="two"><div class="main">${main.join('')}</div><div class="side">${side.join('')}</div></div>`;
}
function tipBanner() {
  let done = false; try { done = !!localStorage.getItem('lcc-tip3-done'); } catch(e) {}
  if (done) return '';
  const desktop = window.matchMedia && matchMedia('(min-width: 980px)').matches;
  const add = ' <b>+ Add</b> understands plain words, like “Pickleball Thu 6-8am” or “Call Lisa tomorrow”.';
  return `<div class="tip"><span><b>Tap any block</b> for the story behind it.${desktop ? ` <b>Rest your pointer on a block or a to-do</b> to push it back, reschedule or cancel it.${add} Keys: <kbd>1</kbd>–<kbd>6</kbd> tabs, <kbd>/</kbd> search leads, <kbd>n</kbd> new to-do, <kbd>s</kbd> schedule, <kbd>e</kbd> add, <kbd>c</kbd> start calling, <kbd>a</kbd> ask.` : ` <b>Swipe a block or a to-do left</b> to push it back, reschedule or cancel it, or <b>right</b> to mark it done.${add}`}</span><button class="btn sm ghost" data-act="tip-done">Got it</button></div>`;
}
function nowCard(items, t) {
  const m = nowMin();
  const cur = items.find(i => toMin(i.start) <= m && m < toMin(i.end || i.start));
  const nextI = items.find(i => toMin(i.start) > m);
  const focus = cur && !(isCheckable(cur) && isDone(cur, t)) ? cur : (nextI || cur);
  if (!focus) return `<div class="now ord-4"><div class="eyebrow">Day's done</div><div class="what">${dayOf(t).pm && dayOf(t).pm.savedAt ? 'Checked out. Rest up.' : 'Do your evening check-out, then you are off.'}</div></div>`;
  const live = focus === cur;
  let extra = '';
  if (focus.kind === 'calls') extra = `<div class="nextline mono">${dialsFor(t, focus.region)}/${focus.quota} ${regionName(focus.region)} dials · ${callsCount(t,'convo')} conversations today</div>`;
  const act = actionFor(focus, t, true);
  const after = items.find(i => toMin(i.start) > toMin(focus.start));
  const mins = live ? toMin(focus.end || focus.start) - m : toMin(focus.start) - m;
  const when = live ? (mins > 0 ? `${fmtMins(mins)} left` : '') : (mins > 0 && mins <= 240 ? `in ${fmtMins(mins)}` : '');
  return `<div class="now ord-4"><div class="eyebrow">${live ? '<span class="live">Now</span>' : 'Up next'} <span class="mono">${fmtTap(focus.start)}${focus.end && focus.end !== focus.start ? '–' + fmtTap(focus.end) : ''}</span>${when ? `<span class="when">· ${when}</span>` : ''}</div>
    <div class="what" data-act="block" data-key="${esc(focus.key)}" role="button" tabindex="0">${focus.tag ? `<span class="tag">${esc(focus.tag)}</span>` : ''}${esc(focus.text)}</div>${extra}
    ${act ? `<div class="acts">${act}</div>` : ''}
    ${after ? `<div class="nextline">Then ${esc(fmtTap(after.start))}: ${esc(after.tag ? after.tag.toLowerCase() : after.text)}</div>` : ''}</div>`;
}
function actionFor(i, t, big) {
  const cls = big ? 'btn' : 'btn sm';
  if (i.kind === 'checkin') return isDone(i,t) ? '' : `<button class="${cls}" data-act="goto" data-id="am-card">Start check-in</button>`;
  if (i.kind === 'checkout') return isDone(i,t) ? '' : `<button class="${cls}" data-act="goto" data-id="pm-card">Start check-out</button>`;
  if (i.kind === 'calls') return `<button class="${cls}" data-act="call-start" data-region="${esc(i.region || '')}">Start calling</button>${big ? `<button class="${cls} ghost" data-act="view" data-v="calls" data-sub="calls">Open calls</button>` : ''}`;
  if (i.kind === 'dupr') return isDone(i,t) ? '' : `<button class="${cls}" data-act="view" data-v="log">Log DUPR</button>`;
  if (i.kind === 'marker') return '';
  if (!big) return '';
  return isDone(i,t) ? `<button class="${cls} ghost" data-act="check" data-key="${esc(i.key)}">Undo</button>` : `<button class="${cls}" data-act="check" data-key="${esc(i.key)}">Mark done</button>`;
}
function planRow(i, t, day) {
  // t is the day shown: today, or another day opened from the day strip (no checking off ahead of time).
  const isToday = t === todayISO(), dd = isToday ? '' : ` data-date="${t}"`;
  const m = nowMin(), done = isCheckable(i) && isDone(i, t), skipped = isSkipped(i, t);
  const isNow = isToday && toMin(i.start) <= m && m < toMin(i.end || i.start);
  const late = isToday && isCheckable(i) && !done && toMin(i.end || i.start) <= m && !isRestDay(t);
  const k = esc(i.key);
  let box;
  if (!isCheckable(i)) box = `<span class="dot" aria-hidden="true"></span>`;
  else if (!isToday) box = `<span class="ck idle ${skipped ? 'skip' : ''}" aria-hidden="true"></span>`;
  else if (i.kind === 'checkin' || i.kind === 'checkout') box = `<button class="ck ${done ? 'on' : ''}" data-act="goto" data-id="${i.kind === 'checkin' ? 'am-card' : 'pm-card'}" aria-label="${esc(i.tag || i.text)}"></button>`;
  else if (i.kind === 'dupr' && !done) box = `<button class="ck" data-act="view" data-v="log" aria-label="Log DUPR"></button>`;
  else box = `<button class="ck ${done ? 'on' : ''} ${skipped ? 'skip' : ''}" data-act="check" data-key="${k}" aria-pressed="${done}" aria-label="Done: ${esc(i.tag || i.text)}"></button>`;
  const subs = [];
  if (i.kind === 'calls') subs.push(`<span class="mono">${dialsFor(t, i.region)}/${i.quota}</span> ${regionName(i.region)} dials · <a data-act="view" data-v="calls" data-sub="calls">Open calls</a>`);
  if (i.kind === 'session' && i.sessionType === 'Drill') { const f = lastFix(t); if (f) subs.push(`This week's fix: ${esc(f)}`); }
  if (i.kind === 'session' && done && !skipped) {
    const sid = `auto-${t}-${i.key}`, s = S.data.sessions[sid];
    const rec = s && num(s.games) ? `Record ${num(s.won)||0}-${num(s.games)-(num(s.won)||0)} · ` : '';
    subs.push(`${rec}<a data-act="session-edit" data-id="${sid}">${s && (num(s.games) || s.workOn || s.wentWell) ? 'Edit session' : 'Add record + notes'}</a>`);
  }
  if (i.movedFrom) subs.push(`Moved from ${fmtTap(i.movedFrom)}, ${isToday ? 'today' : 'this day'} only.`);
  if (i.movedFromDay) subs.push(`Moved here from ${esc(fmtDay(i.movedFromDay))}.`);
  if (skipped) subs.push(isToday ? 'Canceled for today. No make-up.' : 'Canceled this day.');
  else if (i.carry && !done && isToday) subs.push('Moves to tomorrow if not done.');
  const canCancel = isCheckable(i) && !['checkin','checkout'].includes(i.kind);
  const canDone = isToday && isCheckable(i) && !['checkin','checkout'].includes(i.kind) && !(i.kind === 'dupr' && !done);
  const cancelLabel = isToday ? 'Cancel for today' : 'Cancel this day';
  const open = S.swipeKey === i.key;
  const push = (mins, label, cls, extra = '') => `<button class="${cls}" data-act="move-by" data-key="${k}" data-date="${t}" data-m="${mins}" data-scope="day" ${extra}>${label}</button>`;
  const menu = S.openItem === i.key ? `<div class="menu"><span class="meta">Push back</span>${push(15, '15 min', 'btn sm')}${push(30, '30 min', 'btn sm')}${push(60, '1 hour', 'btn sm')}<button class="btn sm" data-act="block" data-key="${k}"${dd}>Reschedule…</button>${!canCancel ? '' : skipped
      ? `<button class="btn sm" data-act="skip" data-key="${k}" data-on="0"${dd}>Undo cancel</button>`
      : `<button class="btn sm ghost" data-act="skip" data-key="${k}" data-on="1"${dd}>${cancelLabel}</button>`}</div>` : '';
  // Laptop: quick actions appear when the pointer rests on a row.
  const qa = `<div class="qa" aria-hidden="true">${push(15, '+15', 'btn sm', 'tabindex="-1"')}${push(30, '+30', 'btn sm', 'tabindex="-1"')}<button class="btn sm" data-act="block" data-key="${k}"${dd} tabindex="-1">Reschedule</button>${canCancel && !skipped ? `<button class="btn sm ghost" data-act="skip" data-key="${k}" data-on="1"${dd} tabindex="-1">Cancel</button>` : ''}</div>`;
  // Phone: swipe left for the same actions, right to mark it done (today only).
  const ti = open ? '0' : '-1';
  const acts = [push(30, '+30 min', 'sa push', `tabindex="${ti}"`), `<button class="sa resched" data-act="block" data-key="${k}"${dd} tabindex="${ti}">Reschedule</button>`];
  if (canCancel) acts.push(skipped ? `<button class="sa undo" data-act="skip" data-key="${k}" data-on="0"${dd} tabindex="${ti}">Undo cancel</button>` : `<button class="sa cancel" data-act="skip" data-key="${k}" data-on="1"${dd} tabindex="${ti}">Cancel</button>`);
  const flash = S.flash && S.flash.key === i.key && Date.now() - S.flash.at < 1600 ? 'flash' : '';
  return `<div class="swipe ${open ? 'open' : ''} ${isNow ? 'is-now' : ''}" data-key="${k}" data-done="${canDone ? 1 : 0}" style="--acts-w:${acts.length * 84}px">
    ${canDone ? `<div class="swipe-done" aria-hidden="true">${done ? 'Undo' : 'Done'}</div>` : ''}<div class="swipe-acts" ${open ? '' : 'aria-hidden="true"'}>${acts.join('')}</div>
    <div class="row ${!isCheckable(i) ? 'marker' : ''} ${done ? 'done' : ''} ${isNow ? 'is-now' : ''} ${late ? 'late' : ''} ${flash}">
    <div class="time" data-act="block" data-key="${k}"${dd}>${fmtT(i.start)}</div>${box}
    <div class="txt" data-act="block" data-key="${k}"${dd} role="button" tabindex="0">${i.tag ? `<span class="tag ${i.eventId ? 'ev' : ''}">${esc(i.tag)}</span>` : ''}${esc(i.text)}${subs.map(s => `<div class="sub">${s}</div>`).join('')}</div>
    <button class="more" data-act="item-menu" data-key="${k}" aria-label="Reschedule or cancel ${esc(itemName(i))}">⋯</button>
    ${qa}${menu}</div></div>`;
}
function taskRow(x, t, grouped) {
  const late = !x.done && x.due && x.due < t && !isRestDay(t) ? daysBetween(x.due, t) : 0;
  const bits = [];
  if (late) bits.push(`<span class="pill bad">${late === 1 ? '1 day late' : late + ' days late'}</span>`);
  if (x.kind === 'makeup') bits.push('<span class="pill warn">Make-up</span>');
  if (x.area && !grouped) bits.push(`<span class="pill">${esc(x.area)}</span>`);
  if (!x.done && x.due && x.due > t) bits.push(`<span class="pill">${esc(fmtDay(x.due))}</span>`);
  if (x.notes) bits.push(esc(x.notes));
  const k = esc(x.id), key = 't:' + x.id, open = S.swipeKey === key, ti = open ? '0' : '-1';
  const nextLabel = x.due && x.due > todayISO() ? 'Next day' : 'Tomorrow';
  const acts = x.done ? [] : [`<button class="sa push" data-act="task-tomorrow" data-id="${k}" tabindex="${ti}">${nextLabel}</button>`, `<button class="sa resched" data-act="task-open" data-id="${k}" tabindex="${ti}">Pick a day</button>`, `<button class="sa cancel" data-act="task-drop" data-id="${k}" tabindex="${ti}">Drop</button>`];
  const qa = x.done ? '' : `<div class="qa" aria-hidden="true"><button class="btn sm" data-act="task-tomorrow" data-id="${k}" tabindex="-1">${nextLabel}</button><button class="btn sm" data-act="task-open" data-id="${k}" tabindex="-1">Pick a day</button><button class="btn sm ghost" data-act="task-drop" data-id="${k}" tabindex="-1">Drop</button></div>`;
  const flash = S.flash && S.flash.key === key && Date.now() - S.flash.at < 1600 ? 'flash' : '';
  return `<div class="swipe ${open ? 'open' : ''}" data-key="${esc(key)}" data-task="${k}" data-done="1" style="--acts-w:${acts.length * 84}px">
    <div class="swipe-done" aria-hidden="true">${x.done ? 'Undo' : 'Done'}</div>${acts.length ? `<div class="swipe-acts" ${open ? '' : 'aria-hidden="true"'}>${acts.join('')}</div>` : ''}
    <div class="trow ${x.done ? 'done' : ''} ${flash}"><button class="ck ${x.done ? 'on' : ''}" data-act="task-toggle" data-id="${k}" aria-pressed="${!!x.done}" aria-label="Done: ${esc(x.title)}"></button>
    <div class="min0"><div class="txt" data-act="task-open" data-id="${k}" role="button" tabindex="0">${esc(x.title)}</div>${bits.length ? `<div class="meta">${bits.join(' ')}</div>` : ''}</div>${qa}</div></div>`;
}
// Long lists are grouped by area, with your check-out fix first.
const TASK_GROUPS = ['Fix','Sales','Build','Pickleball','Body','Money','Move','DoD','Other'];
function taskList(list, t) {
  if (list.length <= 5) return list.map(x => taskRow(x, t)).join('');
  const groups = {};
  list.forEach(x => { const g = x.kind === 'fix' ? 'Fix' : (TASK_GROUPS.includes(x.area) ? x.area : 'Other'); (groups[g] = groups[g] || []).push(x); });
  return TASK_GROUPS.filter(g => groups[g]).map(g => `<div class="tg-h"><span>${g === 'Fix' ? 'Your fix' : esc(g)}</span><span>${groups[g].length}</span></div>${groups[g].map(x => taskRow(x, t, true)).join('')}`).join('');
}
// Most important first: your fix, top 3, make-ups, then whatever has waited longest.
const taskRank = x => x.kind === 'fix' ? 0 : x.kind === 'top3' ? 1 : x.kind === 'makeup' ? 2 : 3;
const taskPriority = (a, b) => taskRank(a) - taskRank(b) || String(a.origDue || a.due).localeCompare(String(b.origDue || b.due)) || TASK_GROUPS.indexOf(a.area) - TASK_GROUPS.indexOf(b.area);
// Keep the five most important for today and move the rest onto the next work days, five a day.
function spreadTasks(t) {
  const list = [...tasksCarried(t), ...tasksDue(t)].sort(taskPriority);
  const move = list.slice(5); if (!move.length) return null;
  const ops = []; let d = t, i = 0, first = null;
  for (let guard = 0; i < move.length && guard < 90; guard++) {
    d = addDays(d, 1);
    if (isRestDay(d)) continue;
    let room = 5 - tasksDue(d).length;
    while (room-- > 0 && i < move.length) {
      const x = move[i++];
      ops.push({set:['tasks', x.id, clone(S.data.tasks[x.id])]});
      patchDoc('tasks', x.id, {due:d, origDue:x.origDue || x.due});
      first = first || d;
    }
  }
  S.lastUndo = {type:'restore', ops};
  return {n:ops.length, first, last:d};
}
function addTaskForm(p, defDate) {
  const txt = draft(p + '-title'), date = draft(p + '-date', defDate);
  return `<form class="stack qform" data-form="task" data-p="${p}">
    <div class="btnrow"><input class="in" id="${p}-title" data-draft data-quick data-fallback="${p}-date" placeholder="Add anything: Call Lisa tomorrow, Gym 6pm" value="${esc(txt)}" style="flex:1 1 180px" autocomplete="off">
    <input class="in" type="date" id="${p}-date" data-draft value="${esc(date)}" style="flex:0 1 160px" aria-label="Due date when you don't type one">
    <button class="btn primary" type="submit">Add</button></div>
    <div class="qprev" id="${p}-title-prev" aria-live="polite">${txt.trim() ? quickPreview(quickPlan(txt, date), p + '-title') : ''}</div></form>`;
}
function amCard(t, day) {
  const am = day.am || {};
  if (am.savedAt && !S.editAM) {
    const top = (am.top3 || []).map((x,n) => ({...x, n})).filter(x => x.t);
    return `<section class="card ord-5" id="am-card"><div class="card-h"><h2>Morning check-in</h2><button class="btn sm ghost" data-act="am-edit">Edit</button></div>
      <div class="kv">${num(am.weight) ? `<span><b>${num(am.weight).toFixed(1)}</b> lb</span>` : ''}${num(am.sleep) ? `<span><b>${num(am.sleep)}</b> h sleep</span>` : ''}${num(am.energy) ? `<span><b>${num(am.energy)}</b>/10 energy</span>` : ''}</div>
      ${top.length ? `<h3>Top 3 today</h3>${top.map(x => `<div class="trow ${x.done ? 'done' : ''}"><button class="ck ${x.done ? 'on' : ''}" data-act="top3" data-i="${x.n}" aria-pressed="${!!x.done}" aria-label="Done: ${esc(x.t)}"></button><div class="txt">${esc(x.t)}</div></div>`).join('')}<div class="meta">Anything left unchecked moves to tomorrow.</div>` : ''}
      ${am.note ? `<p class="note">${esc(am.note)}</p>` : ''}</section>`;
  }
  const top = am.top3 || [];
  const e = S.drafts['am-energy'] !== undefined ? S.drafts['am-energy'] : (am.energy ?? '');
  return `<section class="card ord-5" id="am-card"><div class="card-h"><h2>Morning check-in</h2><span class="meta">2 minutes</span></div>
    <form class="stack" data-form="am">
      <div class="grid2"><div class="fld"><label for="am-weight">Weight (lb)</label><input class="in" id="am-weight" data-draft inputmode="decimal" value="${esc(draft('am-weight', am.weight))}" placeholder="219.0"></div>
      <div class="fld"><label for="am-sleep">Sleep (hours)</label><input class="in" id="am-sleep" data-draft inputmode="decimal" value="${esc(draft('am-sleep', am.sleep))}" placeholder="8"></div></div>
      <div class="fld"><label>Energy (1–10)</label><div class="seg">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button type="button" class="${String(e) === String(n) ? 'on' : ''}" data-act="energy" data-n="${n}">${n}</button>`).join('')}</div></div>
      <div class="fld"><label for="am-t1">Top 3 for today</label>
        ${[0,1,2].map(n => `<input class="in" id="am-t${n+1}" data-draft value="${esc(draft('am-t'+(n+1), (top[n]||{}).t))}" placeholder="${['Most important thing','Second','Third'][n]}">`).join('')}</div>
      <div class="fld"><label for="am-note">Morning note</label><input class="in" id="am-note" data-draft value="${esc(draft('am-note', am.note))}" placeholder="How you feel, anything on your mind"></div>
      <div class="btnrow"><button class="btn primary" type="submit">Save check-in</button>${S.editAM ? '<button class="btn ghost" type="button" data-act="am-cancel">Cancel</button>' : ''}</div>
    </form></section>`;
}
function dayAuto(t) {
  const day = dayOf(t), sched = itemsFor(t), ch = day.checks || {};
  const top = ((day.am || {}).top3 || []).filter(x => x.t);
  const sess = Object.values(S.data.sessions).filter(s => s.date === t);
  return {
    dials: callsCount(t,'dial'), convos: callsCount(t,'convo'), demos: callsCount(t,'demo'), dms: callsCount(t,'dm'),
    drill: sess.filter(s => s.type === 'Drill').length, comp: sess.filter(s => ['Competitive','Tournament'].includes(s.type)).length,
    gym: sched.some(i => i.kind === 'gym' && ch[i.key]),
    mobility: sched.filter(i => i.kind === 'mobility' && ch[i.key]).reduce((a,i) => a + (i.minutes||15), 0),
    pro: sched.filter(i => i.kind === 'watch' && ch[i.key]).reduce((a,i) => a + (i.minutes||30), 0),
    top: top.filter(x => x.done).length, topN: top.length
  };
}
function pmCard(t, day) {
  const pm = day.pm || {}, a = dayAuto(t);
  const autoGrid = `<div class="auto">
    <div><b>${a.dials}</b><span>dials</span></div><div><b>${a.convos}</b><span>owner talks</span></div><div><b>${a.demos}</b><span>demos booked</span></div>
    <div><b>${a.drill + a.comp}</b><span>sessions</span></div><div><b>${a.gym ? 'Yes' : 'No'}</b><span>gym</span></div><div><b>${a.top}/${a.topN || 3}</b><span>top 3 done</span></div></div>`;
  if (pm.savedAt && !S.editPM) {
    return `<section class="card ord-9" id="pm-card"><div class="card-h"><h2>Evening check-out</h2><button class="btn sm ghost" data-act="pm-edit">Edit</button></div>${autoGrid}
      <div class="kv"><span>Proposals <b>${num(pm.proposals)||0}</b></span><span>Deals <b>${num(pm.deals)||0}</b></span><span>Cash in <b>${money(num(pm.cash))}</b></span><span>Protein ${pm.protein ? '<b>hit</b>' : '<b>missed</b>'}</span></div>
      ${pm.win ? `<p class="note"><b>Win:</b> ${esc(pm.win)}</p>` : ''}${pm.fix ? `<p class="note"><b>Fix tomorrow:</b> ${esc(pm.fix)} <span class="meta">(on tomorrow's to-dos)</span></p>` : ''}
      ${pm.biz ? `<p class="note"><b>Business:</b> ${esc(pm.biz)}</p>` : ''}${pm.pb ? `<p class="note"><b>Pickleball:</b> ${esc(pm.pb)}</p>` : ''}</section>`;
  }
  const f = (id, label, def, ph, mode) => `<div class="fld"><label for="${id}">${label}</label><input class="in" id="${id}" data-draft ${mode ? `inputmode="${mode}"` : ''} value="${esc(draft(id, def))}" placeholder="${ph || ''}"></div>`;
  const prot = S.drafts['pm-protein'] !== undefined ? S.drafts['pm-protein'] : !!pm.protein;
  return `<section class="card ord-9" id="pm-card"><div class="card-h"><h2>Evening check-out</h2><span class="meta">5 minutes · counts fill in by themselves</span></div>${autoGrid}
    <form class="stack" data-form="pm">
      <div class="grid3">${f('pm-proposals','Proposals sent',pm.proposals,'0','numeric')}${f('pm-deals','Deals won',pm.deals,'0','numeric')}${f('pm-cash','Cash in ($)',pm.cash,'0','decimal')}</div>
      <div class="grid3">${f('pm-mockups','Mockups sent',pm.mockups,'0','numeric')}${f('pm-dms','Extra DMs',pm.dms,'0','numeric')}${f('pm-pro','Extra pro video (min)',pm.proExtra,'0','numeric')}</div>
      <div class="btnrow"><button type="button" class="ck ${prot ? 'on' : ''}" data-act="protein" aria-pressed="${prot}" aria-label="Protein goal hit"></button><span>Protein goal hit${profile().goalWeight ? ` (${Math.round(profile().goalWeight*0.8)} g)` : ''}</span></div>
      ${f('pm-win','Win of the day',pm.win,'')}
      ${f('pm-fix','Fix tomorrow',pm.fix,'Becomes a to-do for tomorrow')}
      <div class="fld"><label for="pm-biz">Business notes</label><textarea class="in" id="pm-biz" data-draft>${esc(draft('pm-biz', pm.biz))}</textarea></div>
      <div class="fld"><label for="pm-pb">Pickleball notes</label><textarea class="in" id="pm-pb" data-draft>${esc(draft('pm-pb', pm.pb))}</textarea></div>
      <div class="btnrow"><button class="btn primary" type="submit">Save check-out</button>${S.editPM ? '<button class="btn ghost" type="button" data-act="pm-cancel">Cancel</button>' : ''}</div>
    </form></section>`;
}

/* ----- the pipeline on Today ----- */
// Replies to answer first, warm deals due for a follow-up, calls due, and what the email engine and
// the finder did today. Every row opens the lead.
function pipeTodayCard(t) {
  const leads = allLeads(); if (!leads.length) return '';
  const s = emSettings(), st = emState(), fin = outDoc('finder') || {}, local = localClock(s.tz).date, mode = sendingState(s, local);
  const hot = emHot().filter(r => (S.data.leads || {})[r.lead]), calls = isRestDay(t) ? 0 : leadsDue(t).length;
  const follow = leads.filter(l => ['Talking','Demo booked','Proposal sent'].includes(l.stage) && l.nextDate && l.nextDate <= t)
    .sort((a, b) => String(a.nextDate).localeCompare(String(b.nextDate)) || leadHeat(b).score - leadHeat(a).score);
  const sent = st.today && st.today.date === local ? st.today.sent || 0 : 0, found = fin.today && fin.today.date === local ? fin.today.found || 0 : 0;
  const email = mode === 'later' ? `Emails start ${dayWord(s.startOn)}.` : mode === 'on' && emCampaigns().some(liveCampaign) ? `${plural(sent, 'email')} sent today.` : 'Emails are off.';
  const row = (id, l, line) => `<button class="erow" data-act="lead-open" data-id="${esc(id)}"><div class="min0"><b>${esc(l.name || l.email)}</b><div class="meta clamp1">${esc(line)}</div></div><div class="erow-r">${heatChip(l)}</div></button>`;
  const hotRows = hot.slice(0, 3).map(r => row(r.lead, S.data.leads[r.lead], r.summary || r.snippet || 'Replied to your email')).join('');
  const followRows = follow.slice(0, 4).map(l => row(l.id, l, `${l.stage} · ${l.nextStep || 'Follow up'}${l.nextDate < t ? ' · late' : ''}`)).join('');
  return `<section class="card pipetoday ord-8"><div class="card-h"><h2>Pipeline</h2><button class="btn sm" data-act="view" data-v="calls">Open</button></div>
    <div class="pt-n"><span class="${hot.length ? 'hotnum' : ''}"><b>${hot.length}</b> hot ${hot.length === 1 ? 'reply' : 'replies'}</span><span><b>${follow.length}</b> ${follow.length === 1 ? 'follow-up' : 'follow-ups'}</span><span><b>${calls}</b> calls due</span>${found ? `<span><b>${found}</b> new leads</span>` : ''}</div>
    ${hotRows ? `<h3>Answer first</h3><div class="elist">${hotRows}</div>` : ''}
    ${followRows ? `<h3>Follow up today</h3><div class="elist">${followRows}</div>${follow.length > 4 ? `<div class="meta">and ${follow.length - 4} more on the board</div>` : ''}` : ''}
    <div class="btnrow pt-f"><span class="meta">${esc(email)}</span>${mode === 'paused' ? '<button class="btn sm ghost" data-act="em-launch">Start sending</button>' : ''}</div>
  </section>`;
}

/* ----- CALLS ----- */
const inCadence = l => l.type === 'Cold' && ['New lead','Contacted'].includes(l.stage);
const cadenceStep = l => CADENCE[Math.min(num(l.touches) || 0, CADENCE.length - 1)];
// The Calls part of the Pipeline tab: who is due for a call today, one card each. Only leads on the
// call list show here; the finder's leads stay off it until they reply.
function viewCalls() {
  const t = todayISO();
  const quotas = scheduleFor(t).filter(i => i.kind === 'calls');
  const due = leadsDue(t).sort(leadSortDue);
  const all = allLeads(), callers = all.filter(l => l.callList !== false);
  const q = S.search.trim().toLowerCase(), cap = 60;
  let list;
  if (q) list = all.filter(l => [l.name,l.business,l.contact,l.phone,l.email].join(' ').toLowerCase().includes(q)).sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
  else if (S.callFilter === 'IA' || S.callFilter === 'AZ') list = due.filter(l => l.type === 'Cold' && l.region === S.callFilter);
  else if (S.callFilter === 'warm') list = due.filter(l => l.type !== 'Cold');
  else if (S.callFilter === 'all') list = callers.sort((a,b) => (STAGE_RANK[b.stage] ?? -1) - (STAGE_RANK[a.stage] ?? -1) || String(a.name || '').localeCompare(String(b.name || '')));
  else list = due;
  const n = f => due.filter(f).length;
  const won = all.filter(l => l.stage === 'Won');
  const monthly = won.reduce((a,l) => a + (num(l.monthly) || 0), 0);
  const stageCounts = ['Talking','Demo booked','Proposal sent','Won'].map(s => `${s} <b>${all.filter(l => l.stage === s).length}</b>`).join(' · ');
  return `
    <section class="card"><div class="card-h"><h2>Today's calls</h2><span class="meta">Dial by hand</span></div>
      <div class="auto">
        ${quotas.map(i => `<div><b>${dialsFor(t,i.region)}/${i.quota}</b><span>${regionName(i.region)} dials</span></div>`).join('')}
        <div><b>${callsCount(t,'dial')}/${quotas.reduce((a,i) => a + i.quota, 0) || '–'}</b><span>all dials</span></div>
        <div><b>${callsCount(t,'convo')}/${Math.round((targets().convos||25)/5)}</b><span>owner talks</span></div>
        <div><b>${callsCount(t,'demo')}</b><span>demos booked</span></div>
        <div><b>${callsCount(t,'dm')}</b><span>DMs sent</span></div>
      </div>
      <div class="meta">${stageCounts} · Signed monthly <b>${money(monthly)}</b></div>
    </section>
    ${q ? '' : `<div class="chips">${[['due',`Due now ${due.length}`],['warm',`Warm + clients ${n(l => l.type !== 'Cold')}`],['IA',`Iowa ${n(l => l.type === 'Cold' && l.region === 'IA')}`],['AZ',`Arizona ${n(l => l.type === 'Cold' && l.region === 'AZ')}`],['all',`Call list ${callers.length}`]].map(([k,l]) => `<button class="chip ${S.callFilter === k ? 'on' : ''}" data-act="call-filter" data-f="${k}">${l}</button>`).join('')}</div>`}
    ${list.length ? `<div class="leads">${list.slice(0, cap).map(l => leadCard(l, t)).join('')}</div>${list.length > cap ? `<div class="meta">Showing ${cap} of ${list.length}. Search to find the rest, or use All leads.</div>` : ''}` : `<div class="card empty">${q ? 'No leads match that search.' : 'No calls due here. Add new leads on Monday, or switch filters.'}</div>`}`;
}
function leadCard(l, t) {
  const id = l.id, step = inCadence(l) ? cadenceStep(l) : null;
  const late = l.nextDate && l.nextDate < t && !isRestDay(t) ? daysBetween(l.nextDate, t) : 0;
  const isDue = l.nextDate && l.nextDate <= t;
  let btns;
  if (step && step.type === 'call') btns = [['noanswer','No answer'],['talked','Talked'],['demo','Demo booked'],['notint','Not interested'],['bad','Bad number']];
  else if (step) btns = [['sent', step.type === 'dm' ? 'DM sent' : 'Email sent'],['replied','They replied']];
  else btns = [['noanswer','No answer'],['talked','Talked'],['demo','Demo booked']];
  const stageCls = l.stage === 'Won' ? 'good' : l.stage === 'Lost' ? 'bad' : ['Talking','Demo booked','Proposal sent'].includes(l.stage) ? 'acc' : '';
  const form = S.leadForm && S.leadForm.id === id ? S.leadForm.type : null;
  const tel = String(l.phone || '').replace(/[^\d+]/g,'');
  return `<article class="lead">
    <div class="lead-h"><div class="min0"><button class="lname linkish" data-act="lead-open" data-id="${esc(id)}">${esc(l.name)}</button><div class="meta">${esc(l.business || '')}${l.contact ? ' · ' + esc(l.contact) : ''}${l.website ? ` · <a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : ''}</div></div><span class="pill ${stageCls}">${esc(l.stage || '')}</span></div>
    <div><span class="tag">Next</span>${esc(step ? step.label : (l.nextStep || ''))} <span class="meta">${l.nextDate ? (isDue ? (late ? '' : '· due today') : '· ' + fmtDay(l.nextDate)) : ''}</span> ${late ? `<span class="pill bad">${late}d late</span>` : ''}</div>
    ${l.phone ? `<div class="phone"><span class="num">${esc(l.phone)}</span><a class="btn sm" href="tel:${esc(tel)}">Call</a><button class="btn sm ghost" data-act="copy" data-text="${esc(l.phone)}">Copy</button></div>` : ''}
    <div class="obtns">${btns.map(([k,lab]) => `<button class="btn sm ${k === 'demo' ? 'goodb' : k === 'bad' || k === 'notint' ? 'ghost' : ''}" data-act="outcome" data-id="${esc(id)}" data-k="${k}">${lab}</button>`).join('')}<button class="btn sm ghost" data-act="lead-edit" data-id="${esc(id)}">Edit</button></div>
    ${form ? leadForm(l, form, t) : ''}
    ${l.notes ? `<details><summary>Notes</summary><p class="note">${esc(l.notes)}</p></details>` : ''}
  </article>`;
}
function leadForm(l, type, t) {
  const p = 'lf-';
  if (type === 'demo') return `<form class="lform" data-form="lead-demo" data-id="${esc(l.id)}">
      <b>Demo booked with ${esc(l.name)}</b>
      <div class="grid2"><div class="fld"><label for="lf-date">Demo date</label><input class="in" type="date" id="lf-date" data-draft value="${esc(draft(p+'date', nextWeekday(t)))}"></div>
      <div class="fld"><label for="lf-time">Time</label><input class="in" id="lf-time" data-draft value="${esc(draft(p+'time','1:00 pm'))}"></div></div>
      <div class="fld"><label for="lf-note">Note</label><input class="in" id="lf-note" data-draft value="${esc(draft(p+'note'))}" placeholder="What they care about"></div>
      <div class="meta">Adds the demo and a same-day proposal to your to-dos.</div>
      <div class="btnrow"><button class="btn primary" type="submit">Save demo</button><button class="btn ghost" type="button" data-act="lead-form-close">Cancel</button></div></form>`;
  return `<form class="lform" data-form="lead-talked" data-id="${esc(l.id)}">
      <b>Talked with ${esc(l.name)}</b>
      <div class="grid2"><div class="fld"><label for="lf-step">Next step</label><input class="in" id="lf-step" data-draft value="${esc(draft(p+'step','Follow up'))}"></div>
      <div class="fld"><label for="lf-date">Next date</label><input class="in" type="date" id="lf-date" data-draft value="${esc(draft(p+'date', addDays(t,3)))}"></div></div>
      <div class="fld"><label for="lf-note">What they said</label><input class="in" id="lf-note" data-draft value="${esc(draft(p+'note'))}"></div>
      <div class="btnrow"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="lead-form-close">Cancel</button></div></form>`;
}
function advanceStage(cur, to) { return (STAGE_RANK[cur] ?? -1) > (STAGE_RANK[to] ?? -1) ? cur : to; }
async function outcome(id, kind, form) {
  const t = todayISO(), l = S.data.leads[id]; if (!l) return;
  const next = clone(l), step = cadenceStep(l), cad = inCadence(l);
  const call = {t:Date.now(), id, name:l.name, region:l.region || '', kind:'call', outcome:kind, dial:false, convo:false, demo:false, dm:false};
  const newTasks = []; let msg = '';
  const advance = k => {
    next.touches = k;
    if (k >= CADENCE.length) { next.stage = 'Not now'; next.nextDate = addDays(t,60); next.nextStep = 'No reply after 5 touches. Try again'; msg = `${l.name}: 5 touches done. Back in 60 days.`; }
    else { next.nextDate = addDays(t, CADENCE[k].gap); next.nextStep = CADENCE[k].label; msg = `${l.name}: next is ${CADENCE[k].label.toLowerCase()} on ${fmtDay(next.nextDate)}.`; }
  };
  switch (kind) {
    case 'noanswer':
      call.dial = true;
      if (cad) { next.stage = 'Contacted'; advance((num(l.touches)||0) + 1); if (!l.touches) msg += ' Leave a voicemail and send the mockup email.'; }
      else { next.nextDate = addDays(t,2); msg = `${l.name}: try again ${fmtDay(next.nextDate)}.`; }
      break;
    case 'talked':
      call.dial = true; call.convo = true;
      next.stage = advanceStage(l.stage, 'Talking'); next.nextStep = form.step || 'Follow up'; next.nextDate = form.date || addDays(t,3);
      next.touches = (num(l.touches)||0) + 1;
      msg = `${l.name}: ${next.nextStep.toLowerCase()} on ${fmtDay(next.nextDate)}.`; break;
    case 'demo':
      call.dial = true; call.convo = true; call.demo = true;
      next.stage = advanceStage(l.stage, 'Demo booked'); next.nextDate = form.date || nextWeekday(t);
      next.nextStep = `Demo${form.time ? ' at ' + form.time : ''}, then the proposal the same day`;
      newTasks.push({id:`demo-${id}-${next.nextDate}`, title:`Demo: ${l.name}${form.time ? ' at ' + form.time : ''}`, due:next.nextDate, area:'Sales'});
      newTasks.push({id:`prop-${id}-${next.nextDate}`, title:`Send ${l.name} the proposal (same day as the demo)`, due:next.nextDate, area:'Sales'});
      msg = `Demo with ${l.name} on ${fmtDay(next.nextDate)} is on your to-dos.`; break;
    case 'notint':
      call.dial = true; call.convo = true; next.stage = 'Not now'; next.nextDate = addDays(t,60); next.nextStep = 'Check back in';
      msg = `${l.name}: check back ${fmtDay(next.nextDate)}.`; break;
    case 'bad':
      call.dial = true; next.stage = 'Lost'; next.nextDate = ''; next.nextStep = 'Bad number'; msg = `${l.name} marked lost.`; break;
    case 'sent':
      call.kind = step.type; call.dm = step.type === 'dm'; next.stage = 'Contacted'; advance((num(l.touches)||0) + 1); break;
    case 'replied':
      call.kind = step.type; call.convo = true; next.stage = 'Talking'; next.nextDate = t; next.nextStep = 'They replied. Call them back today';
      msg = `${l.name} replied. Call them back today.`; break;
  }
  if (form && form.note) next.notes = (l.notes ? l.notes + '\n' : '') + `${fmtShort(t)}: ${form.note}`;
  next.lastTouch = t; next.updatedAt = Date.now();
  // Only what changed goes out, so an email the engine logged on this lead a moment ago is kept.
  const patch = {};
  for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(l[k])) patch[k] = next[k];
  if (next.stage && next.stage !== (l.stage || 'New lead')) Object.assign(patch, stagePatch(l, next.stage, 'call', Date.now()));
  S.leadForm = null; clearDrafts('lf-');
  const back = backOf(l, patch);
  patchDoc('leads', id, patch);
  patchDay(t, {calls:[...(dayOf(t).calls || []), call]});
  const created = [];
  for (const nt of newTasks) { if (!S.data.tasks[nt.id]) { const {id:tid, ...b} = nt; created.push(tid); setDoc('tasks', tid, {...b, done:false, origDue:b.due, kind:'sales', createdAt:Date.now()}); } }
  if (patch.seq && patch.seq.status === 'stopped') msg = (msg ? msg + ' ' : '') + 'Its emails stopped.';
  S.lastUndo = {type:'outcome', id, back, date:t, callT:call.t, tasks:created};
  toast(msg || 'Saved.', true);
  render();
}
function undo() {
  const u = S.lastUndo; if (!u) return; S.lastUndo = null;
  if (u.type === 'outcome') {
    patchDoc('leads', u.id, u.back);
    patchDay(u.date, {calls:(dayOf(u.date).calls || []).filter(c => c.t !== u.callT)});
    u.tasks.forEach(id => delDoc('tasks', id));
  } else if (u.type === 'task') {
    setDoc('tasks', u.id, u.prev);
  } else if (u.type === 'restore') {
    runOps(u.ops);
  }
  toast('Undone.');
}

/* ----- WEEK ----- */
// Emails sent, email replies and leads the finder added, by local date. Rebuilt when leads or replies change.
let outIdx = null;
function outreachDays() {
  if (outIdx && outIdx.L === S.data.leads && outIdx.R === S.data.replies) return outIdx;
  const sent = {}, found = {}, replied = {}, add = (o, d) => { if (d) o[d] = (o[d] || 0) + 1; };
  const day = v => { const x = new Date(v); return isNaN(x) ? '' : iso(x); };
  for (const l of Object.values(S.data.leads || {})) {
    if (!l) continue;
    (l.sentLog || []).forEach(x => add(sent, x && day(x.at)));
    if (l.source === 'Finder' && l.createdAt) add(found, day(Number(l.createdAt)));
  }
  for (const r of Object.values(S.data.replies || {})) if (r && r.at && !['auto','bounce'].includes(r.label)) add(replied, day(r.at));
  return outIdx = {L:S.data.leads, R:S.data.replies, sent, found, replied};
}
function dayStatsFor(d) {
  const day = dayOf(d), pm = day.pm || {}, ch = day.checks || {}, o = outreachDays();
  const st = {dials:0,convos:0,demos:0,dms:0,proposals:0,deals:0,mockups:0,cash:0,gym:0,mobility:0,pro:0,checkins:0,checkouts:0,drill:0,competitive:0, emails:o.sent[d] || 0, replies:o.replied[d] || 0, found:o.found[d] || 0};
  (day.calls || []).forEach(c => { if (c.dial) st.dials++; if (c.convo) st.convos++; if (c.demo) st.demos++; if (c.dm) st.dms++; });
  st.proposals += num(pm.proposals)||0; st.deals += num(pm.deals)||0; st.mockups += num(pm.mockups)||0; st.dms += num(pm.dms)||0; st.cash += num(pm.cash)||0; st.pro += num(pm.proExtra)||0;
  if (day.am && day.am.savedAt) st.checkins++; if (pm.savedAt) st.checkouts++;
  itemsFor(d).forEach(i => { if (!ch[i.key]) return; if (i.kind === 'gym') st.gym++; if (i.kind === 'mobility') st.mobility += i.minutes||15; if (i.kind === 'watch') st.pro += i.minutes||30; });
  Object.values(S.data.sessions).forEach(s => { if (s.date === d) { if (s.type === 'Drill') st.drill++; if (['Competitive','Tournament'].includes(s.type)) st.competitive++; } });
  return st;
}
function weekStats(ws) {
  const st = dayStatsFor(ws);
  for (let i = 1; i < 7; i++) { const d = dayStatsFor(addDays(ws, i)); for (const k of Object.keys(st)) st[k] += d[k]; }
  return st;
}
const STAT_INFO = {
  dials:['Dials','Every call result you tap on a lead (Pipeline › Calls, or calling mode) counts one dial.'],
  emails:['Emails sent','Every campaign email the engine sent that day, follow-ups included.'],
  replies:['Email replies','Replies to your campaign emails, not counting auto-replies and bounces.'],
  found:['New leads found','Businesses the finder added to your pipeline that day.'],
  convos:['Owner conversations','Talked, Demo booked, Not interested and They replied each count as a conversation.'],
  demos:['Demos booked','Tap Demo booked on a lead.'],
  proposals:['Proposals sent','Typed in the evening check-out.'],
  deals:['Deals won','Typed in the evening check-out.'],
  mockups:['Mockups sent','Typed in the evening check-out.'],
  dms:['DMs sent','DM sent on a lead, plus the extra DMs you type in the check-out.'],
  cash:['Cash in','Typed in the evening check-out.'],
  drill:['Drill sessions','Logged when you check off a drill block, or when you add a Drill session on the Log tab.'],
  competitive:['Competitive sessions','Competitive and Tournament sessions on the Log tab.'],
  gym:['Gym sessions','Checked-off gym blocks.'],
  mobility:['Mobility minutes','Checked-off mobility blocks, 15 minutes each unless the block says otherwise.'],
  pro:['Pro video minutes','Checked-off Watch blocks plus the extra minutes you type in the check-out.'],
  checkins:['Check-ins','Saved morning check-ins.'],
  checkouts:['Check-outs','Saved evening check-outs.'],
};
function stat(label, val, target, fmt, id) {
  fmt = fmt || (v => v);
  const pct = target ? Math.min(100, Math.round(val / target * 100)) : 0;
  return `<div class="stat ${target && val >= target ? 'good' : ''} ${id ? 'tap' : ''}" ${id ? `data-act="stat" data-id="${id}" role="button" tabindex="0" title="Tap for the day-by-day"` : ''}><div class="stat-h"><span>${label}</span><b>${fmt(val)}${target ? `<small> / ${fmt(target)}</small>` : ''}</b></div>${target ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>`;
}
function viewWeek() {
  const t = todayISO(), ws = addDays(weekStartOf(t), S.weekOffset * 7), we = addDays(ws, 6);
  const st = weekStats(ws), T = targets(), wk = roadmapFor(we < t ? we : (ws > t ? ws : t)) || roadmapFor(ws);
  const sel = S.weekDay || (S.weekOffset === 0 ? dowOf(t) : 'Mon');
  const selDate = addDays(ws, WEEK_ORDER.indexOf(sel));
  const month = (ws <= t && t <= we ? t : ws).slice(0,7);
  const rated = Object.values(S.data.sessions).filter(s => s.rated && s.date && s.date.slice(0,7) === month);
  const ratedGames = rated.reduce((a,s) => a + (num(s.games)||0), 0);
  const review = S.data.weeks[ws] || {};
  return `
    <div class="weeknav"><button class="btn sm" data-act="week-nav" data-d="-1" aria-label="Previous week">‹ Prev</button><h2>Week of ${esc(fmtShort(ws))}</h2><button class="btn sm" data-act="week-nav" data-d="1" aria-label="Next week">Next ›</button></div>
    ${wk ? `<div class="week-banner"><div class="eyebrow">Focus</div><b>${esc(wk.focus)}</b>${wk.musts ? `<div class="meta" style="margin-top:4px;color:var(--ink-2)">${esc(wk.musts)}</div>` : ''}</div>` : ''}
    <div class="two-eq">
    <section class="card"><div class="card-h"><h2>Business</h2><span class="meta">Counted from your calls, check-outs and email</span></div><div class="stats">
      ${stat('Dials', st.dials, T.dials, null, 'dials')}${stat('Owner conversations', st.convos, T.convos, null, 'convos')}${stat('Demos booked', st.demos, T.demos, null, 'demos')}${stat('Proposals sent', st.proposals, T.proposals, null, 'proposals')}
      ${stat('Deals won', st.deals, T.deals, null, 'deals')}${stat('Mockups sent', st.mockups, T.mockups, null, 'mockups')}${stat('DMs sent', st.dms, T.dms, null, 'dms')}${stat('Cash in', st.cash, 0, money, 'cash')}
      ${stat('Emails sent', st.emails, 0, null, 'emails')}${stat('Email replies', st.replies, 0, null, 'replies')}${stat('New leads found', st.found, 0, null, 'found')}</div></section>
    <section class="card"><div class="card-h"><h2>Pickleball + body</h2><span class="meta">Counted from your checkoffs + sessions</span></div><div class="stats">
      ${stat('Drill sessions', st.drill, T.drill, null, 'drill')}${stat('Competitive sessions', st.competitive, T.competitive, null, 'competitive')}${stat('Gym sessions', st.gym, T.gym, null, 'gym')}${stat('Mobility (min)', st.mobility, T.mobility, null, 'mobility')}
      ${stat('Pro video (hrs)', Math.round(st.pro/6)/10, (T.proMinutes||210)/60, null, 'pro')}${stat('Check-ins', st.checkins, 7, null, 'checkins')}${stat('Check-outs', st.checkouts, 7, null, 'checkouts')}${stat(`Rated games in ${parseISO(month+'-01').toLocaleDateString('en-US',{month:'long'})}`, ratedGames, 0)}</div>
      <div class="meta" style="margin-top:8px">Rated DUPR games only happen at events, so they're counted by month, not week.</div></section></div>
    <div class="two-eq">${moneyCard(t)}
    <section class="card"><div class="card-h"><h2>Sunday review</h2><span class="meta">Biggest leak + one fix</span></div>
      <form class="stack" data-form="review" data-ws="${ws}">
        <div class="fld"><label for="rv-leak">Biggest leak this week</label><input class="in" id="rv-leak" data-draft value="${esc(draft('rv-leak', review.leak))}" placeholder="e.g. popping up resets from the transition zone"></div>
        <div class="fld"><label for="rv-fix">One fix for next week</label><input class="in" id="rv-fix" data-draft value="${esc(draft('rv-fix', review.fix))}" placeholder="Shows on every drill block next week"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Save review</button>${review.savedAt ? '<span class="meta">Saved</span>' : ''}</div></form></section></div>
    <section class="card"><div class="card-h"><h2>Day by day</h2><div class="btnrow"><button class="btn sm" data-act="week-open">Next 7 days</button><button class="btn sm" data-act="sched-open" data-date="${selDate}">Edit</button></div></div>
      <div class="daychips">${WEEK_ORDER.map(d => `<button class="${d === sel ? 'on' : ''}" data-act="week-day" data-d="${d}">${d}</button>`).join('')}</div>
      <div style="margin-top:6px">${itemsFor(selDate).map(i => `<div class="row ${!isCheckable(i) ? 'marker' : ''}"><div class="time">${fmtT(i.start)}</div>${isCheckable(i) ? `<span class="ck ${isDone(i, selDate) ? 'on' : ''}" aria-hidden="true" style="cursor:default"></span>` : '<span class="dot"></span>'}<div class="txt" data-act="block" data-key="${esc(i.key)}" data-date="${selDate}" role="button" tabindex="0">${i.tag ? `<span class="tag ${i.eventId ? 'ev' : ''}">${esc(i.tag)}</span>` : ''}${esc(i.text)}${i.movedFrom ? `<div class="sub">Moved from ${fmtTap(i.movedFrom)} this day.</div>` : i.eventId ? '<div class="sub">Just this day.</div>' : i.carry ? '<div class="sub">Moves to the next day if missed.</div>' : ''}</div><span></span></div>`).join('')}</div></section>`;
}
function moneyCard(t) {
  const m = cfg().money || {}, p = profile(), gate = p.gate || {saved:10000, monthly:3000, date:'2026-12-01'};
  const plan = (m.plan || []).slice().sort((a,b) => a.date < b.date ? -1 : 1);
  let target = null; plan.forEach(x => { if (x.date <= addDays(t, 6 - ((parseISO(t).getDay()+6)%7))) target = x; });
  const sc = num(m.scottsdale), tx = num(m.taxes);
  const monthly = Object.values(S.data.leads).filter(l => l.stage === 'Won').reduce((a,l) => a + (num(l.monthly)||0), 0);
  const diff = sc !== null && target ? sc - target.amount : null;
  return `<section class="card"><div class="card-h"><h2>Money + the Dec 1 gate</h2><span class="meta">${m.updated ? 'Updated ' + esc(fmtDay(m.updated)) : 'Update every Friday'}</span></div>
    <div class="stats">${stat('Saved for Scottsdale', sc || 0, gate.saved, money)}${stat('Monthly signed', monthly, gate.monthly, money)}</div>
    ${target ? `<div class="meta" style="margin-top:8px">Plan for ${esc(fmtDay(target.date))}: <b>${money(target.amount)}</b>${diff !== null ? ` · you're <b style="color:var(${diff >= 0 ? '--good' : '--bad'})">${money(Math.abs(diff))} ${diff >= 0 ? 'ahead' : 'behind'}</b>` : ''}</div>` : ''}
    <form class="grid3" data-form="money" style="margin-top:10px;align-items:end">
      <div class="fld"><label for="mn-sc">Scottsdale acct ($)</label><input class="in" id="mn-sc" data-draft inputmode="decimal" value="${esc(draft('mn-sc', m.scottsdale))}"></div>
      <div class="fld"><label for="mn-tx">Taxes acct ($)</label><input class="in" id="mn-tx" data-draft inputmode="decimal" value="${esc(draft('mn-tx', m.taxes))}"></div>
      <button class="btn primary" type="submit">Save</button></form>
    <div class="meta" style="margin-top:8px">Every payment: 25% Taxes, 50% Scottsdale, 25% bills.${tx !== null ? ` Taxes account: ${money(tx)}.` : ''}</div></section>`;
}

/* ----- LOG ----- */
function sparkline(pts, lo, hi) {
  if (pts.length < 2) return '';
  const W = 300, H = 64, pad2 = 6;
  const min = lo ?? Math.min(...pts), max = hi ?? Math.max(...pts), span = (max - min) || 1;
  const xy = pts.map((v,i) => [pad2 + i * (W - 2*pad2) / (pts.length - 1), H - pad2 - (v - min) / span * (H - 2*pad2)]);
  const d = xy.map((p,i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Trend"><path d="${d} L ${last[0].toFixed(1)} ${H} L ${xy[0][0].toFixed(1)} ${H} Z" fill="currentColor" opacity=".12"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="currentColor"/></svg>`;
}
function viewLog() {
  const t = todayISO(), p = profile();
  const sessions = Object.entries(S.data.sessions).map(([id,s]) => ({id, ...s})).filter(s => s.date).sort((a,b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0).slice(0, 40);
  const dl = duprList(), latest = dl[dl.length - 1];
  const cps = p.duprCheckpoints || [];
  const nextCp = cps.find(c => c.date >= t);
  const ws = weights(), a7 = avg7(t), start = num(p.startWeight), goal = num(p.goalWeight);
  const month = t.slice(0,7);
  const ratedM = Object.values(S.data.sessions).filter(s => s.rated && s.date && s.date.slice(0,7) === month);
  return `
    <div class="btnrow"><button class="btn primary" data-act="session-new">Log a session</button><span class="meta">Drill and play blocks you check off log themselves. Add your record + notes.</span></div>
    <div class="two-eq">
    <section class="card"><div class="card-h"><h2>DUPR doubles</h2>${nextCp ? `<span class="meta">Next: ${nextCp.target.toFixed(1)} by ${esc(fmtShort(nextCp.date))}</span>` : ''}</div>
      <div class="kv"><span><b>${latest ? num(latest.rating).toFixed(3) : '–'}</b> now</span>${p.duprStart ? `<span>started at <b>${num(p.duprStart).toFixed(2)}</b></span>` : ''}<span>goal <b>5.50</b> by Jun 30</span></div>
      ${sparkline(dl.map(x => num(x.rating)))}
      <form class="btnrow" data-form="dupr" style="margin-top:8px"><input class="in" id="dupr-in" data-draft inputmode="decimal" placeholder="Today's DUPR, e.g. 4.912" value="${esc(draft('dupr-in'))}" style="flex:1 1 160px"><button class="btn primary" type="submit">Save DUPR</button></form>
      <div class="meta" style="margin-top:6px">Checkpoints: ${cps.map(c => `${c.target.toFixed(1)} by ${fmtShort(c.date)}`).join(' · ')}</div></section>
    <section class="card"><div class="card-h"><h2>Body</h2><span class="meta">From your morning weigh-ins</span></div>
      <div class="kv"><span><b>${a7 ? a7.toFixed(1) : '–'}</b> lb 7-day avg</span>${start ? `<span>start <b>${start.toFixed(1)}</b></span>` : ''}${start && a7 ? `<span>lost <b>${(start - a7).toFixed(1)}</b> lb</span>` : ''}${goal ? `<span>protein <b>${Math.round(goal*0.8)}</b> g/day</span>` : ''}</div>
      ${sparkline(ws.slice(-30).map(x => x.w))}
      <form class="btnrow" data-form="goal" style="margin-top:8px"><div class="fld" style="flex:1 1 140px"><label for="goal-in">Goal weight (lb)</label><input class="in" id="goal-in" data-draft inputmode="decimal" value="${esc(draft('goal-in', p.goalWeight))}" placeholder="${start ? Math.round(start - 15) : ''}"></div><button class="btn primary" type="submit" style="align-self:flex-end">Save goal</button></form>
      <div class="meta" style="margin-top:6px">Aim for about 1 lb a week. Losing more than 1.5 lb a week or feeling flat on court: eat about 200 more a day.</div></section></div>
    <section class="card"><div class="card-h"><h2>Sessions</h2><span class="meta">${plural(ratedM.length,'rated session')} this month</span></div>
      ${sessions.length ? sessions.map(s => {
        const g = num(s.games), w = num(s.won) || 0;
        return `<div class="trow" style="grid-template-columns:minmax(0,1fr) auto"><div class="min0"><div><b>${esc(s.type || 'Session')}</b> <span class="meta">${esc(fmtDay(s.date))}${num(s.hours) ? ' · ' + num(s.hours) + ' h' : ''}${g ? ` · ${w}-${g-w}` : ''}</span> ${s.rated ? '<span class="pill acc">Rated</span>' : ''}</div>
          ${s.wentWell ? `<div class="meta">Went well: ${esc(s.wentWell)}</div>` : ''}${s.workOn ? `<div class="meta">Work on: ${esc(s.workOn)}</div>` : ''}${s.opponents ? `<div class="meta">${esc(s.opponents)}</div>` : ''}</div>
          <button class="btn sm ghost" data-act="session-edit" data-id="${esc(s.id)}">Edit</button></div>`;
      }).join('') : '<div class="meta">No sessions yet. Check off a drill or play block, or tap Log a session.</div>'}</section>`;
}

/* ----- SIGN IN + IMPORT ----- */
function loginView() {
  let saved = ''; try { saved = localStorage.getItem('lcc-email') || ''; } catch(e) {}
  return `<section class="card login"><div class="logo"><img src="/icon-192.png" alt="" width="52" height="52"><div><div class="eyebrow">Life Command Center</div><h1>Sign in</h1></div></div>
    <form class="stack" data-form="login">
      <div class="fld"><label for="lg-email">Email</label><input class="in" type="email" id="lg-email" data-draft autocomplete="username" inputmode="email" autocapitalize="off" value="${esc(draft('lg-email', saved))}"></div>
      <div class="fld"><label for="lg-pass">Password</label><input class="in" type="password" id="lg-pass" data-draft autocomplete="current-password" value="${esc(draft('lg-pass'))}"></div>
      ${S.loginErr ? `<div class="err">${esc(S.loginErr)}</div>` : ''}
      <button class="btn primary" type="submit" ${S.loginBusy ? 'disabled' : ''}>${S.loginBusy ? 'Signing in…' : 'Sign in'}</button>
      <div class="meta">Use the account you created in Supabase. You stay signed in on this device.${configSource === 'device' ? ' <a data-act="disconnect">Use a different project</a>' : ''}</div>
    </form></section>`;
}
function connectView() {
  return `<section class="card login"><div class="logo"><img src="/icon-192.png" alt="" width="52" height="52"><div><div class="eyebrow">Life Command Center</div><h1>Connect your database</h1></div></div>
    <p style="margin:0 0 10px;color:var(--ink-2)">Your data lives in your own free Supabase project, which is what keeps your phone and laptop in sync. Paste the two values from <b>Supabase › Project Settings › API Keys</b>. They are kept on this device only.</p>
    <form class="stack" data-form="connect">
      <div class="fld"><label for="cn-url">Project URL</label><input class="in" id="cn-url" data-draft inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://abcdefgh.supabase.co" value="${esc(draft('cn-url'))}"></div>
      <div class="fld"><label for="cn-key">Publishable key (or anon key)</label><input class="in" id="cn-key" data-draft autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="sb_publishable_…" value="${esc(draft('cn-key'))}"></div>
      ${S.connectErr ? `<div class="err">${esc(S.connectErr)}</div>` : ''}
      <button class="btn primary" type="submit" ${S.connectBusy ? 'disabled' : ''}>${S.connectBusy ? 'Checking…' : 'Connect'}</button>
      <div class="meta">Deploying on Vercel? Set <span class="kbd">VITE_SUPABASE_URL</span> and <span class="kbd">VITE_SUPABASE_ANON_KEY</span> there instead and this screen never appears on any device. The README walks through it.</div>
    </form></section>`;
}
function importView() {
  return `<section class="card"><div class="card-h"><h2>Load your plan</h2></div>
    <p style="margin:0 0 10px">Your database is empty. Choose <b>seed/data.json</b> from the project folder (or any backup you exported) to load your schedule, roadmap, leads and to-dos.</p>
    <div class="btnrow">${importControl()}</div><div class="meta" style="margin-top:8px">Or drag the file anywhere onto this page.</div></section>`;
}
function importControl(cls = 'btn primary') {
  return `<label class="${cls}" for="import-file" style="cursor:pointer">Choose backup file</label><input type="file" id="import-file" accept="application/json,.json" hidden>`;
}
async function importFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || typeof data !== 'object' || (!data.config && !data.leads && !data.tasks)) { toast("That file doesn't look like a Life Command Center backup."); return; }
    toast('Importing…');
    const n = await db.importAll(data);
    toast(db.status().pending ? `Imported ${n} items here. They'll sync once you're back online.` : `Imported ${n} items.`);
    render();
  } catch (e) { toast("Couldn't import: " + ((e && e.message) || 'unknown error')); }
}
function downloadText(name, text, type) {
  const blob = new Blob([text], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportBackup() {
  downloadText(`lcc-backup-${todayISO()}.json`, JSON.stringify({exportedAt:new Date().toISOString(), app:'life-command-center', data:db.exportAll()}, null, 1), 'application/json');
}
// A weekly repeating calendar of your blocks with alarms, for Apple or Google Calendar.
function exportCalendar(lead) {
  const days = (cfg().schedule || {}).days || {};
  const BYDAY = {Mon:'MO',Tue:'TU',Wed:'WE',Thu:'TH',Fri:'FR',Sat:'SA',Sun:'SU'};
  const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = line => { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const start = weekStartOf(todayISO());
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Life Command Center//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Life Command Center'];
  WEEK_ORDER.forEach((dw, idx) => {
    const date = addDays(start, idx).replace(/-/g, '');
    (days[dw] || []).forEach(i => {
      if (!i || !i.start || (i.kind === 'marker' && !i.tag)) return;
      const title = (i.tag ? i.tag + ': ' : '') + (i.short || String(i.text || '').split(/[.:]/)[0]).slice(0, 60);
      lines.push('BEGIN:VEVENT', `UID:lcc-${dw}-${i.key}@life-command-center`, 'DTSTAMP:' + stamp,
        `DTSTART:${date}T${i.start.replace(':', '')}00`, `DTEND:${date}T${(i.end || i.start).replace(':', '')}00`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[dw]}`, fold('SUMMARY:' + icsEsc(title)), fold('DESCRIPTION:' + icsEsc(i.text)), 'CATEGORIES:Life Command Center');
      if (lead !== null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(title)), `TRIGGER:-PT${lead}M`, 'END:VALARM');
      lines.push('END:VEVENT');
    });
  });
  Object.entries(S.data.events || {}).map(([id, e]) => ({id, ...e})).filter(e => e.date && e.start && e.date >= addDays(todayISO(), -7)).forEach(e => lines.push(...eventLines(e, stamp, lead, fold, icsEsc)));
  lines.push('END:VCALENDAR');
  downloadText('life-command-center.ics', lines.join('\r\n') + '\r\n', 'text/calendar');
}
function eventLines(e, stamp, lead, fold, icsEsc) {
  const d = e.date.replace(/-/g, ''), title = e.title + (e.where ? ' at ' + e.where : '');
  const out = ['BEGIN:VEVENT', `UID:lcc-ev-${e.id}@life-command-center`, 'DTSTAMP:' + stamp, `DTSTART:${d}T${e.start.replace(':', '')}00`, `DTEND:${d}T${(e.end || e.start).replace(':', '')}00`, fold('SUMMARY:' + icsEsc(e.title)), fold('DESCRIPTION:' + icsEsc(e.notes || '')), 'CATEGORIES:Life Command Center'];
  if (e.where) out.push(fold('LOCATION:' + icsEsc(e.where)));
  if (lead !== null) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + icsEsc(title)), `TRIGGER:-PT${lead}M`, 'END:VALARM');
  out.push('END:VEVENT');
  return out;
}
function exportEvent(id) {
  const e = (S.data.events || {})[id]; if (!e || !e.date || !e.start) return;
  const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = line => { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Life Command Center//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH', ...eventLines({id, ...e}, stamp, 10, fold, icsEsc), 'END:VCALENDAR'];
  downloadText(`${String(e.title || 'event').replace(/[^\w]+/g, '-').slice(0, 40)}.ics`, lines.join('\r\n') + '\r\n', 'text/calendar');
}

/* ----- PLAN ----- */
function viewPlan() {
  const t = todayISO(), p = profile();
  const upcoming = liveTasks().filter(x => !x.done && !x.dropped && x.due && x.due >= t).sort((a,b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const groups = {}; upcoming.forEach(x => { (groups[x.due] = groups[x.due] || {tasks:[], events:[]}).tasks.push(x); });
  Object.entries(S.data.events || {}).map(([id, e]) => ({id, ...e})).filter(e => e.date && e.date >= t && e.date <= addDays(t, 90)).sort((a,b) => (a.start || '') < (b.start || '') ? -1 : 1).forEach(e => { (groups[e.date] = groups[e.date] || {tasks:[], events:[]}).events.push(e); });
  const recent = liveTasks().filter(x => x.done && x.doneOn && x.doneOn >= addDays(t,-14)).sort((a,b) => a.doneOn < b.doneOn ? 1 : -1);
  const cur = roadmapFor(t);
  const rm = roadmap(), curIdx = cur ? rm.findIndex(w => w.start === cur.start) : 0;
  const past = rm.slice(0, Math.max(0, curIdx)), ahead = rm.slice(Math.max(0, curIdx));
  const roadRow = w => `<div class="road ${cur && w.start === cur.start ? 'cur' : ''}"><div class="d">${esc(fmtShort(w.start))}${w.start.slice(0,4) !== t.slice(0,4) ? '<br>' + w.start.slice(0,4) : ''}</div><div class="min0"><b>${esc(w.focus)}</b>${w.musts ? `<div class="meta">${esc(w.musts)}</div>` : ''}</div></div>`;
  return `
    ${planOverview(t)}
    <div class="two-eq"><div class="col">
    <section class="card"><div class="card-h"><h2>Your schedule</h2><div class="btnrow"><button class="btn sm" data-act="week-open">Week</button><button class="btn sm" data-act="sched-open">Edit</button><button class="btn sm" data-act="quick-open">+ Add</button></div></div>
      <div class="meta">Move, add or take out blocks for one day or for every week. Or tap Ask and say it, like "move my drill to 6 tomorrow".</div>
      <div class="daychips" style="margin-top:8px">${WEEK_ORDER.map(x => `<button data-act="sched-open" data-date="${nextDow(t, x)}">${x}</button>`).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>Add a to-do</h2></div>${addTaskForm('pt', t)}</section>
    <section class="card"><div class="card-h"><h2>Coming up</h2><span class="meta">${plural(upcoming.length,'to-do')}</span></div>
      ${Object.keys(groups).length ? Object.keys(groups).sort().map(d => { const g = groups[d]; return `<h3>${d === t ? 'Today' : esc(fmtDay(d))}</h3>${g.events.map(e => `<div class="trow ev"><span class="evdot" aria-hidden="true"></span><div class="min0"><div class="txt" data-act="event-edit" data-id="${esc(e.id)}" role="button" tabindex="0"><span class="mono">${fmtTap(e.start)}${e.end && e.end !== e.start ? '–' + fmtTap(e.end) : ''}</span> ${esc(e.title)}</div>${e.where ? `<div class="meta">${esc(e.where)}</div>` : ''}</div></div>`).join('')}${g.tasks.map(x => `<div class="trow"><button class="ck" data-act="task-toggle" data-id="${esc(x.id)}" aria-label="Done: ${esc(x.title)}"></button><div class="min0"><div class="txt" data-act="task-open" data-id="${esc(x.id)}" role="button" tabindex="0">${esc(x.title)}</div><div class="btnrow" style="margin-top:6px">${x.area ? `<span class="pill">${esc(x.area)}</span>` : ''}<input class="in" type="date" value="${esc(x.due)}" data-act="task-date" data-id="${esc(x.id)}" aria-label="Move date" style="width:auto;padding:4px 8px;font-size:14px"><button class="btn sm ghost" data-act="task-drop" data-id="${esc(x.id)}">Drop</button></div></div></div>`).join('')}`; }).join('') : '<div class="meta">Nothing scheduled.</div>'}</section></div>
    <section class="card"><div class="card-h"><h2>Roadmap</h2><span class="meta">To the move, then DUPR 5.5</span></div>
      ${past.length ? `<details><summary>Earlier weeks (${past.length})</summary>${past.map(roadRow).join('')}</details>` : ''}${ahead.map(roadRow).join('')}</section></div>
    ${recent.length ? `<section class="card"><details><summary>Done in the last 2 weeks (${recent.length})</summary>${recent.map(x => taskRow(x, t)).join('')}</details></section>` : ''}
    <section class="card"><div class="card-h"><h2>What runs by itself</h2></div><ul class="howto meta" style="margin:0;padding-left:18px;color:var(--ink-2)">
      <li>Unchecked to-dos and top-3 items move to the next day and show how many days late they are.</li>
      <li>Missed key blocks (gym, adding leads, money check-in, DUPR, Sunday review and planning) come back the next day as make-ups. Use ⋯ › Skip when you mean to skip one.</li>
      <li>Short on dials? The difference becomes a make-up to-do tomorrow.</li>
      <li>Tapping a call result counts the dial, conversation or demo and schedules the next touch (day 1, 3, 5, 8, 14).</li>
      <li>Booking a demo adds the demo and a same-day proposal to your to-dos.</li>
      <li>Checking off a drill or play block logs the session. Your check-out "fix" becomes tomorrow's first to-do.</li>
      <li>Your Sunday fix shows on every drill block the next week.</li>
      <li>Rest days (Sundays): nothing counts as late, no carried-over list, and no make-ups are created for them.</li>
      <li>Fresh start, in This device below, moves older to-dos to a day you choose and drops make-ups. Use it after a break.</li></ul>
      <div class="btnrow" style="margin-top:10px">${p.links && p.links.playbook ? `<a class="btn sm" href="${esc(p.links.playbook)}" target="_blank" rel="noopener">Playbook (scripts, workouts)</a>` : ''}${p.links && p.links.sheet ? `<a class="btn sm ghost" href="${esc(p.links.sheet)}" target="_blank" rel="noopener">Old Google Sheet</a>` : ''}</div></section>
    ${settingsCard()}`;
}

/* ----- this device: sync status, install, appearance, backup, account ----- */
function syncChip() {
  if (S.dbState !== 'ok' || !S.sync) return '';
  const s = S.sync;
  let cls = 'ok', txt = 'Synced';
  if (!s.online) { cls = 'warn'; txt = s.pending ? `Offline · ${plural(s.pending,'change')} waiting` : 'Offline · saved copy'; }
  else if (s.syncing) { cls = 'busy'; txt = s.pending ? 'Saving…' : 'Syncing…'; }
  else if (s.pending) { cls = 'warn'; txt = `${plural(s.pending,'change')} waiting`; }
  else if (s.error) { cls = 'bad'; txt = 'Sync problem'; }
  else if (!s.loaded) { cls = ''; txt = 'Saved copy'; }
  const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : '';
  const title = (when ? 'Last synced ' + when + '. ' : '') + 'Tap to sync now.';
  return `<button class="sync ${cls}" data-act="sync-now" title="${esc(title)}" aria-label="Sync status: ${esc(txt)}. ${esc(title)}"><i></i>${esc(txt)}</button>`;
}
function installInfo() {
  const ua = navigator.userAgent || '';
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) return {installed:true, canPrompt:false, hint:'', steps:[]};
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
  const firefox = /Firefox|FxiOS/.test(ua);
  const mac = /Macintosh/.test(ua) && !iOS;
  const canPrompt = !!S.installEvt;
  let hint = '', steps = [];
  if (iOS) {
    hint = 'Put it on your Home Screen. It opens full screen, like any other app.';
    steps = ['Tap the <b>Share</b> button in Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>, then open Command from your Home Screen.'];
    if (!safari) steps.unshift('Open this page in <b>Safari</b> first.');
  } else if (android) {
    hint = canPrompt ? 'One tap adds it to your home screen and app drawer.' : 'Add it from the browser menu.';
    if (!canPrompt) steps = ['Tap the <b>⋮</b> menu in Chrome.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).'];
  } else if (firefox) {
    hint = "Firefox can't install web apps. Open this page in Chrome or Edge to install it.";
  } else if (mac && safari) {
    hint = 'Add it to your Dock from Safari.';
    steps = ['In the menu bar choose <b>File</b> › <b>Add to Dock</b>.', 'Click <b>Add</b>, then open Command from your Dock or Launchpad.'];
  } else {
    hint = canPrompt ? 'One click puts it in your dock or Start menu and opens it in its own window.' : "Install it from the browser's address bar.";
    if (!canPrompt) steps = ['Click the <b>install icon</b> at the right end of the address bar, or open the <b>⋮</b> menu › <b>Cast, save and share</b> › <b>Install page as app</b>.'];
  }
  return {installed:false, canPrompt, hint, steps};
}
function installBanner() {
  if (S.installDismissed === undefined) { try { S.installDismissed = !!localStorage.getItem('lcc-install-dismissed'); } catch(e) { S.installDismissed = false; } }
  const inst = installInfo();
  if (inst.installed || S.installDismissed) return '';
  return `<div class="install"><img src="/icon-192.png" alt="" width="44" height="44"><div class="min0"><b>Put Command on your home screen</b><div class="meta">${esc(inst.hint)}</div></div><button class="x" data-act="install-dismiss" aria-label="Dismiss">×</button>
    <div class="acts">${inst.canPrompt ? '<button class="btn primary sm" data-act="install">Install app</button>' : ''}<button class="btn sm ghost" data-act="goto-settings">${inst.canPrompt ? 'Other ways' : 'Show me how'}</button></div></div>`;
}
const MILE_WHY = {
  gate:'The gate decides the move. Pass it and you apply for leases; miss it and you run plan B. "Saved" is the Scottsdale account balance you type on the Week tab. "Monthly signed" adds up the monthly amount of every lead marked Won.',
  dupr:'Logged on the Log tab after rated play. Five drill mornings and three competitive sessions a week are what move it.',
  body:'Counted from your morning weigh-ins as a 7-day average, so one heavy day does not move it. About a pound a week is the pace.',
  move:'Everything before this date points here: the Dec 1 gate, the lease packet in November, the truck in December.',
};
const MILE_AREAS = {gate:['Money','Sales'], dupr:['Pickleball'], body:['Body'], move:['Move']};
function milestones(t) {
  const p = profile(), gate = p.gate || {saved:10000, monthly:3000, date:'2026-12-01'}, m = cfg().money || {};
  const sc = num(m.scottsdale) || 0;
  const monthly = Object.values(S.data.leads).filter(l => l.stage === 'Won').reduce((a,l) => a + (num(l.monthly)||0), 0);
  const dl = duprList(), latest = dl.length ? num(dl[dl.length-1].rating) : null, dStart = num(p.duprStart);
  const a7 = avg7(t), start = num(p.startWeight), goal = num(p.goalWeight);
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
  const ms = [];
  if (gate.date) ms.push({id:'gate', kind:'gate', date:gate.date, title:'The gate', sub:`${money(gate.saved)} saved and ${money(gate.monthly)} a month signed`, now:`${money(sc)} saved · ${money(monthly)} a month`, pct:clamp((Math.min(sc / gate.saved, 1) + Math.min(monthly / gate.monthly, 1)) / 2 * 100)});
  (p.duprCheckpoints || []).forEach(c => ms.push({id:'dupr-' + c.date, kind:'dupr', date:c.date, title:`DUPR ${Number(c.target).toFixed(1)}`, sub:'Doubles rating checkpoint', now:latest ? `now ${latest.toFixed(3)}` : 'no rating logged yet', pct:latest && dStart && c.target > dStart ? clamp((latest - dStart) / (c.target - dStart) * 100) : 0}));
  if (start) {
    ms.push({id:'body-10', kind:'body', date:'2026-12-31', title:`Body: ${Math.round(start - 10)} lb`, sub:'Start weight minus 10', now:a7 ? `7-day average ${a7.toFixed(1)} lb` : 'weigh in to start the trend', pct:a7 ? clamp((start - a7) / 10 * 100) : 0});
    if (goal && goal < start) ms.push({id:'body-goal', kind:'body', date:'2027-03-31', title:`Goal weight ${goal} lb`, sub:'By the March checkpoint', now:a7 ? `7-day average ${a7.toFixed(1)} lb` : '', pct:a7 ? clamp((start - a7) / (start - goal) * 100) : 0});
  }
  if (p.moveDate) ms.push({id:'move', kind:'move', date:p.moveDate, title:'Move to Scottsdale', sub:'Lease signed, truck booked, new routine locked in', now:'', pct:null});
  return ms.sort((a,b) => a.date < b.date ? -1 : 1);
}
function mileRow(x, t) {
  const days = daysBetween(t, x.date);
  const when = days < 0 ? 'passed' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`;
  return `<div class="mile ${days < 0 ? 'past' : ''}" data-act="mile" data-id="${esc(x.id)}" role="button" tabindex="0"><div class="d">${esc(fmtShort(x.date))}<br><span>${x.date.slice(0,4)}</span></div>
    <div class="min0"><b>${esc(x.title)}</b><div class="meta">${esc(x.sub)}${x.now ? ' · ' + esc(x.now) : ''}</div>${x.pct !== null && x.pct !== undefined ? `<div class="bar ${x.pct >= 100 ? 'good' : ''}" style="margin-top:6px"><i style="width:${x.pct}%"></i></div>` : ''}</div>
    <span class="pill ${days < 0 ? '' : days <= 14 ? 'warn' : 'acc'}">${when}</span></div>`;
}
function planOverview(t) {
  const T = targets(), ms = milestones(t);
  const chips = [['Dials',T.dials],['Owner talks',T.convos],['Demos',T.demos],['Proposals',T.proposals],['Deals',T.deals],['Mockups',T.mockups],['DMs',T.dms],['Drill sessions',T.drill],['Competitive',T.competitive],['Gym',T.gym],['Mobility min',T.mobility],['Pro video min',T.proMinutes]].filter(x => x[1]);
  return `<section class="card plan-top"><div class="card-h"><h2>The plan</h2><span class="meta">${esc(fmtShort(t))} to Jun 30, 2027 · tap a line for more</span></div>
    <div class="miles">${ms.map(x => mileRow(x, t)).join('')}</div>
    ${chips.length ? `<h3>Every week</h3><div class="targets">${chips.map(([l,v]) => `<span class="pill">${esc(l)} <b>${v}</b></span>`).join('')}</div>` : ''}
    <div class="meta" style="margin-top:8px">Every payment: 25% Taxes, 50% Scottsdale, 25% bills. ${restDays().length ? `Rest days: ${restDays().join(', ')}.` : ''}</div></section>`;
}
function freshDefault(t) {
  if (dowOf(t) === 'Mon') return t;
  let d = addDays(t, 1); while (dowOf(d) !== 'Mon') d = addDays(d, 1); return d;
}
function freshForm() {
  const t = todayISO(), def = freshDefault(t);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(draft('fs-date', def)) ? draft('fs-date', def) : def;
  const sun = S.drafts['fs-sunday'] !== undefined ? S.drafts['fs-sunday'] : true;
  const live = liveTasks().filter(x => !x.done && !x.dropped);
  const moving = live.filter(x => !['makeup','top3'].includes(x.kind) && x.due && x.due < date).length;
  const dropping = live.filter(x => ['makeup','top3'].includes(x.kind)).length;
  const leadsMoving = Object.values(S.data.leads).filter(l => l.stage !== 'Lost' && l.nextDate && l.nextDate < date).length;
  return `<div class="card-h"><h2>Fresh start</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="fresh">
      <p class="meta" style="margin:0;color:var(--ink-2)">For when you want the plan to begin on a clean day, like after a break. Nothing is deleted.</p>
      <div class="fld"><label for="fs-date">Start the plan on</label><input class="in" type="date" id="fs-date" data-draft value="${esc(date)}"></div>
      <div class="btnrow"><button type="button" class="ck ${sun ? 'on' : ''}" data-act="fs-sunday" aria-pressed="${sun}" aria-label="Sundays are rest days"></button><span>Sundays are rest days: church, rest and pickleball</span></div>
      <ul class="howto meta" style="margin:0;padding-left:18px;color:var(--ink-2)">
        <li>${plural(moving,'older to-do')} move to ${esc(fmtDay(date))}. Nothing shows as late before then.</li>
        <li>${plural(leadsMoving,'call follow-up')} due before then move to that day too.</li>
        <li>${plural(dropping,'make-up to-do')} the app created ${dropping === 1 ? 'gets' : 'get'} dropped.</li>
        <li>The catch-up automation starts counting from that day.</li>
        ${sun ? '<li>Sunday gets the rest-day schedule, and nothing counts as late on Sundays.</li>' : ''}
      </ul>
      <div class="btnrow"><button class="btn primary" type="submit">Start fresh</button></div>
    </form>`;
}
function settingsCard() {
  const inst = installInfo(), s = S.sync || {};
  const last = s.lastSync ? new Date(s.lastSync).toLocaleString('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}) : 'not yet';
  let host = ''; try { host = sbConfig ? new URL(sbConfig.url).host : ''; } catch(e) { host = ''; }
  return `<section class="card" id="settings"><div class="card-h"><h2>This device</h2></div>
    <div class="srow"><div class="lbl">Install as an app<small>${inst.installed ? 'Installed. It opens full screen from your home screen or dock.' : esc(inst.hint)}</small></div>
      ${inst.installed ? '<span class="pill good">Installed</span>' : inst.canPrompt ? '<button class="btn primary sm" data-act="install">Install</button>' : ''}</div>
    ${!inst.installed && inst.steps.length ? `<ol class="steps">${inst.steps.map(x => `<li>${x}</li>`).join('')}</ol>` : ''}
    <div class="srow"><div class="lbl">Appearance<small>Auto follows your phone or laptop setting.</small></div>
      <div class="seg">${THEMES.map(x => `<button type="button" class="${theme === x ? 'on' : ''}" data-act="theme" data-t="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>
    <div class="srow"><div class="lbl">Sync<small>Last synced ${esc(last)}${s.pending ? ` · ${plural(s.pending,'change')} waiting to send` : ''}${host ? ` · ${esc(host)}` : ''}</small></div>
      <button class="btn sm" data-act="sync-now">Sync now</button></div>
    <div class="srow"><div class="lbl">Reminders<small>${pushDoc() && pushDoc().enabled ? 'Phone notifications are on for this device.' : 'Calendar alarms need no setup. Phone notifications take a one-time, three-step setup.'}</small></div>
      <div class="btnrow"><button class="btn sm" data-act="calendar">Add to calendar</button><button class="btn sm ${pushDoc() && pushDoc().enabled ? '' : 'primary'}" data-act="notif-setup">Phone notifications</button></div></div>
    <div class="srow"><div class="lbl">Assistant<small>Talk to Claude inside the app. It sees your plan and numbers and can add to-dos and events. One-time, three-step setup with your own Anthropic key.</small></div>
      <div class="btnrow"><button class="btn sm" data-act="ask">Ask</button><button class="btn sm ghost" data-act="assistant-setup">Set up</button></div></div>
    <div class="srow"><div class="lbl">Fresh start<small>Begin the plan on a clean day: older to-dos move there, make-ups are dropped, Sundays rest.</small></div>
      <button class="btn sm" data-act="fresh-start">Set up</button></div>
    <div class="srow"><div class="lbl">Backup<small>Importing adds or replaces items with the same IDs. It never deletes anything. You can also drag a backup file onto the page.</small></div>
      <div class="btnrow"><button class="btn sm" data-act="export">Download</button>${importControl('btn sm')}</div></div>
    <div class="srow"><div class="lbl">Account<small>${esc(S.email || '')}</small></div>
      <div class="btnrow"><button class="btn sm ghost" data-act="signout">Sign out</button>${configSource === 'device' ? '<button class="btn sm ghost" data-act="disconnect">Disconnect</button>' : ''}</div></div>
    <div class="meta" style="margin-top:10px">Laptop keys: <span class="kbd">1</span>–<span class="kbd">6</span> tabs · <span class="kbd">/</span> search leads · <span class="kbd">n</span> new to-do · <span class="kbd">c</span> start calling · <span class="kbd">s</span> schedule · <span class="kbd">e</span> add to your plan · <span class="kbd">a</span> ask · <span class="kbd">Esc</span> close</div>
    <div class="meta" style="margin-top:6px">Version ${esc(APP_VERSION)}${S.updateApp ? ' · <a data-act="update-app">Update ready, tap to reload</a>' : ''}</div>
  </section>`;
}
/* ----- detail sheets: tap anything for the story behind it ----- */
const closeOnly = title => `<div class="card-h"><h2>${esc(title)}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div><div class="meta">Nothing to show here right now.</div>`;
const linkBtn = (name, label) => { const l = (profile().links || {})[name]; return l ? `<a class="btn sm" href="${esc(l)}" target="_blank" rel="noopener">${label}</a>` : ''; };
const KIND_LABEL = {marker:'Marker', task:'Task block', checkin:'Check-in', checkout:'Check-out', calls:'Call block', session:'Court time', gym:'Gym', mobility:'Mobility', watch:'Study', dupr:'DUPR', event:'Calendar event'};
function blockSheet(key, date) {
  const today = todayISO(), t = date || today, isToday = t === today;
  const i = itemsFor(t).find(x => x.key === key);
  if (!i) return closeOnly('Block');
  const back = S.modal && S.modal.back === 'sched' ? `<button class="btn sm ghost" data-act="sched-open" data-date="${t}">‹ Back</button>` : S.modal && S.modal.back === 'catchup' ? '<button class="btn sm ghost" data-act="catchup">‹ Back</button>' : S.modal && S.modal.back === 'week' ? '<button class="btn sm ghost" data-act="week-open">‹ Back</button>' : '';
  const done = isToday && isCheckable(i) && isDone(i, t), skipped = isSkipped(i, t), m = nowMin(), rest = isRestDay(t);
  const status = !isToday ? `<span class="pill">${esc(fmtDayLong(t))}</span>${skipped ? ' <span class="pill">Canceled this day</span>' : ''}`
    : !isCheckable(i) ? '' : skipped ? '<span class="pill">Canceled today</span>' : done ? '<span class="pill good">Done</span>' : (toMin(i.end || i.start) <= m && !rest) ? '<span class="pill warn">Behind</span>' : (toMin(i.start) <= m ? '<span class="pill acc">Now</span>' : `<span class="pill">In ${fmtMins(toMin(i.start) - m)}</span>`);
  const kindLabel = i.eventId ? (i.kind === 'event' ? 'Just this day' : `${KIND_LABEL[i.kind] || i.kind}, just this day`) : (KIND_LABEL[i.kind] || i.kind);
  const startDate = profile().startDate || '0000-00-00';
  const hist = !isToday ? [] : [1,2,3,4].map(n => { const d = addDays(t, -7*n); if (d < startDate) return null; const sched = scheduleFor(d).find(x => x.key === key); return sched ? {d, done:isDone(sched, d), skipped:isSkipped(sched, d)} : null; }).filter(Boolean).reverse();
  const histHtml = hist.length ? `<div class="hist">${hist.map(h => `<span class="hdot ${h.done ? 'on' : h.skipped ? 'skip' : ''}" title="${esc(fmtDay(h.d))}: ${h.done ? 'done' : h.skipped ? 'skipped' : 'missed'}"></span>`).join('')}<span class="meta">Last ${plural(hist.length, dowOf(t))}: ${hist.filter(h => h.done).length} done</span></div>` : '';
  const T = targets(), st = weekStats(weekStartOf(t));
  let panel = '';
  if (!isToday) panel = '';
  else if (i.kind === 'calls') panel = `<div class="auto"><div><b>${dialsFor(t, i.region)}/${i.quota}</b><span>${regionName(i.region)} dials today</span></div><div><b>${callsCount(t,'convo')}</b><span>owner talks today</span></div><div><b>${st.dials}/${T.dials || 150}</b><span>dials this week</span></div></div><div class="meta">Each result you tap counts the dial and books the next touch: call, call in 2 days, DM in 2 more, call in 3, last email in 6.</div><div class="btnrow"><button class="btn primary" data-act="view" data-v="calls" data-sub="calls">Open calls</button></div>`;
  else if (i.kind === 'session') {
    const sid = `auto-${t}-${key}`, s = S.data.sessions[sid], f = lastFix(t);
    panel = `${f ? `<div class="week-banner"><div class="eyebrow">This week's fix</div><b>${esc(f)}</b></div>` : ''}<div class="auto"><div><b>${st.drill}/${T.drill || 5}</b><span>drill sessions this week</span></div><div><b>${st.competitive}/${T.competitive || 3}</b><span>competitive this week</span></div><div><b>${s && num(s.games) ? `${num(s.won) || 0}-${num(s.games) - (num(s.won) || 0)}` : '–'}</b><span>today's record</span></div></div>${s ? `<div class="btnrow"><button class="btn sm" data-act="session-edit" data-id="${sid}">${num(s.games) || s.workOn || s.wentWell ? 'Edit today\'s session' : 'Add record + notes'}</button></div>` : '<div class="meta">Check it off and a session is logged for you. Add your record and notes after.</div>'}`;
  }
  else if (i.kind === 'gym') panel = `<div class="auto"><div><b>${st.gym}/${T.gym || 3}</b><span>gym sessions this week</span></div></div><div class="btnrow">${linkBtn('playbook', 'Open the Playbook (Body)')}</div>`;
  else if (i.kind === 'mobility') panel = `<div class="auto"><div><b>${st.mobility}/${T.mobility || 105}</b><span>mobility minutes this week</span></div><div><b>${i.minutes || 15}</b><span>minutes in this block</span></div></div><div class="btnrow">${linkBtn('playbook', 'Open the Playbook')}</div>`;
  else if (i.kind === 'watch') panel = `<div class="auto"><div><b>${Math.round(st.pro)}/${T.proMinutes || 210}</b><span>pro video minutes this week</span></div><div><b>${i.minutes || 30}</b><span>minutes in this block</span></div></div>`;
  else if (i.kind === 'checkin') panel = `<div class="btnrow"><button class="btn primary" data-act="goto" data-id="am-card">Go to the check-in</button></div>`;
  else if (i.kind === 'checkout') panel = `<div class="btnrow"><button class="btn primary" data-act="goto" data-id="pm-card">Go to the check-out</button></div>`;
  else if (i.kind === 'dupr') { const dl = duprList(), last = dl[dl.length - 1]; panel = `<div class="auto"><div><b>${last ? num(last.rating).toFixed(3) : '–'}</b><span>latest DUPR</span></div></div><div class="btnrow"><button class="btn primary" data-act="view" data-v="log">Log today's DUPR</button></div>`; }
  else if (i.kind === 'task' && i.area) panel = `<div class="meta">Counts toward ${esc(i.area)}.${i.carry ? ' If it is not done today it comes back tomorrow as a make-up.' : ''}</div>`;
  if (i.eventId) { const ev = (S.data.events || {})[i.eventId] || {}; panel += `${ev.notes ? `<p class="note">${esc(ev.notes)}</p>` : ''}<div class="btnrow"><button class="btn" data-act="event-edit" data-id="${esc(i.eventId)}">Edit event</button><button class="btn ghost" data-act="event-ics" data-id="${esc(i.eventId)}">Add to my calendar</button></div>`; }
  const canAct = isCheckable(i) && !['checkin','checkout','dupr'].includes(i.kind);
  const acts = !canAct ? '' : `<div class="btnrow">${isToday ? (done ? `<button class="btn ghost" data-act="check" data-key="${esc(key)}">Undo</button>` : `<button class="btn primary" data-act="check" data-key="${esc(key)}">Mark done</button>`) : ''}${skipped
    ? `<button class="btn" data-act="skip" data-key="${esc(key)}" data-date="${t}" data-on="0">${isToday ? 'Undo cancel' : 'Put it back on ' + esc(fmtDay(t))}</button>`
    : `<button class="btn ghost" data-act="skip" data-key="${esc(key)}" data-date="${t}" data-on="1">${isToday ? 'Cancel for today' : 'Cancel on ' + esc(fmtDay(t))}</button>`}</div>`;
  const over = overlaps(t, i.start, i.end || i.start, i.key);
  const overHtml = over.length ? `<div class="over"><span class="meta">Overlaps</span>${over.map(o => `<button class="chip" data-act="block" data-key="${esc(o.key)}" data-date="${t}">${esc(fmtTap(o.start))} ${esc(itemName(o))}</button>`).join('')}</div>` : '';
  const editRow = i.eventId ? '' : `<div class="btnrow"><button class="btn ghost" data-act="block-edit" data-key="${esc(key)}" data-date="${t}">Edit it or remove it from your week</button></div>`;
  return `<div class="card-h"><h2>${esc(i.tag || kindLabel)}</h2><div class="btnrow">${back}<button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
    <div class="meta mono">${fmtTap(i.start)}${i.end && i.end !== i.start ? ' – ' + fmtTap(i.end) : ''} · ${esc(kindLabel)}${i.carry ? ' · moves to tomorrow if missed' : ''}</div>
    <p style="margin:0;font-size:16px">${esc(i.text)}</p>
    ${status ? `<div>${status}</div>` : ''}
    ${acts}
    ${movePanel(i, t)}
    ${overHtml}
    ${panel}
    ${histHtml}
    ${editRow}`;
}
// Blocks whose time has passed today and that are neither done nor canceled.
const behindOn = t => isRestDay(t) ? [] : itemsFor(t).filter(i => isCheckable(i) && !isDone(i, t) && toMin(i.end || i.start) <= nowMin());
function catchupSheet() {
  const t = todayISO(), list = behindOn(t);
  const row = i => {
    const k = esc(i.key);
    const acts = i.kind === 'checkin' || i.kind === 'checkout' ? `<button class="btn sm primary" data-act="goto" data-id="${i.kind === 'checkin' ? 'am-card' : 'pm-card'}">Do it now</button>`
      : i.kind === 'dupr' ? `<button class="btn sm primary" data-act="view" data-v="log">Log it</button><button class="btn sm ghost" data-act="skip" data-key="${k}" data-on="1">Cancel</button>`
      : `<button class="btn sm primary" data-act="check" data-key="${k}">Done</button><button class="btn sm" data-act="block" data-key="${k}" data-back="catchup">Reschedule</button><button class="btn sm ghost" data-act="skip" data-key="${k}" data-on="1">Cancel</button>`;
    return `<div class="cu-row"><span class="time mono">${fmtTap(i.start)}</span><div class="min0"><div class="txtc">${i.tag ? `<span class="tag ${i.eventId ? 'ev' : ''}">${esc(i.tag)}</span>` : ''}${esc(i.text)}</div><div class="btnrow">${acts}</div></div></div>`;
  };
  const cancelable = list.filter(i => !['checkin','checkout'].includes(i.kind));
  return `<div class="card-h"><h2>Catch up</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    ${list.length ? `<button class="buildbar" data-act="build-open" data-date="${t}"><b>Rebuild the rest of today</b><span>Say what's set from here on. What still matters moves into the time you have; the rest is canceled.</span></button>
    <p class="meta" style="margin:0">Or one at a time: mark what you did, reschedule what you still want to do, and cancel the rest. Canceled blocks don't come back tomorrow as make-ups.</p>
    <div class="cu">${list.map(row).join('')}</div>
    ${cancelable.length > 1 ? '<div class="btnrow"><button class="btn ghost" data-act="catchup-cancel">Cancel the rest for today</button></div>' : ''}`
    : '<div class="card empty"><b>You\'re caught up.</b><br>Everything before now is done or canceled.</div>'}
    <div class="cu-foot"><span class="meta">Today not happening?</span><button class="btn sm" data-act="day-off" data-on="1">Make today a day off</button><button class="btn sm" data-act="fresh-tomorrow">Start fresh tomorrow</button></div>`;
}
// The Reschedule box: nudge buttons, exact times, another day, and whether the change is for this day or every week.
function movePanel(i, t) {
  const scope = i.eventId ? 'day' : ((S.modal && S.modal.scope) || 'day');
  const dow = dowOf(t);
  const canDay = scope === 'day' && !['checkin','checkout','dupr'].includes(i.kind), next = addDays(t, 1);
  return `<div class="movebox"><div class="card-h"><h3>Reschedule</h3>${i.movedFrom ? `<span class="meta">Usually ${fmtTap(i.movedFrom)} · <a data-act="move-reset" data-key="${esc(i.key)}" data-date="${t}">Put it back</a></span>` : ''}</div>
    ${i.eventId ? '' : `<div class="seg scope" role="group" aria-label="Which days"><button type="button" class="${scope === 'day' ? 'on' : ''}" data-act="move-scope" data-s="day" aria-pressed="${scope === 'day'}">Only ${esc(dayWord(t))}</button><button type="button" class="${scope === 'week' ? 'on' : ''}" data-act="move-scope" data-s="week" aria-pressed="${scope === 'week'}">Every ${DOW_LONG[dow]}</button></div>`}
    <div class="nudges">${[[-30,'−30'],[-15,'−15'],[15,'+15'],[30,'+30'],[60,'+60']].map(([m, l]) => `<button type="button" class="btn sm" data-act="move-by" data-key="${esc(i.key)}" data-date="${t}" data-m="${m}" aria-label="${m < 0 ? 'Earlier' : 'Later'} by ${Math.abs(m)} minutes">${l}</button>`).join('')}<span class="meta">minutes</span></div>
    <div class="grid2"><div class="fld"><label for="mv-start">Starts</label><input class="in" type="time" id="mv-start" value="${esc(i.start)}" data-act="move-time" data-key="${esc(i.key)}" data-date="${t}"></div><div class="fld"><label for="mv-end">Ends</label><input class="in" type="time" id="mv-end" value="${esc(i.end || i.start)}" data-act="move-time" data-key="${esc(i.key)}" data-date="${t}"></div></div>
    ${canDay ? `<div class="moveday"><button type="button" class="btn sm" data-act="move-day" data-key="${esc(i.key)}" data-date="${t}" data-to="${next}">Move to ${t === todayISO() ? 'tomorrow' : esc(fmtDay(next))}</button><label class="pickday meta">or another day <input class="in" type="date" id="mv-day" data-key="${esc(i.key)}" data-date="${t}" min="${todayISO()}"></label></div>` : ''}</div>`;
}
function taskSheet(id) {
  const x = S.data.tasks[id]; if (!x) return closeOnly('To-do');
  const f = (k, def) => draft('tk-' + k, def);
  const origin = x.kind === 'makeup' ? 'A make-up the catch-up automation created.' : x.kind === 'top3' ? 'Came from a morning top 3.' : x.kind === 'fix' ? 'Your check-out fix.' : x.kind === 'sales' ? 'Created from a call result.' : '';
  const moved = x.origDue && x.origDue !== x.due ? `Originally due ${fmtDay(x.origDue)}.` : '';
  const doneLine = x.done && x.doneOn ? `Done ${fmtDay(x.doneOn)}.` : '';
  return `<div class="card-h"><h2>To-do</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="task-edit" data-id="${esc(id)}">
      <div class="fld"><label for="tk-title">What</label><input class="in" id="tk-title" data-draft value="${esc(f('title', x.title))}"></div>
      <div class="grid2"><div class="fld"><label for="tk-due">Due</label><input class="in" type="date" id="tk-due" data-draft value="${esc(f('due', x.due))}"></div>
        <div class="fld"><label for="tk-area">Area</label><select class="in" id="tk-area" data-draft>${AREAS.map(a => `<option ${f('area', x.area || 'Other') === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>
      <div class="fld"><label for="tk-notes">Notes</label><textarea class="in" id="tk-notes" data-draft>${esc(f('notes', x.notes))}</textarea></div>
      ${origin || moved || doneLine ? `<div class="meta">${esc([origin, moved, doneLine].filter(Boolean).join(' '))}</div>` : ''}
      <div class="btnrow"><button class="btn primary" type="submit">Save</button>
        ${x.done ? `<button class="btn ghost" type="button" data-act="task-toggle" data-id="${esc(id)}">Mark not done</button>` : `<button class="btn goodb" type="button" data-act="task-toggle" data-id="${esc(id)}">Done</button><button class="btn" type="button" data-act="task-tomorrow" data-id="${esc(id)}">Tomorrow</button>`}
        ${S.confirm === 'tk-del' ? `<button class="btn badb" type="button" data-act="task-delete" data-id="${esc(id)}">Yes, delete it</button>` : '<button class="btn ghost" type="button" data-act="confirm" data-c="tk-del">Delete</button>'}</div>
    </form>`;
}
function mileSheet(id) {
  const t = todayISO(), x = milestones(t).find(k => k.id === id);
  if (!x) return closeOnly('Milestone');
  const days = daysBetween(t, x.date), areas = MILE_AREAS[x.kind] || [];
  const related = liveTasks().filter(k => !k.done && !k.dropped && k.due && k.due <= x.date && areas.includes(k.area)).sort((a,b) => a.due < b.due ? -1 : 1).slice(0, 8);
  const weeks = roadmap().filter(w => w.start <= x.date && addDays(w.start, 6) >= t).slice(-3);
  return `<div class="card-h"><h2>${esc(x.title)}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <div class="meta mono">${esc(fmtLong(x.date))} · ${days < 0 ? 'passed' : days === 0 ? 'today' : plural(days, 'day') + ' away'}</div>
    <p style="margin:0;font-size:16px">${esc(x.sub)}${x.now ? `<br><span class="meta">${esc(x.now)}</span>` : ''}</p>
    ${x.pct !== null && x.pct !== undefined ? `<div class="progress"><div class="bar ${x.pct >= 100 ? 'good' : ''}"><i style="width:${x.pct}%"></i></div><span class="meta mono">${x.pct}%</span></div>` : ''}
    <p class="meta" style="margin:0;color:var(--ink-2)">${esc(MILE_WHY[x.kind] || '')}</p>
    ${related.length ? `<h3>On the way there</h3>${related.map(k => taskRow(k, t)).join('')}` : ''}
    ${weeks.length ? `<h3>Roadmap</h3>${weeks.map(w => `<div class="road"><div class="d">${esc(fmtShort(w.start))}</div><div class="min0"><b>${esc(w.focus)}</b></div></div>`).join('')}` : ''}`;
}
function statSheet(id) {
  const t = todayISO(), ws = addDays(weekStartOf(t), S.weekOffset * 7), T = targets(), info = STAT_INFO[id];
  if (!info) return closeOnly('This week');
  const days = [0,1,2,3,4,5,6].map(n => { const d = addDays(ws, n); return {d, v: dayStatsFor(d)[id] || 0}; });
  const total = days.reduce((a, x) => a + x.v, 0), max = Math.max(1, ...days.map(x => x.v));
  const target = {dials:T.dials, convos:T.convos, demos:T.demos, proposals:T.proposals, deals:T.deals, mockups:T.mockups, dms:T.dms, drill:T.drill, competitive:T.competitive, gym:T.gym, mobility:T.mobility, pro:T.proMinutes, checkins:7, checkouts:7}[id];
  const fmt = id === 'cash' ? money : (v => v);
  return `<div class="card-h"><h2>${esc(info[0])}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <div class="meta">Week of ${esc(fmtShort(ws))}</div>
    <div class="kv"><span><b>${fmt(total)}</b>${target ? ` of ${fmt(target)}` : ''} this week</span>${target && target > total ? `<span><b>${fmt(target - total)}</b> to go</span>` : target ? '<span class="pill good">Target hit</span>' : ''}</div>
    <div class="bars">${days.map(x => `<div class="bcol ${x.d === t ? 'today' : ''} ${x.d > t ? 'future' : ''}"><div class="bwrap"><i style="height:${Math.round(x.v / max * 100)}%"></i></div><span class="mono">${fmt(x.v)}</span><span class="meta">${dowOf(x.d)}</span></div>`).join('')}</div>
    <p class="meta" style="margin:0">${esc(info[1])}</p>`;
}

/* ----- reminders: calendar export and phone notifications ----- */
function deviceId() {
  let id = null; try { id = localStorage.getItem('lcc-device'); } catch(e) {}
  if (!id) { id = 'd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem('lcc-device', id); } catch(e) {} }
  return id;
}
const pushDoc = () => (S.data.push || {})[deviceId()] || null;
const fnUrl = () => sbConfig ? String(sbConfig.url).replace(/\/+$/, '') + '/functions/v1/reminders' : '';
const projectRef = () => { try { return new URL(sbConfig.url).host.split('.')[0]; } catch(e) { return 'YOUR-PROJECT-REF'; } };
const urlB64ToU8 = s => { const pad = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
function pushEnv() {
  const ua = navigator.userAgent || '';
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {iOS, standalone, supported, perm: supported ? Notification.permission : 'unsupported', needsHome: iOS && !standalone};
}
async function notifCheck() {
  S.notif = {...(S.notif || {}), checking:true}; render();
  try {
    const r = await fetch(fnUrl() + '?status=1');
    if (r.status === 404) S.notif = {fn:'missing'};
    else if (r.status === 401 || r.status === 403) S.notif = {fn:'error', msg:'The function is there but still checks for a login. Open its settings and turn off "Verify JWT".'};
    else if (!r.ok) { const txt = await r.text().catch(() => ''); let m = ''; try { m = JSON.parse(txt).error || ''; } catch(e) { m = txt; } S.notif = {fn:'error', msg:`The function answered ${r.status}. ${String(m).slice(0, 160)}`}; }
    else { const j = await r.json(); const age = j.lastRun ? (Date.now() - Date.parse(j.lastRun)) / 60000 : Infinity; S.notif = {fn:'ok', cron: age <= 3 ? 'ok' : 'idle', lastRun:j.lastRun, subscriptions:j.subscriptions, version:Number(j.version) || 1}; }
  } catch (e) { S.notif = {fn:'error', msg:"Couldn't reach the function. Check your connection and that the function is deployed."}; }
  render();
}
async function notifEnable() {
  const env = pushEnv();
  if (!env.supported) { S.notif = {...(S.notif || {}), msg:'This browser cannot show push notifications.', kind:'err'}; render(); return; }
  if (env.needsHome) { S.notif = {...(S.notif || {}), msg:'On iPhone, open Command from your Home Screen icon first, then turn this on.', kind:'err'}; render(); return; }
  S.notifBusy = true; S.notif = {...(S.notif || {}), msg:''}; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in your browser settings for this site.');
    const r = await fetch(fnUrl() + '?public_key=1');
    if (r.status === 404) throw new Error('The reminders function is not deployed yet. Do step 1 first.');
    if (r.status === 401 || r.status === 403) throw new Error('The function still checks for a login. Turn off "Verify JWT" in its settings.');
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch(e) {} throw new Error(m || `The function answered ${r.status}.`); }
    const {publicKey} = await r.json();
    if (!publicKey) throw new Error('The function has no keys yet. Run supabase/schema.sql again, then retry.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlB64ToU8(publicKey)});
    const j = sub.toJSON();
    const lead = Number((document.getElementById('nt-lead') || {}).value);
    await setDoc('push', deviceId(), {endpoint:j.endpoint, keys:j.keys, expirationTime:j.expirationTime || null, tz:Intl.DateTimeFormat().resolvedOptions().timeZone, ua:navigator.userAgent.slice(0, 140), lead:Number.isFinite(lead) ? lead : 5, enabled:true, error:null, createdAt:Date.now(), updatedAt:Date.now()});
    await db.flush();
    const tr = await fetch(fnUrl() + '?test=' + encodeURIComponent(deviceId()), {method:'POST'});
    const tj = await tr.json().catch(() => ({}));
    S.notif = {...(S.notif || {}), fn:'ok', msg: tj.sent ? 'On. A test notification is on its way.' : 'On. The test could not be delivered yet' + (tj.error ? ': ' + tj.error : '. Try "Send a test" in a moment.'), kind: tj.sent ? 'ok' : 'err'};
  } catch (e) { S.notif = {...(S.notif || {}), msg:(e && e.message) || 'Something went wrong.', kind:'err'}; }
  S.notifBusy = false; render();
}
async function notifOff() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch(e) {}
  if (pushDoc()) patchDoc('push', deviceId(), {enabled:false, updatedAt:Date.now()});
  S.notif = {...(S.notif || {}), msg:'Off for this device.', kind:'ok'}; render();
}
async function notifTest() {
  toast('Sending a test…');
  try { const r = await fetch(fnUrl() + '?test=' + encodeURIComponent(deviceId()), {method:'POST'}); const j = await r.json().catch(() => ({})); toast(j.sent ? 'Sent. It should pop up any second.' : 'Nothing sent' + (j.error ? ': ' + j.error : '. Is this device turned on above?')); }
  catch (e) { toast("Couldn't reach the function."); }
}
function notifSheet() {
  const env = pushEnv(), sub = pushDoc(), st = S.notif || {}, on = !!(sub && sub.enabled);
  const step = (n, title, body, ok) => `<div class="step ${ok ? 'ok' : ''}"><div class="num">${ok ? '✓' : n}</div><div class="min0"><b>${title}</b><div class="meta" style="color:var(--ink-2)">${body}</div></div></div>`;
  const three = !env.supported ? 'This browser cannot show push notifications. On iPhone, open Command from your Home Screen icon.'
    : env.needsHome ? 'On iPhone this only works from the Home Screen icon. Share › Add to Home Screen, open Command from there, and come back to this screen.'
    : env.perm === 'denied' ? 'Notifications are blocked for this site in your browser settings. Allow them, then try again.'
    : on ? `On for this device${sub.tz ? ', ' + esc(sub.tz) : ''}.` : 'Your browser will ask once for permission, then a test notification is sent.';
  return `<div class="card-h"><h2>Phone notifications</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <p class="meta" style="margin:0;color:var(--ink-2)">A tiny function in your own Supabase project checks the clock every minute and nudges this device before each block. Set it up once; every device after that is just step 3.</p>
    ${step(1, 'Create the function', `In Supabase open <b>Edge Functions</b> › <b>Deploy a new function</b> › <b>Via Editor</b>. Name it <span class="kbd">reminders</span>, replace all the code with the copied code, and <b>Deploy</b>. Then open the function's <b>Settings</b> and turn <b>off</b> "Verify JWT".<div class="btnrow" style="margin-top:6px"><button class="btn sm" data-act="copy-fn">Copy the code</button><button class="btn sm ghost" data-act="notif-check">${st.checking ? 'Checking…' : 'Check'}</button>${st.fn === 'ok' ? ((st.version || 1) < REMINDERS_V ? '<span class="pill warn">Update needed</span>' : '<span class="pill good">Found</span>') : st.fn === 'missing' ? '<span class="pill warn">Not found yet</span>' : st.fn === 'error' ? '<span class="pill bad">Problem</span>' : ''}</div>${st.fn === 'ok' && (st.version || 1) < REMINDERS_V ? '<div class="meta" style="margin-top:6px">Supabase is running an older copy, so moved blocks would nudge at their usual time. Copy the code, open the <b>reminders</b> function, replace all of its code, Deploy, then tap Check.</div>' : ''}${st.fn === 'error' && st.msg ? `<div class="err" style="margin-top:6px">${esc(st.msg)}</div>` : ''}`, st.fn === 'ok' && (st.version || 1) >= REMINDERS_V)}
    ${step(2, 'Run it every minute', `In Supabase open <b>Integrations</b> › <b>Cron</b> (enable it if asked) › <b>Create job</b>. Name <span class="kbd">reminders</span>, schedule <span class="kbd">* * * * *</span>, type <b>Supabase Edge Function</b>, pick <b>reminders</b>, method <b>POST</b>, Create. Prefer SQL? Copy it and run it in the SQL Editor instead.<div class="btnrow" style="margin-top:6px"><button class="btn sm ghost" data-act="copy-sql">Copy the SQL</button>${st.cron === 'ok' ? '<span class="pill good">Running</span>' : st.cron === 'idle' ? '<span class="pill warn">Not running yet. Check again in two minutes.</span>' : ''}</div>`, st.cron === 'ok')}
    ${step(3, 'Turn it on for this device', three, on)}
    <div class="btnrow">
      ${on ? '<button class="btn" data-act="notif-test">Send a test</button><button class="btn ghost" data-act="notif-off">Turn off</button>' : `<button class="btn primary" data-act="notif-enable" ${!env.supported || env.needsHome || S.notifBusy ? 'disabled' : ''}>${S.notifBusy ? 'Working…' : 'Turn on notifications'}</button>`}
      <label class="meta">Nudge <select class="in" id="nt-lead" style="width:auto;display:inline-block;padding:4px 8px;font-size:14px">${[[0,'at the start'],[5,'5 min before'],[10,'10 min before'],[15,'15 min before']].map(([v,l]) => `<option value="${v}" ${String(sub && sub.lead !== undefined ? sub.lead : (S.drafts['nt-lead'] ?? 5)) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${st.msg && st.fn !== 'error' ? `<div class="${st.kind === 'ok' ? 'ok-box' : 'err'}">${esc(st.msg)}</div>` : ''}
    <div class="meta">Calendar alarms are the no-setup alternative: <a data-act="calendar">Add to calendar</a> gives you a weekly calendar with an alarm before every block.</div>`;
}
/* ----- smart add: one line in, the right thing out ----- */
const hhmmNow = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
// A line that names no day goes on fallbackDate (the day you're looking at, or the box's date).
function quickPlan(text, fallbackDate) {
  const p = parseQuick(text, todayISO(), hhmmNow());
  if (p.kind !== 'weekly' && !p.hasDate) p.date = /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate || '') ? fallbackDate : todayISO();
  return p;
}
const QUICK_HINT = 'Type it the way you would say it. A time puts it on your plan, no time makes it a to-do, and "every" makes it weekly.';
function quickPreview(p, srcId) {
  if (!p || !String(p.title || '').trim()) return '';
  const label = p.kind === 'task' ? 'To-do' : p.type === 'session' ? 'Pickleball · ' + (p.sessionType || 'Rec play') : p.type === 'gym' ? 'Gym' : p.type === 'mobility' ? 'Mobility' : p.type === 'watch' ? 'Study' : p.kind === 'weekly' ? 'Block' : 'Event';
  const every = p.days ? (daysLabel(p.days).startsWith('every') ? daysLabel(p.days) : 'every ' + daysLabel(p.days)) : '';
  const when = p.kind === 'weekly' ? `${every}${p.start ? ', ' + fmtTap(p.start) + '–' + fmtTap(p.end) : ' · add a time'}`
    : p.kind === 'oneoff' ? `${dayWord(p.date)}, ${fmtTap(p.start)}–${fmtTap(p.end)}` : `due ${dayWord(p.date)}${p.area !== 'Other' ? ' · ' + p.area : ''}`;
  const where = p.kind === 'weekly' ? ' · your weekly plan' : p.kind === 'oneoff' ? " · that day's plan" : '';
  return `<span class="qk ${p.kind}">${esc(label)}</span> <b>${esc(p.title)}</b> · ${esc(when)}${esc(where)}${p.kind !== 'task' && srcId ? ` <a data-act="quick-as-task" data-src="${esc(srcId)}">Just a to-do</a>` : ''}`;
}
// Files what quickPlan understood. Returns the message for the toast, or null when it needs a time first.
function addQuick(p) {
  if (p.kind === 'task') {
    const id = 'u-' + Date.now().toString(36);
    setDoc('tasks', id, {title:p.title, due:p.date, origDue:p.date, area:p.area || 'Other', done:false, kind:'task', createdAt:Date.now()});
    S.lastUndo = {type:'restore', ops:[{del:['tasks', id]}]}; S.flash = {key:'t:' + id, at:Date.now()};
    return `Added to-do: ${p.title}, due ${dayWord(p.date)}.`;
  }
  if (p.kind === 'oneoff') {
    const id = 'ev-' + Date.now().toString(36);
    const doc = {title:p.title, date:p.date, start:p.start, end:p.end, where:'', notes:'', createdAt:Date.now(), updatedAt:Date.now()};
    if (p.type !== 'event') { doc.kind = p.type; if (p.sessionType) doc.sessionType = p.sessionType; }
    setDoc('events', id, doc);
    S.lastUndo = {type:'restore', ops:[{del:['events', id]}]}; S.flash = {key:'ev-' + id, at:Date.now()};
    const over = overlaps(p.date, p.start, p.end, 'ev-' + id);
    return `Added ${p.title}, ${dayWord(p.date)} at ${fmtTap(p.start)}.${over.length ? ` It overlaps ${listNames(over)}.` : ''}`;
  }
  if (!p.start) return null;
  const item = {key:'b' + Date.now().toString(36), start:p.start, end:p.end, tag:p.title, text:'', kind:p.type === 'event' ? 'task' : p.type};
  if (item.kind === 'session') { item.sessionType = p.sessionType || 'Drill'; item.hours = Math.round((toMin(p.end) - toMin(p.start)) / 30) / 2 || 1; }
  if (['mobility','watch'].includes(item.kind)) item.minutes = Math.max(5, toMin(p.end) - toMin(p.start));
  const changes = {}, prev = {};
  p.days.forEach(x => { prev[x] = templateDay(x); changes[x] = [...templateDay(x), clone(item)].sort(byStart); });
  patchDoc('config', 'schedule', {days:changes});
  S.lastUndo = {type:'restore', ops:[{patch:['config', 'schedule', {days:prev}]}]}; S.flash = {key:item.key, at:Date.now()};
  return `Added ${p.title} to ${daysLabel(p.days)} at ${fmtTap(p.start)}.`;
}
// Opens the detailed form with what the line said, for anything the box can't do in one go.
function quickToForm(p, back) {
  clearDrafts('ev-'); clearDrafts('ad-');
  const date = p.date || todayISO();
  S.drafts['ev-title'] = p.title === 'Untitled' ? '' : p.title;
  if (p.kind !== 'weekly') S.drafts['ev-date'] = date;
  if (p.start) { S.drafts['ev-start'] = p.start; S.drafts['ev-end'] = p.end; }
  S.drafts['ad-type'] = p.type === 'session' ? 'session:' + (p.sessionType || 'Rec play') : ['gym','mobility','watch'].includes(p.type) ? p.type : p.kind === 'weekly' ? 'task' : 'event';
  S.confirm = null;
  S.modal = {type:'add', date, scope:p.kind === 'weekly' ? 'week' : 'day', days:p.days || [dowOf(date)], back:back || null};
}
function quickSheet() {
  const txt = draft('qa-in'), date = S.modal.date || todayISO(), other = date !== todayISO();
  const ex = ['Call Lisa tomorrow', 'Pickleball Thu 6-8am', 'Dentist Friday 2pm', 'Gym every Mon, Wed, Fri 6:30pm', 'Send the proposal Wednesday'];
  return `<div class="card-h"><h2>${other ? 'Add to ' + esc(dayWord(date)) : 'Add'}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="quick">
      <input class="in big" id="qa-in" data-draft data-quick data-date="${date}" value="${esc(txt)}" placeholder="What do you want to add?" autocomplete="off" enterkeyhint="done">
      <div class="qprev hint" id="qa-in-prev" aria-live="polite">${txt.trim() ? quickPreview(quickPlan(txt, date), 'qa-in') : esc(other ? `${QUICK_HINT} No day named means ${dayWord(date)}.` : QUICK_HINT)}</div>
      <div class="btnrow"><button class="btn primary" type="submit">Add</button><button class="btn ghost" type="button" data-act="quick-more">More options</button></div>
    </form>
    <div class="chips multi">${ex.map(e => `<button class="chip" data-act="quick-example" data-text="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
}

/* ----- build my day: say what's set, the rest fits around it ----- */
function buildPlanFor(date, text) {
  const t = todayISO(), parsed = parseDayText(text, t, hhmmNow());
  const items = itemsFor(date).map(i => {
    const skipped = isSkipped(i, date);
    return {key:i.key, start:i.start, end:i.end || i.start, kind:i.kind, tag:i.tag, text:i.text, oneoff:!!i.eventId, sessionType:i.sessionType,
      skipped, done:isCheckable(i) && !skipped && date <= t && isDone(i, date)};
  });
  return {parsed, r:buildDay(items, parsed.items, {start:parsed.start, now:date === t ? hhmmNow() : null})};
}
const newTag = f => f.type === 'session' ? (f.sessionType || 'Court time') : (ONEOFF_TAG[f.type] || 'EVENT');
function buildChips(parsed, r, date) {
  const isToday = date === todayISO();
  const start = parsed.start && isToday && r.from !== parsed.start ? `Up at ${fmtTap(parsed.start)} · planning from ${fmtTap(r.from)}`
    : parsed.start ? `Starts ${fmtTap(parsed.start)}` : isToday ? `Planning from now, ${fmtTap(r.from)}` : `Starts ${fmtTap(r.from)}, as planned`;
  return `<div class="bchips"><span class="bchip start">${esc(start)}</span>${parsed.items.map(x => `<span class="bchip ${x.type === 'session' ? 'court' : ''}"><b>${esc(x.title)}</b> ${fmtTap(x.start)}–${fmtTap(x.end)}</span>`).join('')}</div>`
    + (parsed.left.length ? `<div class="meta">No time, so not added: ${parsed.left.map(x => esc(x)).join(' · ')}</div>` : '');
}
function buildSheet() {
  const t = todayISO(), m = S.modal, date = m.date && m.date >= t ? m.date : t, txt = draft('bd-in');
  const {parsed, r} = buildPlanFor(date, txt);
  const title = date === t ? 'Build my day' : 'Build ' + dayWord(date);
  const chips = [0,1,2,3,4,5,6].map(n => { const d = addDays(t, n); return `<button class="chip ${d === date ? 'on' : ''}" data-act="build-date" data-date="${d}">${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : esc(fmtDay(d))}</button>`; }).join('');
  if (m.step === 'preview') return buildPreview(date, parsed, r, title);
  const already = planItems(date).filter(i => i.eventId);
  return `<div class="card-h"><h2>${esc(title)}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <div class="chips">${chips}</div>
    <form class="stack" data-form="build">
      <label class="fld" for="bd-in"><span>When you start and what's set. Anything with a time goes in; the rest of ${date === t ? 'today' : 'the day'}'s plan fits around it.</span></label>
      <textarea class="in big" id="bd-in" data-draft data-build data-date="${date}" rows="3" placeholder="Up at 8, pickleball 11-1, meeting at 1, pickleball 4-6" enterkeyhint="go">${esc(txt)}</textarea>
      <div id="bd-in-prev" aria-live="polite">${buildChips(parsed, r, date)}</div>
      <div class="btnrow"><button class="btn primary" type="submit">Build it</button><span class="meta">You see the new day before anything changes.</span></div>
    </form>
    ${already.length ? `<div class="meta">Already set that day and staying put: ${already.map(i => `${esc(itemName(i))} ${fmtTap(i.start)}`).join(' · ')}</div>` : ''}`;
}
function buildSummary(r, sep) {
  const n = {new:0, moved:0, shorter:0};
  r.plan.forEach(x => { if (n[x.status] !== undefined) n[x.status]++; });
  return [n.new && `${n.new} added`, n.moved && `${n.moved} moved`, n.shorter && `${n.shorter} shorter`, r.canceled.length && `${r.canceled.length} canceled`].filter(Boolean).join(sep);
}
function buildPreview(date, parsed, r, title) {
  const row = x => {
    const it = x.item, isNew = x.status === 'new', marker = !isNew && it.kind === 'marker';
    const tag = isNew ? newTag(it) : it.tag, text = isNew ? it.title : it.text;
    const pill = isNew ? '<span class="pill good">New</span>' : x.status === 'moved' ? `<span class="pill acc">Was ${fmtTap(x.was)}</span>`
      : x.status === 'shorter' ? `<span class="pill warn">Shorter · was ${fmtTap(x.was)}</span>` : x.status === 'done' ? '<span class="pill good">Done</span>' : x.status === 'fixed' ? '<span class="pill">Already set</span>' : '';
    return `<div class="bprow ${marker ? 'marker' : ''} ${x.status}"><span class="time mono">${fmtTap(x.start)}${x.end && x.end !== x.start && !marker ? `<br>${fmtTap(x.end)}` : ''}</span><span class="min0"><span class="txtc">${tag ? `<span class="tag ${isNew || it.oneoff ? 'ev' : ''}">${esc(tag)}</span>` : ''}${esc(text)}</span>${pill ? `<span class="sub">${pill}</span>` : ''}</span></div>`;
  };
  const why = {covered:'your court time covers it', room:'no room left'};
  const canceled = r.canceled.length ? `<div class="bcancel"><b>Canceled for the day</b>${['covered','room'].map(w => { const xs = r.canceled.filter(c => c.why === w); return xs.length ? `<div>${esc(listNames(xs.map(c => c.item)))} <span class="meta">· ${why[w]}</span></div>` : ''; }).join('')}</div>` : '';
  const sum = buildSummary(r, ' · ') || 'Nothing needs to change';
  return `<div class="card-h"><h2>${esc(title)}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <div class="bsum"><b>${esc(sum)}</b><span class="meta">${date === todayISO() ? `From ${fmtTap(r.from)} on.` : esc(fmtDayLong(date)) + '.'} Nothing changes until you tap Use this plan.</span></div>
    <div class="bplan">${r.plan.map(row).join('') || '<div class="meta">Nothing left on the plan.</div>'}</div>
    ${canceled}
    <div class="btnrow"><button class="btn primary" data-act="build-apply" data-date="${date}">Use this plan</button><button class="btn ghost" data-act="build-back">Change it</button></div>`;
}
// Writes the plan: new one-offs, that date's moves and cancels. One Undo puts it all back.
function applyBuild(date) {
  const {r} = buildPlanFor(date, draft('bd-in'));
  const day = dayOf(date), pm = day.moves || {}, ps = day.skips || {};
  const moves = {}, skips = {}, um = {}, us = {}, ops = [], base = Date.now();
  let added = 0;
  r.plan.forEach(x => {
    if (x.status === 'new') {
      const f = x.item, id = 'ev-' + (base + added++).toString(36);
      const doc = {title:f.title, date, start:f.start, end:f.end, where:'', notes:'', createdAt:Date.now(), updatedAt:Date.now()};
      if (f.type && f.type !== 'event') { doc.kind = f.type; if (f.sessionType) doc.sessionType = f.sessionType; }
      setDoc('events', id, doc); ops.push({del:['events', id]});
    } else if ((x.status === 'moved' || x.status === 'shorter') && !x.item.oneoff) {
      const ti = templateItem(dowOf(date), x.key); if (!ti) return;
      const usual = ti.start === x.start && (ti.end || ti.start) === x.end;
      moves[x.key] = usual ? null : {start:x.start, end:x.end}; um[x.key] = pm[x.key] || null;
    }
  });
  [...r.canceled.map(c => c.key), ...r.hidden].forEach(k => { skips[k] = true; us[k] = !!ps[k]; });
  const patch = {}, undo = {};
  if (Object.keys(moves).length) { patch.moves = moves; undo.moves = um; }
  if (Object.keys(skips).length) { patch.skips = skips; undo.skips = us; }
  if (Object.keys(patch).length) { patchDay(date, patch); ops.push({patch:['days', date, undo]}); }
  S.lastUndo = {type:'restore', ops};
  return r;
}

/* ----- your week: the next seven days at a glance ----- */
function weekSheet() {
  const t = todayISO(), off = Math.max(0, S.modal.offset || 0), first = addDays(t, off * 7);
  const days = [0,1,2,3,4,5,6].map(n => addDays(first, n));
  const col = d => {
    const items = planItems(d).filter(i => isCheckable(i) || i.eventId), day = dayOf(d), rest = isRestDay(d);
    const todo = tasksDue(d).length + (d === t ? tasksCarried(t).length : 0);
    const rows = items.map(i => {
      const sk = isSkipped(i, d), dn = !sk && d <= t && isDone(i, d);
      return `<button class="wrow ${sk ? 'skipped' : ''} ${dn ? 'done' : ''}" data-act="block" data-key="${esc(i.key)}" data-date="${d}" data-back="week"><span class="mono">${fmtT(i.start)}</span><span class="min0 ${i.eventId ? 'ev' : ''}">${esc(i.eventId ? ((S.data.events || {})[i.eventId] || {}).title || i.tag : i.tag || itemName(i))}</span>${i.movedFrom || i.movedFromDay ? '<i class="mv" title="Moved for this day"></i>' : ''}</button>`;
    }).join('');
    return `<section class="wday ${d === t ? 'today' : ''} ${rest ? 'rest' : ''}">
      <button class="wday-h" data-act="day-go" data-date="${d}"><b>${dowOf(d)} ${parseISO(d).getDate()}</b><span>${d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : esc(fmtShort(d))}</span>${day.off ? '<span class="pill">Day off</span>' : rest ? '<span class="pill">Rest</span>' : ''}</button>
      <div class="wday-b">${rows || '<div class="meta">Nothing planned</div>'}</div>
      <div class="wday-f"><span class="meta">${todo ? plural(todo, 'to-do') : ''}</span><button class="btn sm ghost" data-act="build-open" data-date="${d}">Build</button></div></section>`;
  };
  return `<div class="card-h"><h2>Your week</h2><div class="btnrow"><button class="btn sm" data-act="week-shift" data-d="-1" aria-label="Earlier" ${off ? '' : 'disabled'}>‹</button><span class="meta">${esc(fmtShort(days[0]))} – ${esc(fmtShort(days[6]))}</span><button class="btn sm" data-act="week-shift" data-d="1" aria-label="Later">›</button><button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
    <div class="meta">Tap a day to open it like Today, or a block to change it.</div>
    <div class="wgrid">${days.map(col).join('')}</div>`;
}

/* ----- your schedule: move, add and change blocks, for one day or every week ----- */
function typeSelect(id, value, scope) {
  const opts = ITEM_TYPES.filter(([, , only]) => !only || only === scope);
  if (!opts.some(([v]) => v === value)) value = scope === 'day' ? 'event' : 'task';
  return `<select class="in" id="${id}" data-draft data-rerender>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
const toggleRow = (id, on, label) => `<div class="btnrow"><button type="button" class="ck ${on ? 'on' : ''}" data-act="toggle-draft" data-k="${id}" data-v="${on ? 1 : 0}" aria-pressed="${on}" aria-label="${esc(label)}"></button><span>${esc(label)}</span></div>`;
const dayPicker = (act, sel, has) => `<div class="daychips">${WEEK_ORDER.map(x => `<button type="button" class="${sel.includes(x) ? 'on' : ''}" data-act="${act}" data-d="${x}" aria-pressed="${sel.includes(x)}">${x}${has && has.includes(x) ? '<i class="hasdot"></i>' : ''}</button>`).join('')}</div>`;
function schedSheet() {
  const today = todayISO(), date = S.modal.date || today;
  const items = planItems(date), dow = dowOf(date);
  const chips = [0,1,2,3,4,5,6].map(n => { const d = addDays(today, n); return `<button class="chip ${d === date ? 'on' : ''}" data-act="sched-open" data-date="${d}">${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : esc(fmtDay(d))}</button>`; }).join('');
  const other = date < today || date > addDays(today, 6);
  return `<div class="card-h"><h2>Your schedule</h2><button class="btn sm ghost" data-act="modal-close">Done</button></div>
    <div class="chips">${chips}${other ? `<button class="chip on">${esc(fmtDay(date))}</button>` : ''}</div>
    <div class="schedhead"><b>${esc(fmtDayLong(date))}</b>${isRestDay(date) ? ' <span class="pill">Rest day</span>' : ''}<label class="pickday meta">Another day <input class="in" type="date" id="sc-date" value="${date}"></label></div>
    <div class="meta">Tap a block to reschedule it, cancel it for the day, or edit it for every ${DOW_LONG[dow]}.</div>
    <div class="sched">${items.map(i => schedRow(i, date)).join('') || '<div class="meta">Nothing planned.</div>'}</div>
    <div class="btnrow"><button class="btn primary" data-act="add-open" data-date="${date}" data-back="sched">+ Add to ${esc(dayWord(date))}</button><button class="btn" data-act="add-open" data-date="${date}" data-scope="week" data-back="sched">+ Add to every ${DOW_LONG[dow]}</button></div>`;
}
function schedRow(i, date) {
  const skipped = isCheckable(i) && isSkipped(i, date);
  const notes = [i.movedFrom ? `<span class="pill acc">Moved from ${fmtTap(i.movedFrom)}</span>` : '', i.movedFromDay ? `<span class="pill acc">Moved from ${esc(fmtDay(i.movedFromDay))}</span>` : '', i.eventId ? '<span class="pill good">Just this day</span>' : '', skipped ? '<span class="pill">Canceled</span>' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="srow-b ${skipped ? 'skipped' : ''} ${i.kind === 'marker' ? 'marker' : ''}" data-act="block" data-key="${esc(i.key)}" data-date="${date}" data-back="sched">
    <span class="time mono">${fmtTap(i.start)}${i.end && i.end !== i.start ? `<br>${fmtTap(i.end)}` : ''}</span>
    <span class="min0"><span class="txtc">${i.tag ? `<span class="tag ${i.eventId ? 'ev' : ''}">${esc(i.tag)}</span>` : ''}${esc(i.text)}</span>${notes ? `<span class="sub">${notes}</span>` : ''}</span>
    <span class="chev" aria-hidden="true">›</span></button>`;
}
// What, when, type, where and details: shared by the Add form and the one-off edit form.
function itemFields(o) {
  return `<div class="fld"><label for="ev-title">What</label><input class="in" id="ev-title" data-draft value="${esc(o.title)}" placeholder="${o.scope === 'week' ? 'Gym, pickleball, study' : 'Pickleball, dentist, demo with Lisa'}" autocomplete="off"></div>
    ${o.scope === 'day' ? `<div class="fld"><label for="ev-date">Date</label><input class="in" type="date" id="ev-date" data-draft ${o.dateRerender ? 'data-rerender' : ''} value="${esc(o.date)}"></div>` : ''}
    <div class="grid2"><div class="fld"><label for="ev-start">Starts</label><input class="in" type="time" id="ev-start" data-draft value="${esc(o.start)}"></div><div class="fld"><label for="ev-end">Ends</label><input class="in" type="time" id="ev-end" data-draft value="${esc(o.end)}"></div></div>
    <div class="fld"><label for="ad-type">Type</label>${typeSelect('ad-type', o.type, o.scope)}</div>
    ${o.scope === 'day' ? `<div class="fld"><label for="ev-where">Where</label><input class="in" id="ev-where" data-draft value="${esc(o.where)}" placeholder="Address, Zoom, the courts"></div>` : ''}
    <div class="fld"><label for="ev-notes">Details</label><textarea class="in" id="ev-notes" data-draft placeholder="Optional">${esc(o.notes)}</textarea></div>`;
}
function addForm() {
  const m = S.modal, scope = m.scope === 'week' ? 'week' : 'day';
  const date = draft('ev-date', m.date || todayISO()), dow = dowOf(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO());
  const type = draft('ad-type', scope === 'day' ? 'event' : 'task'), kind = splitType(type).kind;
  const sel = m.days && m.days.length ? m.days : [dow];
  const carry = S.drafts['ad-carry'] !== undefined ? S.drafts['ad-carry'] : false;
  const back = m.back === 'sched' ? `<button class="btn sm ghost" data-act="sched-open" data-date="${m.date}">‹ Back</button>` : '';
  return `<div class="card-h"><h2>Add to your plan</h2><div class="btnrow">${back}<button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
    <div class="seg scope" role="group" aria-label="Which days"><button type="button" class="${scope === 'day' ? 'on' : ''}" data-act="add-scope" data-s="day" aria-pressed="${scope === 'day'}">Just one day</button><button type="button" class="${scope === 'week' ? 'on' : ''}" data-act="add-scope" data-s="week" aria-pressed="${scope === 'week'}">Every week</button></div>
    <form class="stack" data-form="add">
      ${itemFields({scope, title:draft('ev-title'), date, start:draft('ev-start'), end:draft('ev-end'), type, where:draft('ev-where'), notes:draft('ev-notes'), dateRerender:true})}
      ${scope === 'week' ? `<div class="fld"><label>Repeats on</label>${dayPicker('ad-day', sel)}</div>${carryable(kind) ? toggleRow('ad-carry', carry, 'If you miss it, it comes back the next day as a make-up') : ''}` : ''}
      <div class="meta">${scope === 'day' ? "It shows in that day's plan and nudges you like any block." : `It becomes part of ${esc(daysLabel(sel))} from now on.`}${kind === 'session' ? ' Check it off when you play and the session counts toward your week.' : ''}</div>
      <div class="btnrow"><button class="btn primary" type="submit">Add</button></div>
    </form>`;
}
function eventForm() {
  const id = S.modal.id, e = (S.data.events || {})[id];
  if (!e) return closeOnly('Event');
  const f = (k, def) => draft('ev-' + k, def);
  const type = draft('ad-type', e.kind && e.kind !== 'event' ? (e.kind === 'session' ? 'session:' + (e.sessionType || 'Drill') : e.kind) : 'event');
  return `<div class="card-h"><h2>Edit</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="event-edit" data-id="${esc(id)}">
      ${itemFields({scope:'day', title:f('title', e.title), date:f('date', e.date), start:f('start', e.start), end:f('end', e.end), type, where:f('where', e.where), notes:f('notes', e.notes)})}
      <div class="btnrow"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="event-ics" data-id="${esc(id)}">Add to my calendar</button>${S.confirm === 'ev-del' ? `<button class="btn badb" type="button" data-act="event-delete" data-id="${esc(id)}">Yes, delete it</button>` : '<button class="btn ghost" type="button" data-act="confirm" data-c="ev-del">Delete</button>'}</div>
    </form>`;
}
// Change a block of the weekly plan: label, details, times, type, and which weekdays get the change.
function blockEditForm() {
  const m = S.modal, date = m.date || todayISO(), dow = dowOf(date), ti = templateItem(dow, m.key);
  if (!ti) return closeOnly('Block');
  const f = (k, def) => draft('be-' + k, def);
  const special = ['checkin','checkout','dupr'].includes(ti.kind);
  const type = special ? typeOf(ti) : draft('ad-type', typeOf(ti)), kind = splitType(type).kind;
  const has = WEEK_ORDER.filter(x => templateItem(x, m.key));
  const sel = m.days && m.days.length ? m.days : [dow];
  const carry = S.drafts['be-carry'] !== undefined ? S.drafts['be-carry'] : !!ti.carry;
  return `<div class="card-h"><h2>Change ${esc(itemName(ti))}</h2><div class="btnrow"><button class="btn sm ghost" data-act="block" data-key="${esc(m.key)}" data-date="${date}">‹ Back</button><button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
    <form class="stack" data-form="block-edit">
      <div class="fld"><label for="be-tag">Label</label><input class="in" id="be-tag" data-draft value="${esc(f('tag', ti.tag))}" placeholder="A short name, like GYM or PLAY" autocomplete="off"></div>
      <div class="fld"><label for="be-text">Details</label><textarea class="in" id="be-text" data-draft>${esc(f('text', ti.text))}</textarea></div>
      <div class="grid2"><div class="fld"><label for="be-start">Starts</label><input class="in" type="time" id="be-start" data-draft value="${esc(f('start', ti.start))}"></div><div class="fld"><label for="be-end">Ends</label><input class="in" type="time" id="be-end" data-draft value="${esc(f('end', ti.end || ti.start))}"></div></div>
      ${special ? '' : `<div class="fld"><label for="ad-type">Type</label>${typeSelect('ad-type', type, 'week')}</div>`}
      ${kind === 'calls' ? `<div class="grid2"><div class="fld"><label for="be-quota">Dials</label><input class="in" id="be-quota" data-draft inputmode="numeric" value="${esc(f('quota', ti.quota || 10))}"></div><div class="fld"><label for="be-region">Leads</label><select class="in" id="be-region" data-draft>${[['IA','Iowa'],['AZ','Arizona'],['','Any']].map(([v, l]) => `<option value="${v}" ${String(f('region', ti.region || '')) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>` : ''}
      ${carryable(kind) ? toggleRow('be-carry', carry, 'If you miss it, it comes back the next day as a make-up') : ''}
      <div class="fld"><label>Apply to</label>${dayPicker('be-day', sel, has)}<div class="meta">${has.length > 1 ? 'A dot means that day has this block too. ' : ''}Pick more days to change them as well. A day without it gets a copy.</div></div>
      <div class="btnrow"><button class="btn primary" type="submit">Save for ${esc(daysLabel(sel))}</button>${S.confirm === 'be-del' ? `<button class="btn badb" type="button" data-act="block-remove">Yes, remove it from ${esc(daysLabel(sel))}</button>` : '<button class="btn ghost" type="button" data-act="confirm" data-c="be-del">Remove from your week</button>'}</div>
      <div class="meta">To cancel it just once, go back and tap Cancel.</div>
    </form>`;
}

/* ----- the assistant: talk to Claude inside the app ----- */
const assistantUrl = () => sbConfig ? String(sbConfig.url).replace(/\/+$/, '') + '/functions/v1/assistant' : '';
const coarsePointer = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
const chatDoc = () => (S.data.chat || {}).main || {messages:[]};
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let recog = null;
function fmtChat(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^(?:- |• )(.*)$/gm, '<span class="li">$1</span>').replace(/\n/g, '<br>');
}
async function askAssistant(text) {
  text = String(text || '').trim();
  if (!text || S.chatBusy) return;
  if (!assistantUrl()) { S.chatErr = 'Connect your Supabase project first.'; render(); return; }
  const prev = (chatDoc().messages || []).slice(-40);
  const history = prev.slice(-16).map(m => ({role:m.role, content:m.content}));
  setDoc('chat', 'main', {messages:[...prev, {role:'user', content:text, at:Date.now()}].slice(-40)});
  // Empty and blur the box before re-rendering: a focused field that is replaced fires a late
  // change event, and the generic draft listener would put the sent text straight back.
  const box = document.getElementById('chat-in'); if (box) { box.value = ''; box.blur(); }
  S.chatBusy = true; S.chatErr = null; clearDrafts('chat-'); render(); clearDrafts('chat-'); chatScroll();
  try {
    const {data} = await supabase.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('Sign out and back in, then try again.');
    const now = new Date();
    const r = await fetch(assistantUrl(), {method:'POST', headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + token},
      body:JSON.stringify({message:text, history, tz:Intl.DateTimeFormat().resolvedOptions().timeZone, today:todayISO(), now:`${pad(now.getHours())}:${pad(now.getMinutes())}`})});
    if (r.status === 404) { S.assist = {fn:'missing'}; throw new Error("The assistant isn't set up yet. Tap Set it up above for the three steps."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `The assistant answered ${r.status}.`);
    S.assist = {fn:'ok', hasKey:true, model:j.model, version:Number(j.version) || 1};
    const cur = chatDoc().messages || [];
    setDoc('chat', 'main', {messages:[...cur, {role:'assistant', content:j.reply || '(no answer)', at:Date.now(), actions:j.actions || []}].slice(-40)});
    if (j.actions && j.actions.length && db) db.refresh().catch(() => {});
  } catch (e) { S.chatErr = (e && e.message) || "Couldn't reach the assistant. Check your connection."; }
  S.chatBusy = false; render(); chatScroll();
  if (S.modal && S.modal.type === 'chat' && !coarsePointer()) { const b = document.getElementById('chat-in'); if (b) b.focus(); }
}
function chatScroll() { setTimeout(() => { const el = document.getElementById('chat-log'); if (el) el.scrollTop = el.scrollHeight; }, 30); }
function chatMic() {
  if (!SR) return;
  if (recog) { try { recog.stop(); } catch(e) {} recog = null; S.listening = false; render(); return; }
  recog = new SR(); recog.lang = navigator.language || 'en-US'; recog.interimResults = true; recog.continuous = false;
  let finalText = '';
  recog.onresult = ev => { let interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) finalText += t; else interim += t; } const box = document.getElementById('chat-in'); if (box) { box.value = (finalText + interim).trim(); S.drafts['chat-in'] = box.value; } };
  recog.onend = () => { recog = null; S.listening = false; const box = document.getElementById('chat-in'); if (box && box.value.trim() && finalText) askAssistant(box.value); else render(); };
  recog.onerror = () => { recog = null; S.listening = false; S.chatErr = 'The microphone did not work. Check the browser permission and try again.'; render(); };
  S.listening = true; render();
  try { recog.start(); } catch(e) { recog = null; S.listening = false; render(); }
}
function chatSheet() {
  const msgs = chatDoc().messages || [];
  const st = S.assist || {};
  const setup = st.fn === 'missing' ? ['The assistant is not set up yet. It runs in your own Supabase project with your own Anthropic key: three steps, about five minutes.', 'Set it up']
    : st.fn === 'ok' && !st.hasKey ? ['One step left: add your Anthropic key as a secret in Supabase.', 'Finish setup']
    : st.fn === 'ok' && (st.version || 1) < ASSISTANT_V ? ['A newer assistant is ready. Paste the new code over the old one in Supabase so it can move your schedule.', 'Update it'] : null;
  const sugg = ['What should I focus on right now?', 'I have pickleball 12 to 2 today', 'Move my drill to 6 am tomorrow', 'Push everything after lunch 30 minutes', "How's my week against the targets?", 'Add a to-do for tomorrow: '];
  return `<div class="card-h"><h2>Ask</h2><div class="btnrow"><button class="btn sm ghost" data-act="chat-clear" ${msgs.length ? '' : 'disabled'}>Clear</button><button class="btn sm ghost" data-act="modal-close">Close</button></div></div>
    ${setup ? `<div class="setupcard"><span>${esc(setup[0])}</span><button class="btn sm primary" data-act="assistant-setup">${setup[1]}</button></div>` : ''}
    <div class="chat" id="chat-log">
      ${msgs.length ? msgs.map(m => `<div class="msg ${m.role}"><div class="bubble">${fmtChat(m.content)}</div>${m.actions && m.actions.length ? `<div class="done-acts">${m.actions.map(a => `<span class="pill good">${esc(a)}</span>`).join('')}</div>` : ''}</div>`).join('') : '<div class="meta">Ask about your day, your numbers or a lead, or tell me to add something. I can see your plan, to-dos, calls and week, and I can move, add and skip blocks, check things off, and log your check-in and sessions.</div>'}
      ${S.chatBusy ? '<div class="msg assistant"><div class="bubble thinking">Thinking…</div></div>' : ''}
      ${S.chatErr ? `<div class="err">${esc(S.chatErr)}</div>` : ''}
    </div>
    ${!msgs.length && !S.chatBusy ? `<div class="chips">${sugg.map(s => `<button class="chip" data-act="chat-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <form class="chatbar" data-form="chat">
      <textarea class="in" id="chat-in" rows="1" data-draft placeholder="${S.listening ? 'Listening…' : 'Type, or tap the mic'}">${esc(draft('chat-in'))}</textarea>
      ${SR ? `<button type="button" class="btn ${S.listening ? 'primary' : ''}" data-act="chat-mic" aria-label="Dictate" title="Dictate">${S.listening ? '●' : '🎤'}</button>` : ''}
      <button class="btn primary" type="submit" ${S.chatBusy ? 'disabled' : ''}>Send</button>
    </form>`;
}
async function assistantCheck(quiet) {
  if (!assistantUrl()) return;
  if (!quiet) { S.assist = {...(S.assist || {}), checking:true}; render(); }
  try {
    const r = await fetch(assistantUrl() + '?status=1');
    if (r.status === 404) S.assist = {fn:'missing'};
    else if (r.status === 401 || r.status === 403) S.assist = {fn:'error', msg:'The function is there but still checks for a login. Open its settings and turn off "Verify JWT".'};
    else if (!r.ok) S.assist = {fn:'error', msg:`The function answered ${r.status}.`};
    else { const j = await r.json(); S.assist = {fn:'ok', hasKey:!!j.hasKey, model:j.model, version:Number(j.version) || 1}; }
  } catch (e) { S.assist = {fn:'error', msg:"Couldn't reach the function. Check your connection and that it is deployed."}; }
  render();
}
function assistantSheet() {
  const st = S.assist || {}, outdated = st.fn === 'ok' && (st.version || 1) < ASSISTANT_V;
  const step = (n, title, body, ok) => `<div class="step ${ok ? 'ok' : ''}"><div class="num">${ok ? '✓' : n}</div><div class="min0"><b>${title}</b><div class="meta" style="color:var(--ink-2)">${body}</div></div></div>`;
  return `<div class="card-h"><h2>Assistant</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <p class="meta" style="margin:0;color:var(--ink-2)">Talk to Claude inside the app. It runs in your own Supabase project with your own Anthropic key, sees your live data, and can add to-dos and calendar events for you. Three steps, once. If a request is ever declined by Anthropic's safety filters, it automatically retries on a fallback model.</p>
    ${step(1, 'Get an Anthropic API key', 'At <b>console.anthropic.com</b>: add a few dollars of credit under Billing, then <b>Settings › API keys › Create key</b>. Copy it.', !!st.hasKey)}
    ${step(2, 'Create the function', `In Supabase open <b>Edge Functions</b> › <b>Deploy a new function</b> › <b>Via Editor</b>. Name it <span class="kbd">assistant</span>, replace all the code with the copied code, and <b>Deploy</b>. Then open the function's <b>Settings</b> and turn <b>off</b> "Verify JWT".<div class="btnrow" style="margin-top:6px"><button class="btn sm" data-act="copy-assistant">Copy the code</button><button class="btn sm ghost" data-act="assistant-check">${st.checking ? 'Checking…' : 'Check'}</button>${st.fn === 'ok' ? (outdated ? '<span class="pill warn">Update needed</span>' : '<span class="pill good">Found</span>') : st.fn === 'missing' ? '<span class="pill warn">Not found yet</span>' : st.fn === 'error' ? '<span class="pill bad">Problem</span>' : ''}</div>${outdated ? '<div class="meta" style="margin-top:6px">Supabase is running an older copy that cannot move your schedule. Copy the code, open the <b>assistant</b> function, replace all of its code, Deploy, then tap Check.</div>' : ''}${st.fn === 'error' && st.msg ? `<div class="err" style="margin-top:6px">${esc(st.msg)}</div>` : ''}`, st.fn === 'ok' && !outdated)}
    ${step(3, 'Give it the key', `In Supabase open <b>Edge Functions</b> › <b>Secrets</b> (or Project Settings › Edge Functions). Add a secret named <span class="kbd">ANTHROPIC_API_KEY</span> with the key from step 1. Then tap Check again.${st.fn === 'ok' ? (st.hasKey ? ' <span class="pill good">Key is set</span>' : ' <span class="pill warn">No key yet</span>') : ''}`, st.fn === 'ok' && !!st.hasKey)}
    <div class="btnrow">${st.fn === 'ok' && st.hasKey ? '<button class="btn primary" data-act="ask">Open the assistant</button>' : ''}<span class="meta">Model: ${esc(st.model || 'claude-opus-5-5')}. Each question costs a few cents.</span></div>`;
}

/* ----- EMAIL AND THE PIPELINE ----- */
// Every business is one lead. The Pipeline tab moves leads between stages (by hand, or by a reply or a
// call); the Email tab runs the engine in supabase/functions/outreach, which sends from your Gmail, reads
// the replies, moves leads, and finds new ones every day.
const outreachUrl = () => sbConfig ? String(sbConfig.url).replace(/\/+$/, '') + '/functions/v1/outreach' : '';
const EM_LABEL = {interested:['Interested','good'], question:['Question','acc'], referral:['Referral','acc'], not_now:['Not now','warn'], not_interested:['Not interested','bad'], unsubscribe:['Unsubscribed','bad'], bounce:['Bounced','bad'], auto:['Auto-reply',''], other:['Replied','']};
const EM_LABEL_ORDER = ['interested','question','referral','not_now','other','not_interested','unsubscribe','bounce','auto'];
const EM_SUP_REASON = {not_interested:'Not interested', unsubscribe:'Asked not to be emailed', bounce:'Bounced'};
const EM_SEQ_CLS = {hold:'warn', queued:'', active:'acc', done:'', replied:'acc', paused:'warn', stopped:'', bounced:'bad'};
const EM_SEQ_RANK = {replied:0, active:1, queued:2, hold:3, paused:4, done:5, stopped:6, bounced:7};
const EM_REPLY_GROUPS = [['all','All'], ['hot','Hot',HOT], ['later','Not now',['not_now','other']], ['no','No',['not_interested','unsubscribe']], ['bounced','Bounced',['bounce']], ['auto','Auto-replies',['auto']]];
const EM_TZS = [['America/Chicago','Central (Iowa)'], ['America/Phoenix','Arizona'], ['America/Denver','Mountain'], ['America/Los_Angeles','Pacific'], ['America/New_York','Eastern']];
const EM_WHY = {address:'Waiting for your mailing address (Settings).', cap:"Today's limit is reached. More go out on the next sending day.", gap:'Spacing the emails out.', 'no-campaign':'No campaign is on.', 'nothing-due':"Outside sending hours, or everyone is waiting for their next follow-up day.", template:'A campaign email needs fixing before it can send.'};
const EM_MODELS = [['claude-opus-5-5','Opus 5.5 (best)'], ['claude-sonnet-5-5','Sonnet 5.5 (half the cost)']];
// Stand-ins for the preview when you have no lead of that type yet.
const EM_SAMPLE = {medspa:['Glow Aesthetics','Med spa','Scottsdale','AZ'], wellness:['Desert Drip IV','IV and wellness','Phoenix','AZ'], chiro:['Peak Chiropractic','Chiropractor','Ankeny','IA'], club:['Prairie Pickleball Club','Pickleball club','Des Moines','IA'], studio:['Core Pilates','Pilates studio','Scottsdale','AZ'], services:['Cool Air HVAC','HVAC','Mesa','AZ'], dental:['Bright Smile Dental','Dentist','West Des Moines','IA'], general:['Main Street Studio','Local business','Ames','IA']};
const EM_FILTERS = [
  ['all','All', () => true],
  ['look','Needs a look', l => emStuck(l) || (l.seq.status === 'paused' && l.seq.pausedWhy === 'failed')],
  ['hot','Hot', l => l.seq.status === 'replied' && l.reply && HOT.includes(l.reply.label)],
  ['replied','Replied', l => l.seq.status === 'replied' && !(l.reply && HOT.includes(l.reply.label))],
  ['active','In sequence', l => l.seq.status === 'active'],
  ['queued','Up next', l => l.seq.status === 'queued'],
  ['hold','Check first', l => l.seq.status === 'hold'],
  ['paused','Paused', l => l.seq.status === 'paused'],
  ['done','Finished', l => l.seq.status === 'done'],
  ['stopped','Stopped', l => l.seq.status === 'stopped'],
  ['bounced','Bounced', l => l.seq.status === 'bounced' || !!l.emailBad],
];
const outDoc = id => (S.data.outreach || {})[id] || null;
const emSettings = () => outSettings(outDoc('settings'));
const emState = () => outDoc('state') || {};
const emCampaigns = () => Object.entries(S.data.campaigns || {}).filter(([, c]) => c && c.name).map(([id, c]) => ({id, ...c})).sort((a, b) => (a.order || 9) - (b.order || 9) || String(a.name).localeCompare(String(b.name)));
const allLeads = () => Object.entries(S.data.leads || {}).filter(([, l]) => l && (l.name || l.email)).map(([id, l]) => ({id, ...l}));
const emLeads = () => allLeads().filter(l => l.seq && l.seq.campaign);
const emReplies = () => Object.entries(S.data.replies || {}).filter(([, r]) => r && r.at).map(([id, r]) => ({id, ...r, lead:r.lead || r.prospect})).sort((a, b) => String(b.at).localeCompare(String(a.at)));
const emSuppressed = () => new Set(Object.keys(S.data.suppress || {}).map(e => e.toLowerCase()));
const emHot = () => emReplies().filter(r => HOT.includes(r.label) && !r.handled);
const emStuck = l => !!(l.seq && l.seq.sendingStep != null && l.seq.sendingAt && Date.now() - Date.parse(l.seq.sendingAt) > 15 * 60000);
const emGmail = () => (S.outEng && S.outEng.gmail && S.outEng.gmail.email) || emState().gmail || '';
// The engine Supabase runs is older than the copy in this app (from its status check or its last run).
const emOutdated = () => { const e = S.outEng || {}, st = emState(); return (e.fn === 'ok' && (e.version || 1) < OUTREACH_V) || (!!st.version && st.version < OUTREACH_V); };
const emEngineOk = () => !!((S.outEng && S.outEng.fn === 'ok' && S.outEng.gmail && S.outEng.gmail.ok) || emState().gmail);
const gmailThread = id => `https://mail.google.com/mail/${emGmail() ? '?authuser=' + encodeURIComponent(emGmail()) : 'u/0/'}#all/${encodeURIComponent(id)}`;
const gmailCompose = to => `https://mail.google.com/mail/?${emGmail() ? 'authuser=' + encodeURIComponent(emGmail()) + '&' : ''}view=cm&fs=1&to=${encodeURIComponent(to)}`;
const emHref = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : 'https://' + String(u || '');
const emShortUrl = u => String(u || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const leadWhere = l => [l.city || String(l.business || '').split(',').slice(1).join(',').trim(), l.state || l.region].filter(Boolean).join(', ');
const leadKind = l => l.kind || String(l.business || '').split(',')[0].trim();
const emStepName = (n, len) => n === 0 ? 'First email' : n >= (len || 3) - 1 ? 'Last follow-up' : `Follow-up ${n}`;
const emLabelPill = l => { const x = EM_LABEL[l] || EM_LABEL.other; return `<span class="pill ${x[1]}">${x[0]}</span>`; };
const emSeqPill = l => l.dnc ? '<span class="pill bad">Do not contact</span>' : l.seq && l.seq.status === 'replied' && l.reply ? emLabelPill(l.reply.label) : `<span class="pill ${EM_SEQ_CLS[l.seq && l.seq.status] || ''}">${esc(SEQ_STATUS[l.seq && l.seq.status] || '')}</span>`;
const emSegLabel = (cid, k) => ((((S.data.campaigns || {})[cid] || {}).segments || {})[k] || {}).label || k;
const emReplyWord = n => `${n} ${n === 1 ? 'reply' : 'replies'}`;
const emWhen = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('en-US', {weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); };
const dollars = n => '$' + (Number(n) || 0).toFixed(2);
function emAgo(ts) {
  const at = typeof ts === 'number' ? ts : Date.parse(ts || '');
  if (!Number.isFinite(at)) return '';
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
}
// "Mon–Sat" for a run of days, otherwise the usual list.
function emDays(days) {
  const idx = WEEK_ORDER.map((d, i) => days.includes(d) ? i : -1).filter(i => i >= 0);
  if (idx.length === 7) return 'every day';
  if (idx.length > 2 && idx[idx.length - 1] - idx[0] === idx.length - 1) return `${WEEK_ORDER[idx[0]]}–${WEEK_ORDER[idx[idx.length - 1]]}`;
  return daysLabel(days);
}
function emProgress(l) {
  const q = l.seq || {}, c = (S.data.campaigns || {})[q.campaign] || {}, len = (c.steps || []).length || 3, step = Number(q.step) || 0;
  if (q.sendingStep != null) return emStuck(l) ? 'Check Gmail' : 'Sending now';
  if (q.status === 'replied') return l.reply && l.reply.at ? 'Replied ' + emAgo(l.reply.at) : 'Replied';
  if (q.status === 'done') return `All ${len} sent`;
  if (q.status === 'stopped') return `Stopped at ${q.stoppedWhy || 'a new stage'}`;
  if (!step) return q.status === 'hold' ? 'Waiting for you' : 'Not emailed yet';
  return `${step} of ${len} sent${q.nextOn && q.status === 'active' ? ' · next ' + (q.nextOn <= todayISO() ? 'today' : fmtShort(q.nextOn)) : ''}`;
}
// The sequence a paused or wrongly sorted lead goes back to: in line, or in sequence with a follow-up day.
function emResume(l) {
  const q = l.seq || {}, c = (S.data.campaigns || {})[q.campaign] || {}, len = (c.steps || []).length || 3, step = Number(q.step) || 0, t = todayISO();
  if (step >= len) return {status:'done', nextOn:null, pausedWhy:null};
  if (!step) return {status:'queued', pausedWhy:null};
  return {status:'active', nextOn:q.nextOn && q.nextOn >= t ? q.nextOn : t, pausedWhy:null};
}
// The old values of the fields a patch changes, for Undo.
const backOf = (l, patch) => Object.fromEntries(Object.keys(patch).map(k => [k, l && l[k] !== undefined ? clone(l[k]) : null]));

/* heat: how close a lead is to buying */
const leadHeat = l => heatOf(l, Date.now());
const heatChip = l => { const h = leadHeat(l); return `<span class="heat ${h.cls}" title="${h.label}, ${h.score} of 100">${h.cls === 'hot' ? '🔥 ' : ''}${h.label}</span>`; };
// The latest thing that happened with a lead, in words.
function leadLast(l) {
  const c = [];
  if (l.reply && l.reply.at) c.push([Date.parse(l.reply.at), 'Replied']);
  if (l.seq && l.seq.lastAt) c.push([Date.parse(l.seq.lastAt), 'Emailed']);
  if (l.lastTouch) c.push([Date.parse(l.lastTouch + 'T12:00:00'), 'Called']);
  if (l.stageAt) c.push([Number(l.stageAt), 'Moved']);
  const best = c.filter(x => Number.isFinite(x[0]) && x[0] > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? `${best[1]} ${emAgo(best[0])}` : '';
}
const leadSourceName = l => l.source === 'Finder' ? 'Found by the finder' : l.source === 'Import' ? 'Imported' : l.source === 'Manual' ? 'Added by you' : 'Call list';
let emSeeded = false, emCheckStarted = false, emMigrated = false;
// The four campaigns and the settings document, written once when they are missing. The engine only
// works for an account that has settings, and it never sends while they say paused.
function maybeSeedOutreach() {
  if (emSeeded || !db || !db.status().loaded || !allLoaded()) return;
  emSeeded = true;
  for (const [id, c] of Object.entries(DEFAULT_CAMPAIGNS)) if (!(S.data.campaigns || {})[id]) setDoc('campaigns', id, {...clone(c), createdAt:Date.now()});
  if (!outDoc('settings')) setDoc('outreach', 'settings', {enabled:false, createdAt:Date.now()});
  maybeMigrateProspects();
}
// Version 1.9 kept email contacts in their own collection; they become leads (or join the lead they came from).
function maybeMigrateProspects() {
  if (emMigrated) return; emMigrated = true;
  const ps = Object.entries(S.data.prospects || {}).filter(([, p]) => p && p.email);
  if (!ps.length) return;
  const map = {hold:'hold', queued:'queued', active:'active', done:'done', paused:'paused', hot:'replied', replied:'replied', no:'replied', unsub:'replied', bounced:'bounced'};
  const byEmail = {}; allLeads().forEach(l => { if (l.email) byEmail[String(l.email).toLowerCase()] = l.id; });
  for (const [pid, p] of ps) {
    const email = String(p.email).toLowerCase(), lid = (p.leadId && S.data.leads[p.leadId] ? p.leadId : byEmail[email]) || leadIdFor(email);
    const seq = {campaign:p.campaign, status:map[p.status] || 'queued', step:Number(p.step) || 0, nextOn:p.nextOn || null, threadId:p.threadId || null, rfcId:p.rfcId || null, lastAt:p.lastAt || null, sendingStep:p.sendingStep ?? null, sendingAt:p.sendingAt || null, failCount:p.failCount || 0, lastError:p.lastError || null, pausedWhy:p.pausedWhy || null, stoppedWhy:null};
    const extra = {email, seq, enrolled:{[p.campaign]:todayISO()}, threads:p.threadId ? [p.threadId] : [], sentLog:(p.sent || []).map(x => ({at:x.at, campaign:p.campaign, step:x.step, id:x.id})),
      ...(p.replyClass ? {reply:{label:p.replyClass, at:p.replyAt, summary:p.replySummary || ''}} : {}), ...(['no','unsub'].includes(p.status) ? {dnc:true} : {}), ...(p.status === 'bounced' ? {emailBad:true} : {})};
    if (S.data.leads[lid]) patchDoc('leads', lid, {...extra, firstName:S.data.leads[lid].firstName || p.firstName || '', foundAt:S.data.leads[lid].foundAt || p.foundAt || ''});
    else setDoc('leads', lid, {name:p.business || email, business:[p.type, p.city].filter(Boolean).join(', '), contact:'', firstName:p.firstName || '', phone:p.phone || '', website:p.website || '', city:p.city || '', state:p.state || '',
      region:['IA','AZ'].includes(p.state) ? p.state : '', kind:p.type || '', segment:p.segment || segmentOf(p.type), type:'Cold', stage:Number(p.step) > 0 ? 'Contacted' : 'New lead', stageAt:Date.now(), source:'Import', foundAt:p.foundAt || '',
      confidence:p.confidence || 'Good', callList:false, touches:0, notes:'', createdAt:p.createdAt || Date.now(), updatedAt:Date.now(), ...extra});
    Object.entries(S.data.replies || {}).forEach(([rid, r]) => { if (r && r.prospect === pid && !r.lead) patchDoc('replies', rid, {lead:lid}); });
    delDoc('prospects', pid);
  }
}
async function outreachCheck(quiet) {
  if (!outreachUrl()) return;
  if (!quiet) { S.outEng = {...(S.outEng || {}), checking:true}; render(); }
  let res;
  try {
    const r = await fetch(outreachUrl() + '?status=1');
    if (r.status === 404) res = {fn:'missing'};
    else if (r.status === 401 || r.status === 403) res = {fn:'error', msg:'The function is there but still checks for a login. Open its settings and turn off "Verify JWT".'};
    else if (!r.ok) res = {fn:'error', msg:`The function answered ${r.status}.`};
    else { const j = await r.json(); res = {fn:'ok', version:Number(j.version) || 1, gmail:j.gmail || {}, hasKey:!!j.hasKey, lastRun:j.lastRun || null, lastError:j.lastError || null}; }
  } catch (e) { res = {fn:'error', msg:"Couldn't reach the function. Check your connection and that it is deployed."}; }
  S.outEng = {...res, at:Date.now()};
  if (quiet) scheduleRender(); else render();
}
// Waits until the given writes reached Supabase, so the engine reads what you just saved.
async function emSettle(paths) {
  try { await Promise.all(paths.map(p => queues[p]).filter(Boolean)); } catch (e) {}
  for (let i = 0; i < 25 && db && db.status().pending; i++) { try { await db.flush(); } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
}
async function emTest(id, quiet) {
  if (S.emTestBusy && !quiet) return null;
  S.emTestBusy = true; render();
  let out = null;
  try {
    if (!outreachUrl()) throw new Error('Connect your Supabase project first.');
    await emSettle(['campaigns/' + id, 'outreach/settings']);
    const {data} = await supabase.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('Sign out and back in, then try again.');
    const r = await fetch(outreachUrl() + '?test=1&campaign=' + encodeURIComponent(id), {method:'POST', headers:{'Authorization':'Bearer ' + token}});
    if (r.status === 404) throw new Error("The email engine isn't set up yet. Open Engine setup on the Email tab.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `The engine answered ${r.status}.`);
    out = {ok:true, to:j.to, missing:j.missing || []};
    if (!quiet) toast(`Test sent to ${j.to}. It's in your inbox now.${j.missing && j.missing.length ? ` Fill in ${j.missing.join(', ')} before it can go out.` : ''}`);
  } catch (e) { out = {ok:false, error:(e && e.message) || "Couldn't send the test."}; if (!quiet) toast(out.error); }
  if (!quiet) { S.emTestBusy = false; render(); }
  return out;
}
// Both cold campaigns' first emails to your own inbox, one after the other.
async function emTestBoth() {
  if (S.emTestBusy) return;
  const ids = LAUNCH_CAMPS.filter(id => (S.data.campaigns || {})[id]), done = [];
  for (const id of ids) { const r = await emTest(id, true); if (!r || !r.ok) { S.emTestBusy = false; render(); toast((r && r.error) || "Couldn't send the test."); return; } done.push(r); }
  S.emTestBusy = false; render();
  if (done.length) toast(`${done.length === 1 ? 'A test is' : 'Both tests are'} in ${done[0].to}. They show exactly what businesses get, with [Test] in the subject.`);
}
// Runs the finder once now instead of waiting for its schedule, to see it work.
const FIND_WHY = {off:'The finder is off. Turn it on first.', key:'The finder needs your Anthropic key in Supabase (ANTHROPIC_API_KEY).', target:"Today's number of new leads is reached. It starts again tomorrow.", budget:"Today's spending limit is reached. It starts again tomorrow.", done:'Every search in your list ran in the last 90 days. Add types of business or cities in its Settings.', error:'The search didn\'t finish. It tries again on the next run.'};
async function emFindNow() {
  if (S.emFindBusy) return;
  S.emFindBusy = true; render();
  try {
    if (!outreachUrl()) throw new Error('Connect your Supabase project first.');
    await emSettle(['outreach/settings']);
    const r = await fetch(outreachUrl() + '?job=find', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{"job":"find"}'});
    if (r.status === 404) throw new Error("The engine isn't set up yet. Open Engine setup on the Email tab.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `The engine answered ${r.status}.`);
    const res = Object.values(j.results || {})[0] || {why:'off'};
    try { if (db) await db.refresh(); } catch (e) {}
    toast(res.error ? `The finder hit a problem: ${res.error}` : res.why === 'ran' ? `Searched ${res.search || String(res.job || '').split('|').slice(1).join(' in ') || 'one type of business in one city'}: ${plural(res.found || 0, 'new lead')}${res.checked ? ` from ${res.checked} ${res.checked === 1 ? 'business' : 'businesses'} checked` : ''}.` : FIND_WHY[res.why] || 'Nothing to do right now.');
  } catch (e) { toast((e && e.message) || "Couldn't run the finder."); }
  S.emFindBusy = false; render();
}

/* the campaign being edited: what is saved plus what you typed */
function emDraftCampaign(id) {
  const c = clone((S.data.campaigns || {})[id] || DEFAULT_CAMPAIGNS[id] || {steps:[], segments:{}});
  const dv = (k, def) => S.drafts[k] !== undefined ? S.drafts[k] : def;
  c.name = dv('ec-name', c.name || ''); c.offer = dv('ec-offer', c.offer || ''); c.price = dv('ec-price', c.price || ''); c.cap = dv('ec-cap', c.cap ?? 30);
  if (c.trigger) c.trigger = {stage:dv('ec-tstage', c.trigger.stage), days:dv('ec-tdays', c.trigger.days)};
  (c.steps || []).forEach((st, n) => {
    if (n === 0) st.subject = dv('ec-s0-subject', st.subject || '');
    else st.wait = dv(`ec-s${n}-wait`, st.wait ?? 3);
    st.body = dv(`ec-s${n}-body`, st.body || '');
  });
  for (const [k, g] of Object.entries(c.segments || {})) { g.question = dv(`ec-g-${k}-question`, g.question || ''); g.features = dv(`ec-g-${k}-features`, g.features || ''); }
  return c;
}
const emEditable = c => JSON.stringify([c.name || '', c.offer || '', c.price || '', Number(c.cap) || 0, c.trigger ? [c.trigger.stage, Number(c.trigger.days) || 0] : null, (c.steps || []).map(s => [s.subject || '', s.body || '', Number(s.wait) || 0]), Object.entries(c.segments || {}).map(([k, g]) => [k, g.question || '', g.features || ''])]);
function emClean(c) {
  const out = clone(c);
  out.name = String(out.name || '').trim() || 'Campaign';
  out.offer = String(out.offer || '').trim(); out.price = String(out.price || '').trim();
  out.cap = Math.max(1, Math.min(200, Math.round(Number(out.cap)) || 30));
  if (out.trigger) out.trigger = {stage:STAGES.includes(out.trigger.stage) ? out.trigger.stage : 'Not now', days:Math.max(0, Math.min(365, Math.round(Number(out.trigger.days)) || 0))};
  (out.steps || []).forEach((s, n) => {
    if (n === 0) s.subject = String(s.subject || '').replace(/[\r\n]+/g, ' ').trim();
    else s.wait = Math.max(1, Math.min(30, Math.round(Number(s.wait)) || 3));
    s.body = String(s.body || '').replace(/\r/g, '').trim();
  });
  for (const g of Object.values(out.segments || {})) { g.question = String(g.question || '').trim(); g.features = String(g.features || '').trim(); }
  return out;
}
// What would stop a campaign from sending: an empty email, or a {fill-in} nothing fills.
function emCampaignProblem(c) {
  const steps = c.steps || [];
  if (!steps.length) return 'This campaign has no emails.';
  if (!String(steps[0].subject || '').trim()) return 'Add a subject to the first email.';
  for (let n = 0; n < steps.length; n++) {
    if (!String(steps[n].body || '').trim()) return `${emStepName(n, steps.length)} is empty.`;
    for (const k of Object.keys(c.segments || {general:{}})) {
      const mail = composeEmail(emSample(null, k), c, emSettings(), n);
      if (mail && mail.missing.length) return `${emStepName(n, steps.length)}: fill in or take out ${mail.missing.join(', ')}.`;
    }
  }
  return '';
}
function emSample(cid, seg) {
  const real = cid ? emLeads().find(l => l.seq.campaign === cid && (l.segment || segmentOf(l.kind || l.business)) === seg) : null;
  if (real) return {...real, segment:seg};
  const x = EM_SAMPLE[seg] || EM_SAMPLE.general;
  return {name:x[0], kind:x[1], city:x[2], state:x[3], email:'hello@example.com', segment:seg};
}
function emMailHtml(l, c, step, settings) {
  const s = settings || emSettings(), mail = composeEmail(l, c, s, step);
  if (!mail) return '<div class="meta">There is no email at that step.</div>';
  return `<div class="mail">
    <div class="mail-h"><div><span>From</span>${esc(s.fromName)} &lt;${esc(emGmail() || 'logan@logandnewman.com')}&gt;</div><div><span>To</span>${esc(l.email || '')}</div><div><span>Subject</span><b>${esc(mail.subject)}</b></div></div>
    <div class="mail-b">${esc(mail.text)}</div>
    ${mail.missing.length ? `<div class="err">Nothing fills ${esc(mail.missing.join(', '))}. Fix the spelling or take it out.</div>` : ''}
    ${String(s.address || '').trim() ? '' : '<div class="mail-note">Your mailing address goes under your website. Add it in Settings before you start.</div>'}
  </div>`;
}
function emPreviewHtml() {
  const m = S.modal; if (!m || m.type !== 'em-campaign') return '';
  const c = emDraftCampaign(m.id), steps = c.steps || [], n = Math.min(m.n || 0, Math.max(0, steps.length - 1));
  const keys = Object.keys(c.segments || {}), seg = keys.includes(m.seg) ? m.seg : (keys[0] || 'general');
  return emMailHtml(emSample(m.id, seg), c, n);
}

/* ----- the Email tab ----- */
function viewEmail() {
  if (!S.outEng && !emCheckStarted && outreachUrl()) { emCheckStarted = true; setTimeout(() => outreachCheck(true), 0); }
  const s = emSettings(), st = emState(), camps = emCampaigns(), list = emLeads();
  const main = [emHero(s, st, camps, list), emChecklist(s, camps, list), emHotCard(), emContactsCard(list, camps), emRepliesCard()];
  const side = [emFinderCard(s), emResults(list), ...camps.map(c => emCampaignCard(c, list, st, s)), emUpNext(s, st, camps)];
  return `<div class="two"><div class="main">${main.join('')}</div><div class="side">${side.join('')}</div></div>`;
}
function emHero(s, st, camps, list) {
  const now = new Date(), today = localClock(s.tz, now).date, eng = S.outEng || {}, mode = sendingState(s, today);
  const cap = dailyCap(s, today), sent = st.today && st.today.date === today ? (st.today.sent || 0) : 0;
  const live = camps.filter(liveCampaign), engineOk = emEngineOk(), gmail = emGmail();
  const waiting = list.filter(l => ['queued','active'].includes(l.seq.status) && !l.dnc && live.some(c => c.id === l.seq.campaign));
  const clocks = [...new Set(waiting.map(l => tzFor(l, s)))].map(z => localClock(z, now));
  const open = clocks.some(c => s.days.includes(c.dow) && c.minutes >= toMin(s.start) && c.minutes < toMin(s.end));
  const later = clocks.some(c => s.days.includes(c.dow) && c.minutes < toMin(s.start));
  const back = nextSendDay(addDays(todayISO(), 1), s.days);
  const outdated = (eng.fn === 'ok' && (eng.version || 1) < OUTREACH_V) || (st.version && st.version < OUTREACH_V);
  let dot = 'warn', title, sub;
  if (mode === 'later') {
    const todo = [!engineOk || outdated ? 'update the engine (Engine setup)' : '', !String(s.address || '').trim() ? 'add your mailing address' : '', !live.length ? 'approve a campaign' : ''].filter(Boolean);
    dot = todo.length ? 'warn' : 'live'; title = `Starts ${dayWord(s.startOn)}`;
    sub = todo.length ? `Before then: ${todo.join(', ')}.` : `The first emails go out at ${fmtTap(s.start)} in each business's own time. ${plural(waiting.length, 'lead')} in line${s.finder.enabled ? ', and the finder keeps adding more' : ''}.`;
  }
  else if (!engineOk) { dot = ''; title = 'Set up the engine'; sub = 'A one-time setup of about 15 minutes. After that, emails go out, replies get read and new leads get found on their own, even with this app closed.'; }
  else if (mode === 'paused') { title = 'Paused'; sub = 'Nothing goes out until you tap Start sending.'; }
  else if (!String(s.address || '').trim()) { title = 'Waiting for your address'; sub = 'Add your mailing address in Settings. Every email needs it.'; }
  else if (!live.length) { title = 'No campaign is on'; sub = 'Read and approve a campaign to turn it on.'; }
  else if (!waiting.length) { title = 'Everyone has been emailed'; sub = s.finder.enabled ? 'The finder adds new leads through the day.' : 'Add leads or turn on the finder to keep it going. Replies still get read.'; }
  else if (sent >= cap) { dot = 'live'; title = 'Done for today'; sub = `${sent} sent, today's limit. Back ${dayWord(back)} at ${fmtTap(s.start)} their time.`; }
  else if (open) { dot = 'live on'; title = 'Sending'; sub = `One email at a time, at least ${s.gap} minutes apart, until ${fmtTap(s.end)} their time.`; }
  else if (later) { dot = 'live'; title = 'Starting soon'; sub = `The first email goes out at ${fmtTap(s.start)} their time.`; }
  else { dot = 'live'; title = sent ? 'Done for today' : 'Off right now'; sub = `Back ${dayWord(back)} at ${fmtTap(s.start)} their time.`; }
  const ranMin = st.lastRun ? (Date.now() - Date.parse(st.lastRun)) / 60000 : null;
  const alerts = [
    st.lastError ? `<div class="err"><b>The engine hit a problem${st.lastRun ? ' ' + esc(emAgo(st.lastRun)) : ''}:</b> ${esc(st.lastError)}</div>` : '',
    outdated ? '<div class="warnbox">Supabase is running an older copy of the engine. Open Engine setup, copy the new code and deploy it.</div>' : '',
    mode === 'on' && engineOk && ranMin !== null && ranMin > 25 ? `<div class="warnbox">The engine last ran ${esc(emAgo(st.lastRun))}. Check that its schedule is on (Engine setup, step 6).</div>` : '',
  ].join('');
  const facts = [gmail ? `From <b>${esc(gmail)}</b>` : '', st.lastRun ? `Checked ${esc(emAgo(st.lastRun))}` : '', engineOk ? (s.startedOn && cap < (Number(s.capMax) || 50) ? `Warming up: ${cap} a day now, up to ${s.capMax}` : `${cap} a day`) : ''].filter(Boolean);
  return `<section class="card emhero ord-1">
    <div class="emhero-top"><div class="min0"><div class="eyebrow">Email command center</div><div class="emst"><i class="emdot ${dot}" aria-hidden="true"></i><b>${esc(title)}</b></div><div class="meta">${esc(sub)}</div></div>
      ${mode !== 'paused' ? '<button class="btn" data-act="em-pause">Pause</button>' : '<button class="btn primary" data-act="em-start">Start sending</button>'}</div>
    ${engineOk ? `<div class="progress"><div class="bar ${sent >= cap ? 'good' : ''}"><i style="width:${Math.min(100, Math.round(sent / Math.max(1, cap) * 100))}%"></i></div><span class="meta mono">${sent}/${cap} today</span></div>` : ''}
    ${facts.length ? `<div class="meta">${facts.join(' · ')}</div>` : ''}
    ${alerts}
    <div class="btnrow">${mode === 'later' ? '<button class="btn sm" data-act="em-launch">Change the start day</button>' : ''}<button class="btn sm" data-act="em-import">Add leads</button><button class="btn sm" data-act="em-settings">Settings</button><button class="btn sm ghost" data-act="em-setup">Engine setup</button></div>
  </section>`;
}
function emChecklist(s, camps, list) {
  const items = [
    emEngineOk() && emOutdated() ? [false, 'Update the engine', 'Supabase runs an older copy. Copy the new code, deploy it and run the SQL again (Engine setup, steps 5 and 6).', 'em-setup', 'Update']
      : [emEngineOk(), 'Connect your Gmail', 'The engine runs in your Supabase project and sends from your own inbox.', 'em-setup', 'Set it up'],
    [!!String(s.address || '').trim(), 'Add a mailing address', 'The law requires one at the bottom of every sales email. A PO box or virtual mailbox works.', 'em-settings', 'Add it'],
    [list.length > 0 || s.finder.enabled, 'Add leads', 'Turn on the finder, or add outreach-list.csv or any spreadsheet with emails.', 'em-finder', 'Set up the finder'],
    [camps.some(c => c.reviewed), 'Read and approve the emails', 'Nothing goes out until you approve the wording.', 'em-review', 'Read them'],
    [sendingState(s, localClock(s.tz).date) !== 'paused' && camps.some(liveCampaign), 'Pick your start day', `${s.capStart} a day to start, a few more each day, ${emDays(s.days)}.`, 'em-launch', 'Start'],
  ];
  const done = items.filter(x => x[0]).length, first = items.findIndex(x => !x[0]);
  if (done === items.length) return '';
  return `<section class="card ord-2"><div class="card-h"><h2>Get it running</h2><span class="meta">${done} of ${items.length} done</span></div>
    ${items.map(([ok, title, body, act, label], n) => `<div class="step ${ok ? 'ok' : ''}"><div class="num">${ok ? '✓' : n + 1}</div><div class="min0 stepline"><div class="min0"><b>${title}</b><div class="meta">${esc(body)}</div></div>${ok ? '' : `<button class="btn sm ${n === first ? 'primary' : ''}" data-act="${act}">${label}</button>`}</div></div>`).join('')}
  </section>`;
}
function emHotCard() {
  const hot = emHot(), any = Object.keys(S.data.replies || {}).length;
  return `<section class="card hotcard ord-3"><div class="card-h"><h2>Hot replies</h2><span class="meta">${hot.length ? `${hot.length} to answer` : 'All caught up'}</span></div>
    ${hot.length ? hot.map(emHotRow).join('') : `<div class="meta">${any ? 'Every hot reply is handled. New ones show up here, move to Talking in your pipeline, get starred in Gmail and ping your phone.' : 'When someone says yes, asks a question or points you to the right person, it shows up here, moves to Talking in your pipeline, gets starred in Gmail and pings your phone.'}</div>`}
  </section>`;
}
function emHotRow(r) {
  const l = (S.data.leads || {})[r.lead] || {}, tel = String(l.phone || '').replace(/[^\d+]/g, '');
  return `<article class="hot">
    <div class="hot-h"><button class="linkish" data-act="lead-open" data-id="${esc(r.lead)}">${esc(r.business || l.name || r.email || 'Someone')}</button>${emLabelPill(r.label)}<span class="meta">${esc(emAgo(r.at))}${r.forwarded ? ' · forwarded' : ''}</span></div>
    ${r.summary ? `<div class="sum">${esc(r.summary)}</div>` : ''}
    <div class="quote">${esc(r.text || r.snippet || '')}</div>
    ${r.next ? `<div class="meta"><b>Next:</b> ${esc(r.next)}</div>` : ''}
    <div class="btnrow">${r.threadId ? `<a class="btn sm primary" href="${esc(gmailThread(r.threadId))}" target="_blank" rel="noopener">Reply in Gmail</a>` : ''}${tel ? `<a class="btn sm" href="tel:${esc(tel)}">Call</a>` : ''}<button class="btn sm" data-act="lead-open" data-id="${esc(r.lead)}">Open the lead</button><button class="btn sm ghost" data-act="em-done" data-id="${esc(r.id)}">Done</button></div>
  </article>`;
}
function emRow(l, showCamp) {
  const c = (S.data.campaigns || {})[l.seq.campaign] || {};
  return `<button class="erow" data-act="lead-open" data-id="${esc(l.id)}"><div class="min0"><b>${esc(l.name || l.email)}</b><div class="meta">${esc([showCamp ? c.name : '', l.email, leadWhere(l)].filter(Boolean).join(' · '))}</div></div><div class="erow-r">${emSeqPill(l)}<span class="meta">${esc(emProgress(l))}</span></div></button>`;
}
function emContactsCard(list, camps) {
  const q = S.emSearch.trim().toLowerCase(), cf = camps.some(c => c.id === S.emCamp) ? S.emCamp : 'all';
  const inCamp = cf === 'all' ? list : list.filter(l => l.seq.campaign === cf);
  const counts = Object.fromEntries(EM_FILTERS.map(([k, , f]) => [k, inCamp.filter(f).length]));
  const f = EM_FILTERS.some(x => x[0] === S.emFilter) && (counts[S.emFilter] || S.emFilter === 'all') ? S.emFilter : 'all';
  let shown = inCamp.filter(EM_FILTERS.find(x => x[0] === f)[2]);
  if (q) shown = shown.filter(l => [l.name, l.email, l.city, l.state, l.kind, l.business, l.firstName].join(' ').toLowerCase().includes(q));
  shown.sort((a, b) => (EM_SEQ_RANK[a.seq.status] ?? 9) - (EM_SEQ_RANK[b.seq.status] ?? 9) || String((b.reply || {}).at || '').localeCompare(String((a.reply || {}).at || '')) || String(a.seq.nextOn || '').localeCompare(String(b.seq.nextOn || '')) || (a.createdAt || 0) - (b.createdAt || 0) || String(a.name || '').localeCompare(String(b.name || '')));
  const lim = S.emLimit || 40, n = shown.length;
  const bulk = f === 'hold' && n ? `<button class="btn sm primary" data-act="em-bulk" data-op="queue">Queue all ${n}</button>`
    : f === 'queued' && n ? `<button class="btn sm" data-act="em-bulk" data-op="pause">Pause all ${n}</button>`
    : f === 'paused' && n ? `<button class="btn sm" data-act="em-bulk" data-op="resume">Resume all ${n}</button>` : '';
  const used = camps.filter(c => list.some(l => l.seq.campaign === c.id));
  return `<section class="card ord-8" id="em-contacts"><div class="card-h"><h2>In your campaigns</h2><div class="btnrow"><span class="meta">${list.length}</span><button class="btn sm" data-act="em-import">Add</button></div></div>
    ${list.length ? `
    ${used.length > 1 ? `<div class="seg scope emcamps">${[['all','All'], ...used.map(c => [c.id, c.name])].map(([k, l]) => `<button type="button" class="${cf === k ? 'on' : ''}" data-act="em-camp-filter" data-id="${esc(k)}">${esc(l)}</button>`).join('')}</div>` : ''}
    <input class="in" id="em-search" placeholder="Search businesses, emails, cities" value="${esc(S.emSearch)}" autocomplete="off">
    <div class="chips">${EM_FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''} ${k === 'look' ? 'warnchip' : ''}" data-act="em-filter" data-f="${k}">${l} ${counts[k]}</button>`).join('')}</div>
    ${f === 'hold' ? '<div class="meta">These addresses were harder to confirm. Open one to see where it was found, then queue it, or queue them all.</div>' : ''}
    ${f === 'look' ? '<div class="meta">Gmail refused these, or a send started and never finished. Open each one to sort it out.</div>' : ''}
    ${f === 'stopped' ? '<div class="meta">Their emails stopped when they moved past Contacted in your pipeline.</div>' : ''}
    ${bulk ? `<div class="btnrow">${bulk}</div>` : ''}
    <div class="elist">${shown.slice(0, lim).map(l => emRow(l, cf === 'all' && used.length > 1)).join('') || `<div class="meta" style="padding:10px 0">${q ? 'No leads match that search.' : 'Nobody here.'}</div>`}</div>
    ${n > lim ? `<button class="btn sm ghost" data-act="em-more">Show ${Math.min(60, n - lim)} more of ${n - lim}</button>` : ''}`
    : '<div class="meta">Nobody is in a campaign yet. Turn on the finder, or add outreach-list.csv or any spreadsheet with business names and emails.</div><div class="btnrow" style="margin-top:8px"><button class="btn primary" data-act="em-import">Add leads</button><button class="btn" data-act="em-finder">Set up the finder</button></div>'}
  </section>`;
}
function emRepliesCard() {
  const all = emReplies();
  if (!all.length) return '';
  const f = EM_REPLY_GROUPS.some(g => g[0] === S.emReplies) ? S.emReplies : 'all', grp = EM_REPLY_GROUPS.find(g => g[0] === f);
  const list = grp[2] ? all.filter(r => grp[2].includes(r.label)) : all, lim = S.emRLimit || 25;
  return `<section class="card ord-9"><div class="card-h"><h2>Every reply</h2><span class="meta">${emReplyWord(all.length)}</span></div>
    <div class="chips">${EM_REPLY_GROUPS.map(([k, l, labels]) => { const n = labels ? all.filter(r => labels.includes(r.label)).length : all.length; return n || k === 'all' ? `<button class="chip ${f === k ? 'on' : ''}" data-act="em-rfilter" data-f="${k}">${l} ${n}</button>` : ''; }).join('')}</div>
    <div class="elist">${list.slice(0, lim).map(r => `<button class="erow" data-act="lead-open" data-id="${esc(r.lead)}"><div class="min0"><b>${esc(r.business || r.email || r.from || '')}</b><div class="meta clamp1">${esc(r.summary || r.snippet || r.text || '')}</div></div><div class="erow-r">${emLabelPill(r.label)}<span class="meta">${esc(emAgo(r.at))}</span></div></button>`).join('') || '<div class="meta" style="padding:10px 0">None of these.</div>'}</div>
    ${list.length > lim ? `<button class="btn sm ghost" data-act="em-rmore">Show more</button>` : ''}
  </section>`;
}
function emResults(list) {
  const k = campaignStats(Object.fromEntries(list.map(l => [l.id, l])));
  const t = todayISO(), days = [...Array(14)].map((_, i) => addDays(t, i - 13)), sentBy = {}, repBy = {};
  list.forEach(l => (l.sentLog || []).forEach(x => { const d = x && x.at ? iso(new Date(x.at)) : ''; if (d) sentBy[d] = (sentBy[d] || 0) + 1; }));
  emReplies().forEach(r => { if (r.label === 'auto' || r.label === 'bounce') return; const d = iso(new Date(r.at)); repBy[d] = (repBy[d] || 0) + 1; });
  const max = Math.max(1, ...days.map(d => sentBy[d] || 0)), any = days.some(d => sentBy[d] || repBy[d]);
  return `<section class="card ord-5"><div class="card-h"><h2>Results</h2><span class="meta">All campaigns</span></div>
    <div class="auto">
      <div><b>${k.emailed}</b><span>businesses emailed</span></div>
      <div><b>${k.sent}</b><span>emails sent</span></div>
      <div><b>${k.answered}</b><span>replied</span></div>
      <div class="${k.hot ? 'hotnum' : ''}"><b>${k.hot}</b><span>hot</span></div>
      <div><b>${k.rate}%</b><span>reply rate</span></div>
      <div><b>${(k.by.queued || 0) + (k.by.active || 0)}</b><span>still in line</span></div>
    </div>
    ${any ? `<div class="embars" role="img" aria-label="Emails sent each day for the last two weeks">${days.map(d => `<div class="${d === t ? 'today' : ''}" title="${esc(fmtDay(d))}: ${sentBy[d] || 0} sent, ${emReplyWord(repBy[d] || 0)}"><i style="height:${Math.round((sentBy[d] || 0) / max * 100)}%"></i>${repBy[d] ? `<em>${repBy[d]}</em>` : ''}</div>`).join('')}</div>
    <div class="meta">Emails sent each day, the last two weeks. Green numbers are replies.</div>` : ''}
  </section>`;
}
const finderSearches = f => Object.values(f.targets || {}).filter(t => t && t.on).reduce((a, t) => a + String(t.niches || '').split(/[,;\n]+/).filter(x => x.trim()).length * String(t.areas || '').split(/[;\n]+/).filter(x => x.trim()).length, 0);
function emFinderCard(s) {
  const f = s.finder, st = outDoc('finder') || {}, today = localClock(s.tz).date;
  const td = st.today && st.today.date === today ? st.today : {found:0, spent:0, runs:0, checked:0, noEmail:0};
  const mo = st.month && st.month.month === today.slice(0, 7) ? st.month : {found:0, spent:0};
  const per = Number(f.perDay) || 50, cap = Number(f.budget) || 3;
  const state = !f.enabled ? ['Off', ''] : td.found >= per ? ['Done for today', 'good'] : td.spent >= cap ? ['Spending limit reached', 'warn'] : ['Searching', 'good'];
  const ran = st.lastRun ? (Date.now() - Date.parse(st.lastRun)) / 60000 : null;
  const camps = Object.entries(f.targets || {}).filter(([, t]) => t && t.on).map(([cid]) => ((S.data.campaigns || {})[cid] || {}).name || cid);
  const costEach = mo.found ? mo.spent / mo.found : td.found ? td.spent / td.found : 0;
  return `<section class="card finder ord-4"><div class="card-h"><h2>Finding new leads</h2><span class="pill ${state[1]}">${state[0]}</span></div>
    <div class="meta" style="color:var(--ink-2)">${f.enabled ? `Every 15 minutes Claude searches the web for local businesses for ${esc(camps.join(' and ') || 'your campaigns')} and reads each website for an email: up to ${per} new leads a day, ${dollars(cap)} a day at most.` : 'Turn it on and Claude searches the web every 15 minutes for local businesses, reads each website for an email, and adds them to your pipeline and campaign, up to the number you set each day.'}</div>
    ${f.enabled || td.found || mo.found ? `<div class="progress"><div class="bar ${td.found >= per ? 'good' : ''}"><i style="width:${Math.min(100, Math.round(td.found / Math.max(1, per) * 100))}%"></i></div><span class="meta mono">${td.found}/${per} today</span></div>
    <div class="emc-n"><span><b>${dollars(td.spent)}</b> today</span><span><b>${mo.found}</b> this month</span><span><b>${dollars(mo.spent)}</b> this month</span>${costEach ? `<span><b>${Math.round(costEach * 100)}¢</b> a lead</span>` : ''}</div>` : ''}
    ${st.lastError ? `<div class="err">${esc(st.lastError)}</div>` : ''}
    ${f.enabled && S.outEng && S.outEng.fn === 'ok' && !S.outEng.hasKey ? '<div class="warnbox">The finder needs your Anthropic key in Supabase (ANTHROPIC_API_KEY). Engine setup, step 4.</div>' : ''}
    ${f.enabled && ran !== null && ran > 40 ? `<div class="warnbox">The finder last ran ${esc(emAgo(st.lastRun))}. Check its schedule (Engine setup, step 6).</div>` : f.enabled && ran === null ? '<div class="meta">Waiting for its first run. It needs the engine and its 15-minute schedule (Engine setup, step 6).</div>' : ''}
    ${(st.recent || []).length ? `<details><summary>Last searches</summary><div class="elist">${st.recent.slice(0, 6).map(x => `<div class="erow static"><div class="min0"><b>${esc(x.search)}</b><div class="meta clamp1">${x.found ? esc((x.names || []).join(', ')) : 'No new businesses with an email'}</div></div><div class="erow-r"><span class="pill ${x.found ? 'good' : ''}">${x.found} new</span><span class="meta">${esc(emAgo(x.at))}</span></div></div>`).join('')}</div></details>` : ''}
    <div class="btnrow"><button class="btn sm ${f.enabled ? '' : 'primary'}" data-act="em-finder-toggle">${f.enabled ? 'Pause' : 'Turn on'}</button>${f.enabled && emEngineOk() ? `<button class="btn sm" data-act="em-find-now" ${S.emFindBusy ? 'disabled' : ''}>${S.emFindBusy ? 'Searching… up to 2 min' : 'Search now'}</button>` : ''}<button class="btn sm" data-act="em-finder">Settings</button><span class="meta">${finderSearches(f)} searches in your list</span></div>
  </section>`;
}
function emCampaignCard(c, list, st, s) {
  const k = campaignStats(Object.fromEntries(list.map(l => [l.id, l])), c.id);
  const today = st.today && st.today.date === localClock(s.tz).date ? ((st.today.by || {})[c.id] || 0) : 0;
  const pct = k.total ? Math.round(k.emailed / k.total * 100) : 0;
  const state = liveCampaign(c) ? ['On', 'good'] : c.reviewed ? ['Paused', 'warn'] : ['Needs your OK', 'warn'];
  const trig = c.trigger ? `Starts by itself for leads in <b>${esc(c.trigger.stage)}</b> after ${plural(Number(c.trigger.days) || 0, 'day')}.` : '';
  return `<section class="card emc ord-6"><div class="card-h"><h2>${esc(c.name)}</h2><span class="pill ${state[1]}">${state[0]}</span></div>
    ${c.offer ? `<div class="meta emc-offer">${esc(c.offer)}</div>` : ''}
    ${trig ? `<div class="meta trig">${trig}</div>` : ''}
    <div class="emc-n"><span><b>${k.total}</b> leads</span><span><b>${k.emailed}</b> emailed</span><span><b>${k.answered}</b> replied</span><span class="${k.hot ? 'hotnum' : ''}"><b>${k.hot}</b> hot</span></div>
    ${k.total ? `<div class="progress"><div class="bar"><i style="width:${pct}%"></i></div><span class="meta mono">${today}/${c.cap || 30} today</span></div>` : ''}
    <div class="btnrow">
      <button class="btn sm ${c.reviewed ? '' : 'primary'}" data-act="em-campaign" data-id="${esc(c.id)}">${c.reviewed ? 'Edit the emails' : 'Read and approve'}</button>
      ${c.reviewed ? `<button class="btn sm" data-act="em-camp-toggle" data-id="${esc(c.id)}">${liveCampaign(c) ? 'Pause' : 'Turn on'}</button>` : ''}
      ${c.trigger ? '' : `<button class="btn sm ghost" data-act="em-import" data-campaign="${esc(c.id)}">Add leads</button>`}
      ${k.total ? `<button class="btn sm ghost" data-act="em-camp-filter" data-id="${esc(c.id)}" data-go="1">Leads</button>` : ''}
    </div></section>`;
}
function emUpNext(s, st, camps) {
  const list = upNext(S.data.leads, S.data.campaigns, s, new Date(), emSuppressed());
  const ready = list.filter(x => x.ready).length;
  const why = !s.enabled ? 'Sending is paused, so this is what goes out once you start.' : EM_WHY[st.lastWhy] || '';
  return `<section class="card ord-7"><div class="card-h"><h2>Up next</h2><span class="meta">${ready} ready</span></div>
    ${why && list.length ? `<div class="meta" style="margin-bottom:4px">${esc(why)}</div>` : ''}
    ${list.length ? `<div class="elist">${list.slice(0, 6).map(x => { const c = (S.data.campaigns || {})[x.campaign] || {}; return `<button class="erow" data-act="lead-open" data-id="${esc(x.id)}"><div class="min0"><b>${esc(x.l.name || x.l.email)}</b><div class="meta">${esc(emStepName(x.step, (c.steps || []).length))} · ${esc(c.name || '')}</div></div><span class="meta">${x.ready ? (x.step ? 'due now' : 'in line') : esc(fmtDay(x.due))}</span></button>`; }).join('')}</div>${list.length > 6 ? `<div class="meta" style="margin-top:6px">and ${list.length - 6} more</div>` : ''}`
      : `<div class="meta">${camps.some(liveCampaign) ? 'Nobody is waiting. Add leads or turn on the finder to keep it going.' : 'Approve a campaign and its leads line up here.'}</div>`}
  </section>`;
}

/* ----- the Pipeline tab ----- */
const PIPE_SOURCES = [['all','All leads'], ['calls','On the call list'], ['email','In an email campaign'], ['finder','Found by the finder'], ['import','Imported']];
const PIPE_SORTS = [['heat','Hottest first'], ['next','Next step date'], ['recent','Latest activity'], ['new','Newest'], ['name','Name']];
const PIPE_HEATS = [['all','All'], ['hot','Hot'], ['warm','Warm'], ['cold','Cold'], ['client','Clients']];
function pipeFiltered() {
  const q = S.search.trim().toLowerCase(), src = S.pipeSource || 'all', heat = S.pipeHeat || 'all';
  return allLeads().filter(l => {
    if (q && ![l.name, l.business, l.contact, l.phone, l.email, l.city, l.kind].join(' ').toLowerCase().includes(q)) return false;
    if (src === 'calls' && l.callList === false) return false;
    if (src === 'email' && !(l.seq && l.seq.campaign)) return false;
    if (src === 'finder' && l.source !== 'Finder') return false;
    if (src === 'import' && l.source !== 'Import') return false;
    if (heat !== 'all' && leadHeat(l).cls !== heat) return false;
    return true;
  });
}
const lastAt = l => Math.max(l.reply && l.reply.at ? Date.parse(l.reply.at) : 0, l.seq && l.seq.lastAt ? Date.parse(l.seq.lastAt) : 0, l.lastTouch ? Date.parse(l.lastTouch + 'T12:00:00') : 0, Number(l.stageAt) || 0) || 0;
// Ties fall back to the name, so cards keep their place from one render to the next.
function pipeSorted(list, sort) {
  const score = new Map(list.map(l => [l.id, leadHeat(l).score])), last = new Map(list.map(l => [l.id, lastAt(l)]));
  const name = (a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')) || (a.id < b.id ? -1 : 1);
  const by = {
    heat: (a, b) => score.get(b.id) - score.get(a.id) || last.get(b.id) - last.get(a.id) || name(a, b),
    next: (a, b) => String(a.nextDate || '9999').localeCompare(String(b.nextDate || '9999')) || score.get(b.id) - score.get(a.id) || name(a, b),
    recent: (a, b) => last.get(b.id) - last.get(a.id) || name(a, b),
    new: (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0) || name(a, b),
    name,
  };
  return list.slice().sort(by[sort] || by.heat);
}
function setPipeView(v) {
  if (!['board','calls','all'].includes(v)) return;
  S.pipeView = v; try { localStorage.setItem('lcc-pipe-view', v); } catch(e) {}
}
function viewPipeline() {
  const v = ['board','calls','all'].includes(S.pipeView) ? S.pipeView : 'board', t = todayISO();
  const due = allLoaded() && !isRestDay(t) ? leadsDue(t).length : 0;
  const tabs = `<div class="seg scope pipetabs">${[['board','Board'], ['calls',`Calls${due ? ` <span class="cnt">${due}</span>` : ''}`], ['all','All leads']].map(([k, l]) => `<button type="button" class="${v === k ? 'on' : ''}" data-act="pipe-view" data-v="${k}">${l}</button>`).join('')}</div>`;
  const bar = `<div class="pipebar"><input class="in" id="lead-search" type="search" placeholder="${v === 'calls' ? 'Search all leads' : 'Search leads'}" value="${esc(S.search)}" autocomplete="off">${v === 'calls' ? '<button class="btn primary" data-act="call-start">Start calling</button>' : ''}<button class="btn" data-act="lead-add" aria-label="Add a lead">+ Lead</button></div>`;
  return tabs + (v === 'calls' ? bar + viewCalls() : v === 'board' ? pipeSummary() + bar + pipeFilters(v) + pipeBoard() : bar + pipeFilters(v) + pipeAll());
}
function pipeSummary() {
  const list = allLeads(), month = todayISO().slice(0, 7);
  const n = s => list.filter(l => (l.stage || 'New lead') === s).length;
  const heat = {hot:0, warm:0, cold:0}; list.forEach(l => { const h = leadHeat(l).cls; if (h in heat) heat[h]++; });
  const open = list.filter(l => ['Talking','Demo booked','Proposal sent'].includes(l.stage)).reduce((a, l) => a + (num(l.monthly) || 0), 0);
  const wonMonth = list.filter(l => l.stage === 'Won' && l.stageAt && iso(new Date(Number(l.stageAt))).slice(0, 7) === month);
  return `<section class="pipesum">
    <div class="ps hot"><b>${heat.hot}</b><span>hot</span></div><div class="ps"><b>${heat.warm}</b><span>warm</span></div><div class="ps"><b>${heat.cold}</b><span>cold</span></div>
    <div class="ps"><b>${n('Talking')}</b><span>talking</span></div><div class="ps"><b>${n('Demo booked')}</b><span>demos</span></div><div class="ps"><b>${n('Proposal sent')}</b><span>proposals</span></div>
    <div class="ps good"><b>${wonMonth.length}</b><span>won this month</span></div>${open ? `<div class="ps"><b>${money(open)}</b><span>a month in play</span></div>` : ''}
  </section>`;
}
function pipeFilters(v) {
  return `<div class="pipefilters ${v === 'all' ? 'all' : ''}"><div class="chips">${PIPE_HEATS.map(([k, l]) => `<button class="chip ${(S.pipeHeat || 'all') === k ? 'on' : ''}" data-act="pipe-heat" data-h="${k}">${l}</button>`).join('')}</div>
    <div class="pipesel"><select class="in sel" id="pipe-source" aria-label="Which leads">${PIPE_SOURCES.map(([k, l]) => `<option value="${k}" ${(S.pipeSource || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${v === 'all' ? `<select class="in sel" id="pipe-stage" aria-label="Stage"><option value="all">Every stage</option>${STAGES.map(s => `<option ${S.pipeStage === s ? 'selected' : ''}>${s}</option>`).join('')}</select><select class="in sel" id="pipe-sort" aria-label="Sort">${PIPE_SORTS.map(([k, l]) => `<option value="${k}" ${(S.pipeSort || 'heat') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div></div>`;
}
function leadCardP(l) {
  const drag = !coarsePointer();
  const icons = [l.phone ? '<span title="Has a phone number">☎</span>' : '', l.email ? `<span title="${l.dnc ? 'Do not email' : 'Has an email'}" class="${l.dnc || l.emailBad ? 'off' : ''}">✉</span>` : ''].join('');
  const seqLine = l.seq && LIVE_SEQ.includes(l.seq.status) ? `<div class="lc-seq">${esc(((S.data.campaigns || {})[l.seq.campaign] || {}).name || 'Email')} · ${esc(emProgress(l))}</div>` : '';
  const flash = S.flash && S.flash.key === 'lead:' + l.id && Date.now() - S.flash.at < 1600 ? 'flash' : '';
  return `<article class="lcard ${flash}" ${drag ? 'draggable="true"' : ''} data-lead="${esc(l.id)}" data-act="lead-open" data-id="${esc(l.id)}" role="button" tabindex="0">
    <div class="lc-h"><b>${esc(l.name || l.email)}</b>${heatChip(l)}</div>
    <div class="meta clamp1">${esc([leadKind(l), leadWhere(l)].filter(Boolean).join(' · '))}</div>
    ${l.nextStep && l.nextDate ? `<div class="lc-next ${l.nextDate < todayISO() ? 'late' : ''}">${esc(l.nextStep)} · ${esc(l.nextDate <= todayISO() ? (l.nextDate < todayISO() ? 'late' : 'today') : fmtShort(l.nextDate))}</div>` : ''}
    ${seqLine}
    <div class="lc-f"><span class="meta">${esc(leadLast(l))}</span><span class="lc-i">${icons}${num(l.monthly) ? `<b>${money(l.monthly)}/mo</b>` : ''}</span></div>
  </article>`;
}
function pipeBoard() {
  const list = pipeFiltered(), per = 30;
  return `<div class="board" id="board">${STAGES.map(st => {
    const items = pipeSorted(list.filter(l => (l.stage || 'New lead') === st), 'heat');
    const value = items.reduce((a, l) => a + (num(l.monthly) || 0), 0);
    return `<section class="pcol ${st === 'Won' ? 'won' : st === 'Lost' ? 'lost' : ''}" data-stage="${esc(st)}"><header><b>${esc(st)}</b><span class="meta">${items.length}${value ? ` · ${money(value)}/mo` : ''}</span></header>
      <div class="pcards">${items.slice(0, per).map(leadCardP).join('') || '<div class="meta pempty">Nobody here</div>'}${items.length > per ? `<button class="btn sm ghost" data-act="pipe-col" data-s="${esc(st)}">See all ${items.length}</button>` : ''}</div></section>`;
  }).join('')}</div>${coarsePointer() ? '<div class="meta">Tap a lead to move it to another stage.</div>' : '<div class="meta">Drag a lead to another stage, or open it for everything about it.</div>'}`;
}
function pipeAll() {
  let list = pipeFiltered();
  if (S.pipeStage && S.pipeStage !== 'all') list = list.filter(l => (l.stage || 'New lead') === S.pipeStage);
  list = pipeSorted(list, S.pipeSort || 'heat');
  const lim = S.pipeLimit || 50, n = list.length;
  const camps = emCampaigns();
  return `<section class="card"><div class="card-h"><h2>${n} ${n === 1 ? 'lead' : 'leads'}</h2><span class="meta">${S.pipeStage && S.pipeStage !== 'all' ? esc(S.pipeStage) : 'Every stage'}</span></div>
    <div class="elist">${list.slice(0, lim).map(l => `<button class="erow lrow" data-act="lead-open" data-id="${esc(l.id)}"><div class="min0"><div class="lr-h"><b>${esc(l.name || l.email)}</b>${heatChip(l)}</div><div class="meta clamp1">${esc([l.stage || 'New lead', leadKind(l), leadWhere(l), leadSourceName(l)].filter(Boolean).join(' · '))}</div></div><div class="erow-r">${l.nextStep && l.nextDate ? `<span class="meta ${l.nextDate < todayISO() ? 'late' : ''}">${esc(l.nextDate <= todayISO() ? (l.nextDate < todayISO() ? 'late' : 'today') : fmtShort(l.nextDate))}</span>` : ''}<span class="meta">${esc(leadLast(l))}</span></div></button>`).join('') || '<div class="meta" style="padding:10px 0">No leads match.</div>'}</div>
    ${n > lim ? `<button class="btn sm ghost" data-act="pipe-more">Show ${Math.min(100, n - lim)} more of ${n - lim}</button>` : ''}
    ${n ? `<div class="bulk"><b>With these ${n}:</b>
      <div class="btnrow"><select class="in sel" id="pb-stage" aria-label="Move to"><option value="">Move to…</option>${STAGES.map(s => `<option>${s}</option>`).join('')}</select><button class="btn sm" data-act="pipe-bulk" data-op="stage">Move</button></div>
      <div class="btnrow"><select class="in sel" id="pb-camp" aria-label="Email campaign"><option value="">Email campaign…</option>${camps.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><button class="btn sm" data-act="pipe-bulk" data-op="enroll">Start</button></div>
      <div class="btnrow"><button class="btn sm ghost" data-act="pipe-bulk" data-op="calls-on">Put on the call list</button><button class="btn sm ghost" data-act="pipe-bulk" data-op="calls-off">Take off the call list</button></div>
    </div>` : ''}
  </section>`;
}

/* ----- one lead, everything about it ----- */
const OUTCOME_LABEL = {noanswer:'No answer', talked:'Talked', demo:'Demo booked', notint:'Not interested', bad:'Bad number', sent:'Sent', replied:'They replied'};
const BY_LABEL = {you:'by you', reply:'by their reply', email:'when the first email went out', call:'from a call', finder:'Found by the finder', import:'Imported', manual:'Added by you', auto:'automatically'};
function leadCalls(id) {
  const out = [];
  for (const [d, day] of Object.entries(S.data.days || {})) for (const c of (day && day.calls) || []) if (c && c.id === id) out.push({at:Number(c.t) || Date.parse(d + 'T12:00:00'), c});
  return out;
}
function leadTimeline(id) {
  const l = S.data.leads[id] || {}, items = [];
  (l.history || []).forEach(h => items.push({at:Number(h.at) || 0, kind:'stage', h}));
  (l.sentLog || []).forEach(x => items.push({at:Date.parse(x.at) || 0, kind:'sent', x}));
  emReplies().filter(r => r.lead === id).forEach(r => items.push({at:Date.parse(r.at) || 0, kind:'reply', r}));
  leadCalls(id).forEach(x => items.push({at:x.at, kind:'call', c:x.c}));
  return items.sort((a, b) => b.at - a.at);
}
function emReplyItem(r) {
  return `<div class="tli reply"><i></i><div class="min0">
    <div class="btnrow">${emLabelPill(r.label)}<span class="meta">${esc(emWhen(r.at))}${r.by === 'claude' ? ' · sorted by Claude' : r.relabeled ? ' · sorted by you' : ''}</span></div>
    ${r.summary ? `<div class="sum">${esc(r.summary)}</div>` : ''}
    <div class="quote full">${esc(r.text || r.snippet || '')}</div>
    ${r.next ? `<div class="meta"><b>Next:</b> ${esc(r.next)}</div>` : ''}
    <div class="btnrow"><label class="meta relabel">Sorted as <select class="in" id="er-${esc(r.id)}" data-relabel="${esc(r.id)}">${EM_LABEL_ORDER.map(k => `<option value="${k}" ${k === r.label ? 'selected' : ''}>${EM_LABEL[k][0]}</option>`).join('')}</select></label>
      ${HOT.includes(r.label) && !r.handled ? `<button class="btn sm" data-act="em-done" data-id="${esc(r.id)}">Done</button>` : ''}
      ${r.threadId ? `<a class="btn sm ghost" href="${esc(gmailThread(r.threadId))}" target="_blank" rel="noopener">Reply in Gmail</a>` : ''}</div>
  </div></div>`;
}
function leadSheet() {
  const id = S.modal.id, l = (S.data.leads || {})[id];
  if (!l) return closeOnly('Lead');
  const stage = l.stage || 'New lead', q = l.seq || null, c = q ? (S.data.campaigns || {})[q.campaign] || {} : null, steps = (c && c.steps) || [];
  const tel = String(l.phone || '').replace(/[^\d+]/g, ''), h = leadHeat(l), t = todayISO();
  const live = q && LIVE_SEQ.includes(q.status), camps = emCampaigns();
  const sup = l.email ? (S.data.suppress || {})[String(l.email).toLowerCase()] : null;
  const optedOut = (l.reply && l.reply.label === 'unsubscribe') || !!(sup && /asked not to be emailed/i.test(sup.reason || ''));
  const tl = leadTimeline(id);
  const nextMail = live && ['queued','active'].includes(q.status) && Number(q.step) < steps.length && q.sendingStep == null
    ? `<div class="meta">${esc(emStepName(Number(q.step) || 0, steps.length))} ${!liveCampaign(c) ? 'waits until the campaign is on' : !Number(q.step) ? 'goes out when its turn comes' : 'goes out ' + (q.nextOn ? (q.nextOn <= t ? 'today' : esc(fmtDay(q.nextOn))) : 'next')}.</div><details><summary>Show it</summary>${emMailHtml(l, c, Number(q.step) || 0)}</details>` : '';
  const emailBlock = !l.email ? `<div class="meta">No email yet. Add one with Edit and you can put this lead in a campaign.</div>`
    : l.dnc && optedOut ? `<div class="warnbox">They asked not to be emailed, so ${esc(l.email)} never gets another one. The law requires that to stick. Call them instead if they're a fit.</div>`
    : l.dnc ? `<div class="warnbox">On your do-not-contact list, so no email goes to ${esc(l.email)}.<div class="btnrow" style="margin-top:8px"><button class="btn sm" data-act="lead-undnc" data-id="${esc(id)}">Take off the list</button></div></div>`
    : `${q ? `<div class="btnrow">${emSeqPill(l)}<span class="meta">${esc(c.name || q.campaign)} · ${esc(emProgress(l))}</span></div>` : '<div class="meta">Not in a campaign.</div>'}
      ${q && q.status === 'hold' ? `<div class="warnbox">Marked <b>Check first</b>: this address was harder to confirm.${l.foundAt ? ' Open where it was found to make sure it belongs to the business.' : ''}</div>` : ''}
      ${emStuck(l) ? `<div class="warnbox">A send started ${esc(emAgo(q.sendingAt))} and never finished. Look in Gmail's Sent folder for ${esc(emStepName(q.sendingStep, steps.length).toLowerCase())} to ${esc(l.email)}.<div class="btnrow" style="margin-top:8px"><button class="btn sm" data-act="em-stuck" data-id="${esc(id)}" data-went="1">It went out, stop here</button><button class="btn sm" data-act="em-stuck" data-id="${esc(id)}" data-went="0">It didn't, send it again</button></div></div>` : ''}
      ${q && q.status === 'paused' && q.pausedWhy === 'failed' && q.lastError ? `<div class="err">Gmail wouldn't send to this address: ${esc(q.lastError)}</div>` : ''}
      ${l.emailBad ? '<div class="warnbox">The last email to this address bounced. Fix the address with Edit to email them again.</div>' : ''}
      ${nextMail}
      <div class="btnrow">
        ${q && q.status === 'hold' ? `<button class="btn sm primary" data-act="em-status" data-id="${esc(id)}" data-op="queue">Queue it</button>` : ''}
        ${q && ['queued','active'].includes(q.status) ? `<button class="btn sm" data-act="em-status" data-id="${esc(id)}" data-op="pause">Pause emails</button>` : ''}
        ${q && q.status === 'paused' ? `<button class="btn sm primary" data-act="em-status" data-id="${esc(id)}" data-op="resume">Resume emails</button>` : ''}
        ${!live && !l.emailBad ? `<select class="in sel" id="ls-camp" data-draft aria-label="Campaign">${camps.map(x => `<option value="${esc(x.id)}" ${draft('ls-camp', l.segment && ['services','dental'].includes(l.segment) ? 'front-desk' : 'home-screen') === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn sm" data-act="lead-enroll" data-id="${esc(id)}">Start this campaign</button>` : ''}
        ${q && q.threadId ? `<a class="btn sm ghost" href="${esc(gmailThread(q.threadId))}" target="_blank" rel="noopener">Open in Gmail</a>` : ''}
        <button class="btn sm ghost" data-act="em-status" data-id="${esc(id)}" data-op="block">Do not contact</button>
      </div>`;
  const tlHtml = tl.map(x => {
    if (x.kind === 'reply') return emReplyItem(x.r);
    if (x.kind === 'sent') { const cc = (S.data.campaigns || {})[x.x.campaign] || {}; return `<div class="tli"><i></i><div class="min0"><div><b>${esc(cc.name || 'Email')}: ${esc(emStepName(x.x.step, (cc.steps || []).length).toLowerCase())} sent</b> <span class="meta">${esc(emWhen(x.at))}</span></div>${cc.steps && x.x.step < cc.steps.length ? `<details><summary>Show it</summary>${emMailHtml(l, cc, x.x.step)}<div class="meta">As the template reads now.</div></details>` : ''}</div></div>`; }
    if (x.kind === 'call') return `<div class="tli call"><i></i><div class="min0"><div><b>${x.c.kind && x.c.kind !== 'call' ? (x.c.kind === 'dm' ? 'DM' : 'Email') : 'Call'}: ${esc(OUTCOME_LABEL[x.c.outcome] || x.c.outcome || '')}</b> <span class="meta">${esc(emWhen(x.at))}</span></div></div></div>`;
    const hh = x.h; return `<div class="tli stage"><i></i><div class="min0"><div><b>${hh.from ? `Moved to ${esc(hh.to)}` : esc(BY_LABEL[hh.by] || 'Added')}</b> <span class="meta">${hh.from ? `from ${esc(hh.from)} ${esc(BY_LABEL[hh.by] || '')} · ` : ''}${esc(emWhen(x.at))}</span></div></div></div>`;
  }).join('');
  return `<div class="card-h"><div class="min0"><h2 class="lead-title">${esc(l.name || l.email)}</h2><div class="meta">${esc([leadKind(l), leadWhere(l)].filter(Boolean).join(' · '))}</div></div><button class="btn sm ghost" data-act="lead-close">${S.modal.back === 'call' ? 'Back' : 'Close'}</button></div>
    <div class="btnrow">${heatChip(l)}<span class="meta">${h.score} of 100 · ${esc(leadSourceName(l))}${l.type === 'Partner' ? ' · Partner' : ''}</span></div>
    <div class="stagechips" role="group" aria-label="Stage">${STAGES.map(s => `<button type="button" class="${s === stage ? 'on' : ''} ${s === 'Won' ? 'won' : s === 'Lost' ? 'lost' : ''}" data-act="lead-stage" data-id="${esc(id)}" data-s="${esc(s)}" aria-pressed="${s === stage}">${esc(s)}</button>`).join('')}</div>
    <div class="btnrow quickacts">
      ${tel ? `<a class="btn sm primary" href="tel:${esc(tel)}">Call</a><a class="btn sm" href="sms:${esc(tel)}">Text</a>` : ''}
      ${l.email ? `<a class="btn sm" href="${esc(gmailCompose(l.email))}" target="_blank" rel="noopener">Email</a>` : ''}
      ${l.website ? `<a class="btn sm ghost" href="${esc(emHref(l.website))}" target="_blank" rel="noopener">Website</a>` : ''}
      <button class="btn sm ghost" data-act="lead-edit" data-id="${esc(id)}">Edit</button>
    </div>
    <h3>Next step</h3>
    <div class="nextrow"><input class="in" id="ls-step" data-draft value="${esc(draft('ls-step', l.nextStep || ''))}" placeholder="Call back, send the mockup…"><input class="in" type="date" id="ls-date" data-draft value="${esc(draft('ls-date', l.nextDate || ''))}"><button class="btn sm" data-act="lead-next" data-id="${esc(id)}">Save</button></div>
    <div class="btnrow"><button type="button" class="ck ${l.callList !== false ? 'on' : ''}" data-act="lead-calls" data-id="${esc(id)}" aria-pressed="${l.callList !== false}" aria-label="On my call list"></button><span>On my call list${l.callList !== false && l.nextDate ? ` <span class="meta">· shows ${esc(l.nextDate <= t ? 'today' : dayWord(l.nextDate))}</span>` : ''}</span></div>
    <h3>Email</h3>
    ${emailBlock}
    <h3>History</h3>
    <div class="tl">${tlHtml || '<div class="meta">Nothing yet.</div>'}</div>
    <h3>Notes</h3>
    ${l.notes ? `<p class="note">${esc(l.notes)}</p>` : ''}
    <div class="noterow"><input class="in" id="ls-note" data-draft value="${esc(draft('ls-note'))}" placeholder="Add a note"><button class="btn sm" data-act="lead-note" data-id="${esc(id)}">Add</button></div>
    <h3>Details</h3>
    <div class="kvlist">
      ${l.contact || l.firstName ? `<div><span>Contact</span>${esc(l.contact || l.firstName)}</div>` : ''}
      ${l.email ? `<div><span>Email</span><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ''}
      ${l.phone ? `<div><span>Phone</span><a href="tel:${esc(tel)}">${esc(l.phone)}</a></div>` : ''}
      ${l.website ? `<div><span>Website</span><a href="${esc(emHref(l.website))}" target="_blank" rel="noopener">${esc(emShortUrl(l.website))}</a></div>` : ''}
      ${l.foundAt ? `<div><span>Email found on</span><a href="${esc(emHref(l.foundAt))}" target="_blank" rel="noopener">${esc(emShortUrl(l.foundAt).slice(0, 60))}</a></div>` : ''}
      ${num(l.deal) || num(l.monthly) ? `<div><span>Deal</span>${num(l.deal) ? money(l.deal) : ''}${num(l.monthly) ? ` · ${money(l.monthly)}/mo` : ''}</div>` : ''}
      ${l.region ? `<div><span>Call block</span>${esc(regionName(l.region))}</div>` : ''}
    </div>`;
}

/* ----- the finder's settings ----- */
function emFinderSheet() {
  const f = emSettings().finder, v = (k, def) => draft('ef-' + k, def ?? '');
  const camps = Object.keys(f.targets || {}).filter(cid => (S.data.campaigns || {})[cid] || DEFAULT_CAMPAIGNS[cid]);
  return `<div class="card-h"><h2>Finding new leads</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
  <p class="meta" style="margin:0;color:var(--ink-2)">Every 15 minutes the finder takes the next search from your list (one type of business in one city), asks Claude to find local businesses on the web, reads each business's own website for a contact email, and adds the ones it finds to your pipeline and that campaign. It never adds a business twice, skips your do-not-contact list, and each search runs at most once every 90 days. It stops for the day at your number or your spending limit.</p>
  <form class="stack" data-form="em-finder" novalidate>
    <div class="grid3"><div class="fld"><label for="ef-perDay">New leads a day</label><input class="in" type="number" min="1" max="500" inputmode="numeric" id="ef-perDay" data-draft value="${esc(v('perDay', f.perDay))}"></div>
      <div class="fld"><label for="ef-budget">Spend at most ($ a day)</label><input class="in" type="number" min="0.5" max="100" step="0.5" inputmode="decimal" id="ef-budget" data-draft value="${esc(v('budget', f.budget))}"></div>
      <div class="fld"><label for="ef-model">Model</label><select class="in" id="ef-model" data-draft>${EM_MODELS.map(([k, l]) => `<option value="${k}" ${v('model', f.model) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <span class="meta">Each search costs about 10 to 25 cents with Opus and usually finds a handful of businesses with an email. The finder card shows what it really spends, today and this month. Your Anthropic account is billed.</span>
    ${toggleRow('ef-review', S.drafts['ef-review'] !== undefined ? !!S.drafts['ef-review'] : !!f.review, 'Let me check each new lead before it is emailed (they wait under Check first)')}
    ${camps.map(cid => { const t = f.targets[cid], name = ((S.data.campaigns || {})[cid] || DEFAULT_CAMPAIGNS[cid]).name, on = S.drafts[`ef-${cid}-on`] !== undefined ? !!S.drafts[`ef-${cid}-on`] : !!t.on;
      return `<div class="ftarget"><h3>${esc(name)}</h3>
        ${toggleRow(`ef-${cid}-on`, on, `Find leads for ${name}`)}
        <div class="fld"><label for="ef-${cid}-niches">Types of business, separated by commas</label><textarea class="in" rows="3" id="ef-${cid}-niches" data-draft>${esc(v(`${cid}-niches`, t.niches))}</textarea></div>
        <div class="fld"><label for="ef-${cid}-areas">Cities, one per line</label><textarea class="in" rows="5" id="ef-${cid}-areas" data-draft>${esc(v(`${cid}-areas`, String(t.areas || '').split(/;\s*/).join('\n')))}</textarea></div></div>`; }).join('')}
    <div class="btnrow emfoot"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="modal-close">Cancel</button></div>
  </form>`;
}

/* ----- sheets of the Email tab ----- */
function emCampaignSheet() {
  const m = S.modal, id = m.id, stored = (S.data.campaigns || {})[id];
  if (!stored) return closeOnly('Campaign');
  const c = emDraftCampaign(id), steps = c.steps || [], n = Math.min(m.n || 0, Math.max(0, steps.length - 1));
  const keys = Object.keys(c.segments || {}), seg = keys.includes(m.seg) ? m.seg : (keys[0] || 'general');
  const st = steps[n] || {}, g = (c.segments || {})[seg] || {};
  const dirty = emEditable(c) !== emEditable(stored);
  const counts = {}; emLeads().filter(l => l.seq.campaign === id).forEach(l => { const k = l.segment || segmentOf(l.kind || l.business); counts[k] = (counts[k] || 0) + 1; });
  const sample = emSample(id, seg), single = keys.length <= 1;
  return `<div class="card-h"><h2>${esc(stored.name)}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    ${stored.reviewed ? `<div class="ok-box">Approved${stored.reviewedAt ? ' ' + esc(fmtDay(iso(new Date(stored.reviewedAt)))) : ''}. ${liveCampaign(stored) ? 'It is on.' : 'It is paused.'} Changes you save go out from the next email on.</div>`
      : `<div class="warnbox">Read each email the way a business will see it, change anything that isn't right, then approve it. Nothing from this campaign goes out until you do.</div>`}
    <form class="stack" data-form="em-campaign">
    <div class="grid2"><div class="fld"><label for="ec-name">Campaign name</label><input class="in" id="ec-name" data-draft value="${esc(c.name)}"></div>
      <div class="fld"><label for="ec-cap">Most a day from this campaign</label><input class="in" type="number" min="1" max="200" inputmode="numeric" id="ec-cap" data-draft value="${esc(c.cap)}"></div></div>
    ${c.trigger ? `<div class="grid2"><div class="fld"><label for="ec-tstage">Starts for leads in</label><select class="in" id="ec-tstage" data-draft>${STAGES.map(s => `<option ${c.trigger.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="fld"><label for="ec-tdays">After this many days there</label><input class="in" type="number" min="0" max="365" inputmode="numeric" id="ec-tdays" data-draft value="${esc(c.trigger.days)}"></div></div>
      <span class="meta">Once, for each lead with an email that sits in that stage that long and isn't in another campaign. Moving the lead on stops it.</span>` : ''}
    <div class="fld"><label for="ec-offer">The offer in one line, for you</label><input class="in" id="ec-offer" data-draft value="${esc(c.offer)}"><span class="meta">Not in the emails. It helps Claude sort the replies and heads the forwarded ones.</span></div>
    <div class="fld"><label for="ec-price">Price line, where an email says {price}</label><textarea class="in" id="ec-price" rows="2" data-draft data-emprev>${esc(c.price)}</textarea><span class="meta">Leave it empty to leave the price out.</span></div>
    <h3>The emails</h3>
    ${steps.length > 1 ? `<div class="seg scope emtabs">${steps.map((x, k) => `<button type="button" class="${k === n ? 'on' : ''}" data-act="ec-step" data-n="${k}">${esc(emStepName(k, steps.length))}<small>${k ? `${plural(Number(x.wait) || 0, 'day')} later` : 'day 1'}</small></button>`).join('')}</div>` : ''}
    ${n === 0 ? `<div class="fld"><label for="ec-s0-subject">Subject</label><input class="in" id="ec-s0-subject" data-draft data-emprev value="${esc(st.subject || '')}"></div>`
      : `<div class="fld"><label for="ec-s${n}-wait">Sending days after the email before</label><input class="in" type="number" min="1" max="30" inputmode="numeric" id="ec-s${n}-wait" data-draft value="${esc(st.wait)}" style="max-width:120px"><span class="meta">It goes in the same thread, so the subject is "Re: ${esc(steps[0] ? steps[0].subject : '')}".</span></div>`}
    <div class="fld"><label for="ec-s${n}-body">Email</label><textarea class="in mailin" id="ec-s${n}-body" rows="9" data-draft data-emprev>${esc(st.body || '')}</textarea>
      <span class="meta">Fill-ins: {greeting} (their first name, or "Business team"), {business}, ${single ? '' : '{question}, {features}, '}{price}, {city}. Your name, website, mailing address and a way to opt out are added under every email.</span></div>
    ${single ? '' : `<h3>By type of business</h3>
    <div class="chips multi">${keys.map(k => `<button type="button" class="chip ${k === seg ? 'on' : ''}" data-act="ec-seg" data-k="${esc(k)}">${esc((c.segments[k] || {}).label || k)}${counts[k] ? ` · ${counts[k]}` : ''}</button>`).join('')}</div>
    <div class="fld"><label for="ec-g-${esc(seg)}-question">{question} for ${esc(g.label || seg)}</label><textarea class="in" rows="2" id="ec-g-${esc(seg)}-question" data-draft data-emprev>${esc(g.question || '')}</textarea></div>
    <div class="fld"><label for="ec-g-${esc(seg)}-features">{features} for ${esc(g.label || seg)}</label><textarea class="in" rows="4" id="ec-g-${esc(seg)}-features" data-draft data-emprev>${esc(g.features || '')}</textarea></div>`}
    <h3>How ${esc(sample.name)} sees it</h3>
    <div id="em-preview">${emMailHtml(sample, c, n)}</div>
    <div class="btnrow emfoot">
      <button class="btn ${dirty ? 'primary' : ''}" type="submit">Save</button>
      ${stored.reviewed ? '' : '<button class="btn primary" type="button" data-act="ec-approve">Looks good, turn it on</button>'}
      <button class="btn ghost" type="button" data-act="em-test" data-id="${esc(id)}" ${S.emTestBusy ? 'disabled' : ''}>${S.emTestBusy ? 'Sending…' : 'Send me a test'}</button>
    </div>
    ${DEFAULT_CAMPAIGNS[id] ? `<div class="btnrow">${S.confirm === 'ec-reset' ? `<span class="meta">Put back the original wording? Your changes to this campaign are replaced.</span><button class="btn sm badb" type="button" data-act="ec-reset">Yes, put it back</button><button class="btn sm ghost" type="button" data-act="confirm" data-c="">Keep mine</button>` : '<button class="btn sm ghost" type="button" data-act="confirm" data-c="ec-reset">Back to the original wording</button>'}</div>` : ''}
    </form>`;
}
function emSettingsSheet() {
  const s = emSettings(), days = (S.modal && S.modal.days) || s.days, v = (k, def) => draft('es-' + k, def ?? '');
  const today = localClock(s.tz).date, cap = dailyCap(s, today);
  return `<div class="card-h"><h2>Email settings</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
  <form class="stack" data-form="em-settings" novalidate>
    <div class="fld"><label for="es-address">Mailing address for the bottom of your emails</label><textarea class="in" id="es-address" rows="2" data-draft placeholder="A PO box or virtual mailbox, with city, state and ZIP">${esc(v('address', s.address))}</textarea>
      <span class="meta">Nothing is ever mailed to it. It is one line of text at the bottom of each email, which US law (CAN-SPAM) requires in sales email. To keep your home address private, use a PO box or a virtual mailbox (iPostal1 or Anytime Mailbox, about $10 a month, set up online in minutes). Nothing sends without it.</span></div>
    <div class="fld"><label for="es-forward">Forward hot replies to</label><input class="in" type="email" id="es-forward" data-draft value="${esc(v('forward', s.forwardTo))}" placeholder="Optional, like your personal email"><span class="meta">Either way, hot replies are starred and labeled LCC/Hot in ${esc(emGmail() || 'your Gmail')}, show up on this tab, move to Talking, and ping your phone when notifications are on.</span></div>
    <div class="grid2"><div class="fld"><label for="es-name">Your name</label><input class="in" id="es-name" data-draft value="${esc(v('name', s.fromName))}"></div><div class="fld"><label for="es-website">Website</label><input class="in" id="es-website" data-draft value="${esc(v('website', s.website))}"></div></div>
    <h3>When emails go out</h3>
    ${dayPicker('es-day', days)}
    <div class="grid2"><div class="fld"><label for="es-start">From</label><input class="in" type="time" id="es-start" data-draft value="${esc(v('start', s.start))}"></div><div class="fld"><label for="es-end">Until</label><input class="in" type="time" id="es-end" data-draft value="${esc(v('end', s.end))}"></div></div>
    <span class="meta">In each business's own time, so Arizona gets Arizona hours and Iowa gets Iowa hours.</span>
    <h3>How many a day</h3>
    <div class="grid3"><div class="fld"><label for="es-capStart">Start at</label><input class="in" type="number" min="1" max="200" inputmode="numeric" id="es-capStart" data-draft value="${esc(v('capStart', s.capStart))}"></div><div class="fld"><label for="es-capStep">Add each day</label><input class="in" type="number" min="0" max="50" inputmode="numeric" id="es-capStep" data-draft value="${esc(v('capStep', s.capStep))}"></div><div class="fld"><label for="es-capMax">Up to</label><input class="in" type="number" min="1" max="200" inputmode="numeric" id="es-capMax" data-draft value="${esc(v('capMax', s.capMax))}"></div></div>
    <span class="meta">A new mailbox that suddenly sends a lot ends up in spam. 20 a day plus 5 each sending day reaches 50 in about a week. Follow-ups count too.${s.startedOn ? ` Today's limit: ${cap}.` : ''}</span>
    <div class="grid2"><div class="fld"><label for="es-gap">Minutes between emails, at least</label><input class="in" type="number" min="3" max="120" inputmode="numeric" id="es-gap" data-draft value="${esc(v('gap', s.gap))}"></div>
      <div class="fld"><label for="es-tz">Your time zone</label><select class="in" id="es-tz" data-draft>${EM_TZS.map(([z, l]) => `<option value="${z}" ${v('tz', s.tz) === z ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="meta">When the day's count starts over.</span></div></div>
    <div class="btnrow"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="modal-close">Cancel</button></div>
  </form>`;
}
function emImportSheet() {
  const m = S.modal, imp = S.emImport, camps = emCampaigns().filter(c => !c.trigger), sel = m.campaign && (m.campaign === 'auto' || camps.some(c => c.id === m.campaign)) ? m.campaign : 'auto';
  let body;
  if (imp) {
    const r = importLeads(imp.rows, {campaign:sel, leads:S.data.leads || {}, suppressed:emSuppressed(), now:Date.now(), today:todayISO()});
    const enroll = r.update.filter(x => x.enroll), all = [...r.create.map(x => x.doc), ...enroll.map(x => ({...S.data.leads[x.id], ...x.patch}))];
    const by = {}; all.forEach(d => { const k = d.seq.campaign; (by[k] = by[k] || {n:0, seg:{}}).n++; by[k].seg[d.segment || 'general'] = (by[k].seg[d.segment || 'general'] || 0) + 1; });
    const sk = r.skipped, extra = [sk.dup ? `${sk.dup} already in a campaign` : '', sk.noEmail ? `${sk.noEmail} without an email` : '', sk.suppressed ? `${sk.suppressed} on your do-not-contact list` : '', sk.engaged ? `${sk.engaged} you're already talking to, or closed` : ''].filter(Boolean);
    const total = r.create.length + enroll.length;
    body = `<div class="impbox">
      <div class="meta">${esc(imp.name)} · ${plural(imp.rows.length, 'row')}</div>
      <b class="impn">${total ? `${plural(total, 'lead')} ready` : 'Nobody new in this file'}</b>
      ${total ? `<div class="meta">${plural(r.create.length, 'new lead')}${enroll.length ? `, and ${enroll.length} already in your pipeline get the email` : ''}.</div>` : ''}
      ${extra.length ? `<div class="meta">Skipping ${esc(extra.join(', '))}.</div>` : ''}
      ${Object.entries(by).map(([cid, x]) => `<div><b>${esc(((S.data.campaigns || {})[cid] || {}).name || cid)}: ${x.n}</b> <span class="meta">${Object.entries(x.seg).map(([k, c]) => `${esc(emSegLabel(cid, k))} ${c}`).join(' · ')}</span></div>`).join('')}
      ${r.held ? `<div class="meta">${r.held === 1 ? '1 lead is' : r.held + ' leads are'} marked Check first. They wait until you look and tap Queue.</div>` : ''}
      ${all.length ? `<div class="imptable">${all.slice(0, 6).map(d => `<div><b>${esc(d.name)}</b><span>${esc(d.email)}</span></div>`).join('')}${all.length > 6 ? `<div class="meta">and ${all.length - 6} more</div>` : ''}</div>` : ''}
    </div>
    <div class="btnrow"><button class="btn primary" data-act="ei-add" ${total || r.update.length ? '' : 'disabled'}>Add ${plural(total, 'lead')}</button><button class="btn ghost" data-act="ei-clear">Use another file</button></div>
    <div class="meta">New leads stay off your call list. Adding doesn't send anything: emails only go out from a campaign you approved, after you tap Start sending.</div>`;
  } else {
    body = `<div class="btnrow"><label class="btn primary" for="ei-file" style="cursor:pointer">Choose a CSV file</label><input type="file" id="ei-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden><span class="meta">or drag it onto this page</span></div>
    <details><summary>Or paste rows from a spreadsheet</summary><div class="stack" style="margin-top:8px"><textarea class="in" id="ei-paste" rows="5" data-draft placeholder="business,email,type,city,state&#10;Glow Aesthetics,hello@glow.com,Med spa,Scottsdale,AZ">${esc(draft('ei-paste'))}</textarea><div class="btnrow"><button class="btn sm" data-act="ei-read">Read it</button><span class="meta">Include the header row.</span></div></div></details>`;
  }
  return `<div class="card-h"><h2>Add leads</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <p class="meta" style="margin:0;color:var(--ink-2)">A spreadsheet saved as CSV (Google Sheets: File › Download › CSV). It reads columns like business, email, first name, type, city, state, phone and website, so exports from Apollo or Outscraper work too. The list from Claude, <b>outreach-list.csv</b>, works as is. A business already in your pipeline gets the email instead of a second lead.</p>
    <div class="fld"><label>Campaign</label><div class="seg scope">${[['auto','By type'], ...camps.map(c => [c.id, c.name])].map(([k, l]) => `<button type="button" class="${sel === k ? 'on' : ''}" data-act="ei-camp" data-k="${esc(k)}">${esc(l)}</button>`).join('')}</div>
      <span class="meta">${sel === 'auto' ? 'Dentists and service businesses get Front Desk AI. Everyone else gets Own the Home Screen.' : 'Everyone in the file gets this campaign.'}</span></div>
    ${body}`;
}
function emSetupSheet() {
  const st = S.outEng || {}, state = emState(), finder = outDoc('finder') || {}, outdated = st.fn === 'ok' && (st.version || 1) < OUTREACH_V, gm = st.gmail || {};
  const gmailOk = (st.fn === 'ok' && !!gm.ok) || (!st.fn && !!state.gmail);
  const ran = state.lastRun ? (Date.now() - Date.parse(state.lastRun)) / 60000 : null, fran = finder.lastRun ? (Date.now() - Date.parse(finder.lastRun)) / 60000 : null;
  const step = (n, title, body, ok) => `<div class="step ${ok ? 'ok' : ''}"><div class="num">${ok ? '✓' : n}</div><div class="min0"><b>${title}</b><div class="meta" style="color:var(--ink-2)">${body}</div></div></div>`;
  return `<div class="card-h"><h2>Email engine setup</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <p class="meta" style="margin:0;color:var(--ink-2)">The engine is a small function in your own Supabase project. Every 10 minutes it sends the next email from your Gmail and reads new replies, and every 15 minutes the finder looks for new leads, even with this app closed. Do this once, on a laptop. About 15 minutes.</p>
    ${step(1, 'Turn on the Gmail API', 'Open <b>console.cloud.google.com</b> signed in as <b>logan@logandnewman.com</b>. Create a project (any name, like Command), then go to <b>APIs &amp; Services › Library</b>, search for <b>Gmail API</b> and click <b>Enable</b>.', gmailOk)}
    ${step(2, 'Make a sign-in key for the engine', 'Open <b>Google Auth Platform</b> (APIs &amp; Services › OAuth consent screen) and click <b>Get started</b>: app name <b>Command</b>, your email, audience <b>Internal</b>. Then <b>Clients › Create client</b>: type <b>Web application</b>, and under <b>Authorized redirect URIs</b> add <span class="kbd">https://developers.google.com/oauthplayground</span> <button class="btn sm ghost copyin" data-act="copy" data-text="https://developers.google.com/oauthplayground">Copy</button>. Click Create and copy the <b>Client ID</b> and <b>Client secret</b> right away (Google may show the secret only once).<div class="meta" style="margin-top:4px">No Internal option? Then the address isn\'t on Google Workspace: pick External, add yourself as a test user, and on the Audience page click <b>Publish app</b> so access doesn\'t expire after 7 days.</div>', gmailOk)}
    ${step(3, 'Get a refresh token', 'Open <b>developers.google.com/oauthplayground</b>. Click the gear at the top right, check <b>Use your own OAuth credentials</b>, and paste the Client ID and secret. On the left, in <b>Input your own scopes</b>, paste <span class="kbd">https://www.googleapis.com/auth/gmail.modify</span> <button class="btn sm ghost copyin" data-act="copy" data-text="https://www.googleapis.com/auth/gmail.modify">Copy</button> and click <b>Authorize APIs</b>. Sign in as logan@logandnewman.com and allow it. Then click <b>Exchange authorization code for tokens</b> and copy the <b>Refresh token</b>.', gmailOk)}
    ${step(4, 'Add the secrets in Supabase', `Open <b>Edge Functions › Secrets</b> and add <span class="kbd">GMAIL_CLIENT_ID</span>, <span class="kbd">GMAIL_CLIENT_SECRET</span> and <span class="kbd">GMAIL_REFRESH_TOKEN</span>. <span class="kbd">ANTHROPIC_API_KEY</span> (already there if you set up Ask) lets Claude sort the replies and run the finder.${st.fn === 'ok' ? `<div class="btnrow" style="margin-top:6px">${gm.ok ? `<span class="pill good">Gmail connected: ${esc(gm.email)}</span>` : '<span class="pill warn">Gmail not connected yet</span>'}${st.hasKey ? '<span class="pill good">Anthropic key is set</span>' : '<span class="pill warn">No Anthropic key: no finder, and replies are sorted by simple rules</span>'}</div>${!gm.ok && gm.error ? `<div class="err" style="margin-top:6px">${esc(gm.error)}</div>` : ''}` : ''}`, gmailOk)}
    ${step(5, 'Create the function', `Open <b>Edge Functions › Deploy a new function › Via Editor</b>. Name it <span class="kbd">outreach</span>, replace all the code with the copied code, and <b>Deploy</b>. Then, in the function's <b>Settings</b>, turn <b>off</b> "Verify JWT".<div class="btnrow" style="margin-top:6px"><button class="btn sm" data-act="em-copy-fn">Copy the code</button><button class="btn sm ghost" data-act="em-check">${st.checking ? 'Checking…' : 'Check'}</button>${st.fn === 'ok' ? (outdated ? '<span class="pill warn">Update needed</span>' : '<span class="pill good">Found</span>') : st.fn === 'missing' ? '<span class="pill warn">Not found yet</span>' : st.fn === 'error' ? '<span class="pill bad">Problem</span>' : ''}</div>${outdated ? '<div class="meta" style="margin-top:6px">Supabase is running an older copy. Copy the code, open the <b>outreach</b> function, replace all of its code, Deploy, then tap Check.</div>' : ''}${st.fn === 'error' && st.msg ? `<div class="err" style="margin-top:6px">${esc(st.msg)}</div>` : ''}`, st.fn === 'ok' && !outdated)}
    ${step(6, 'Put it on a schedule', `Easiest: tap <b>Copy the SQL</b>, open Supabase's <b>SQL Editor</b>, paste it and click <b>Run</b>. It sets up both jobs: sending and replies every 10 minutes, the finder every 15. (On the <b>Integrations › Cron</b> page instead: one job for <b>outreach</b> every <span class="kbd">*/10 * * * *</span>, and a second one every <span class="kbd">7,22,37,52 * * * *</span> with the body <span class="kbd">{"job":"find"}</span>, both POST with timeout <span class="kbd">120000</span> ms.)<div class="btnrow" style="margin-top:6px"><button class="btn sm" data-act="em-copy-sql">Copy the SQL</button>${ran !== null && ran <= 12 ? '<span class="pill good">Sending job running</span>' : ran !== null ? `<span class="pill warn">Sending job last ran ${esc(emAgo(state.lastRun))}</span>` : st.fn === 'ok' ? '<span class="pill warn">Not running yet. Check back in 10 minutes.</span>' : ''}${fran !== null && fran <= 20 ? '<span class="pill good">Finder running</span>' : ''}</div>`, ran !== null && ran <= 12)}
    ${step(7, 'Keep your emails out of spam', `Cold email reaches inboxes when your domain vouches for it. If logandnewman.com runs on Google Workspace, open <b>admin.google.com</b> › Apps › Google Workspace › Gmail › <b>Authenticate email</b>, generate the DKIM record, add it as a TXT record where your domain's DNS is managed, then click <b>Start authentication</b>. The DNS also needs SPF, a TXT record on the domain itself, <span class="kbd">v=spf1 include:_spf.google.com ~all</span> <button class="btn sm ghost copyin" data-act="copy" data-text="v=spf1 include:_spf.google.com ~all">Copy</button> (if one starting with v=spf1 is already there, add <span class="kbd">include:_spf.google.com</span> to it instead of making a second), and DMARC, a TXT record named <span class="kbd">_dmarc</span> with <span class="kbd">v=DMARC1; p=none</span> <button class="btn sm ghost copyin" data-act="copy" data-text="v=DMARC1; p=none">Copy</button>. About 10 minutes once; the records can take a few hours to start working.`, false)}
    ${state.lastError ? `<div class="err">Last run: ${esc(state.lastError)}</div>` : ''}
    <div class="meta">Nothing is sent until you approve a campaign, add your mailing address and tap Start sending. The finder does nothing until you turn it on.</div>`;
}

/* ----- start sending: both cold campaigns, the address, the finder and the first day in one sheet ----- */
const LAUNCH_CAMPS = ['home-screen', 'front-desk'];
// Whether the sheet's "find new leads" switch for a campaign is on: what you tapped, else what the
// finder already does, else on.
const lxFind = cid => { const f = emSettings().finder; return S.drafts['lx-f-' + cid] !== undefined ? !!S.drafts['lx-f-' + cid] : f.enabled ? !!(f.targets[cid] || {}).on : true; };
function emLaunchSheet() {
  const s = emSettings(), eng = S.outEng || {}, t = todayISO(), list = emLeads();
  const startOn = draft('lx-date', s.startOn && s.startOn >= t ? s.startOn : nextSendDay(addDays(t, 1), s.days));
  const addr = draft('lx-address', s.address || ''), preview = {...s, address:addr};
  const outdated = eng.fn === 'ok' && (eng.version || 1) < OUTREACH_V, gm = eng.gmail || {};
  const engineOk = eng.fn === 'ok' && !outdated && !!gm.ok;
  const engLine = engineOk ? `Up to date, sending from <b>${esc(gm.email)}</b>.`
    : eng.checking || !eng.fn ? 'Checking the engine…'
    : outdated ? 'Supabase runs an older engine that won\'t wait for your start day. On a laptop: Engine setup, step 5 (copy the code, deploy), then step 6 (run the SQL). About 5 minutes.'
    : eng.fn === 'ok' ? 'The engine is there, but Gmail isn\'t connected yet. Engine setup, steps 1 to 4, on a laptop.'
    : eng.fn === 'missing' ? 'Not set up yet. Do Engine setup on a laptop before your start day, about 15 minutes.'
    : 'Couldn\'t reach the engine from here. Check Engine setup on a laptop before your start day.';
  const camps = LAUNCH_CAMPS.map(id => (S.data.campaigns || {})[id] ? {id, ...S.data.campaigns[id]} : null).filter(Boolean);
  const need = camps.filter(c => !(c.reviewed && c.status === 'running'));
  const f = s.finder;
  const campRows = camps.map(c => {
    const n = list.filter(l => l.seq.campaign === c.id && ['queued','active','hold'].includes(l.seq.status)).length;
    const why = emCampaignProblem(emClean(c)), seg = Object.keys(c.segments || {})[0] || 'general';
    return `<div class="lxcamp"><div class="lxcamp-h"><b>${esc(c.name)}</b>${c.reviewed && c.status === 'running' ? '<span class="pill good">Approved</span>' : '<span class="pill warn">Needs your OK</span>'}<span class="meta">${n ? `${plural(n, 'lead')} in line` : 'No leads in line yet'}</span></div>
      ${c.offer ? `<div class="meta">${esc(c.offer)}</div>` : ''}
      ${why ? `<div class="err">${esc(why)}</div>` : ''}
      <details><summary>Read the first email</summary>${emMailHtml(emSample(c.id, seg), c, 0, preview)}</details>
      ${toggleRow('lx-f-' + c.id, lxFind(c.id), `Find new leads for ${c.name} every day`)}
      <div class="btnrow"><button class="btn sm ghost" data-act="em-campaign" data-id="${esc(c.id)}">Edit the wording</button>${n ? '' : `<button class="btn sm ghost" data-act="em-import" data-campaign="${esc(c.id)}">Add a spreadsheet</button>`}</div></div>`;
  }).join('');
  const label = need.length === camps.length && camps.length > 1 ? 'Approve both and start' : need.length ? `Approve ${need[0].name} and start` : 'Start';
  const step = (n, title, body, ok) => `<div class="step ${ok ? 'ok' : ''}"><div class="num">${ok ? '✓' : n}</div><div class="min0 stack">${title ? `<b>${title}</b>` : ''}${body}</div></div>`;
  return `<div class="card-h"><h2>Start sending</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <p class="meta" style="margin:0;color:var(--ink-2)">Everything for your first sending day on one page. Nothing goes out before the day you pick, and Pause on the Email tab stops it any time. Replies are read either way.</p>
    ${step(1, 'The engine', `<div class="meta" style="color:var(--ink-2)">${engLine}</div>${engineOk ? '' : '<div class="btnrow"><button class="btn sm" data-act="em-setup">Engine setup</button></div>'}`, engineOk)}
    ${step(2, 'Your mailing address', `<textarea class="in" id="lx-address" rows="2" data-draft placeholder="PO Box 123, Des Moines, IA 50309">${esc(addr)}</textarea><span class="meta">One line of text at the bottom of each email, which US law requires in sales email. Nothing is ever mailed to it. A PO box or a virtual mailbox (iPostal1 or Anytime Mailbox, about $10 a month) keeps your home address private.</span>`, !!String(addr).trim())}
    ${step(3, 'The emails', `${campRows}${engineOk ? `<div class="btnrow"><button class="btn sm" data-act="lx-test" ${S.emTestBusy ? 'disabled' : ''}>${S.emTestBusy ? 'Sending…' : 'Send me both as a test'}</button><span class="meta">To your own inbox, so you see exactly what goes out.</span></div>` : ''}<span class="meta">The finder adds up to ${f.perDay} new leads a day in all and spends at most ${dollars(f.budget)} a day on your Anthropic account. Change that in its Settings.</span>`, !need.length)}
    ${step(4, 'Your first sending day', `<input class="in" type="date" id="lx-date" data-draft data-rerender min="${t}" value="${esc(startOn)}" style="max-width:220px"><span class="meta">${fmtTap(s.start)} to ${fmtTap(s.end)} in each business's own time, ${esc(emDays(s.days))}. ${s.capStart} emails on the first day and ${s.capStep} more each sending day, up to ${s.capMax} a day, follow-ups included.</span>`, false)}
    <div class="btnrow emfoot"><button class="btn primary" data-act="lx-go">${esc(label)} ${esc(dayWord(startOn))}</button><button class="btn ghost" data-act="modal-close">Not yet</button></div>
    ${need.length ? `<div class="meta">This approves ${need.length > 1 ? 'both first emails and their follow-ups' : 'that campaign\'s emails'} as they read now.</div>` : ''}`;
}

/* ----- changes ----- */
// Where the lead form goes when it closes: back to the lead (and from there to calling mode), or away.
function leadEditDone(m) {
  if (m && m.back === 'lead-view' && (S.data.leads || {})[m.id]) S.modal = {type:'lead-view', id:m.id, back:m.back2 || null};
  else if (m && m.back === 'call') S.modal = {type:'call'};
  else closeModal();
}
// Moves a lead to a stage by hand, with the same rules a reply follows: moving past Contacted stops its emails.
function moveLeadStage(id, to) {
  const l = (S.data.leads || {})[id]; if (!l || (l.stage || 'New lead') === to || !STAGES.includes(to)) return '';
  const patch = {...stagePatch(l, to, 'you', Date.now()), updatedAt:Date.now()};
  if (to === 'Won' && l.type !== 'Client') patch.type = 'Client';
  S.lastUndo = {type:'restore', ops:[{patch:['leads', id, backOf(l, patch)]}]};
  patchDoc('leads', id, patch);
  const trig = emCampaigns().find(c => c.trigger && c.trigger.stage === to && liveCampaign(c) && l.email && !l.dnc);
  return `${l.name || 'The lead'} is in ${to}.${patch.seq ? ' Its emails stopped.' : ''}${trig ? ` ${trig.name} emails them in ${plural(Number(trig.trigger.days) || 0, 'day')}.` : ''}`;
}
function emSetStatus(ids, op) {
  const ops = []; let n = 0;
  ids.forEach(id => {
    const l = (S.data.leads || {})[id], q = l && l.seq; if (!l) return;
    let patch = null;
    if (op === 'queue' && q && q.status === 'hold') patch = {seq:{status:'queued'}};
    else if (op === 'pause' && q && ['queued','active'].includes(q.status)) patch = {seq:{status:'paused', pausedWhy:'you'}};
    else if (op === 'resume' && q && q.status === 'paused') patch = {seq:{...emResume(l), failCount:0, lastError:null}};
    else if (op === 'block' && !l.dnc) patch = {dnc:true, ...(q && LIVE_SEQ.includes(q.status) ? {seq:{status:'stopped', nextOn:null, stoppedWhy:'Do not contact'}} : {})};
    if (!patch) return;
    ops.push({patch:['leads', id, {...(patch.dnc ? {dnc:l.dnc ?? null} : {}), ...(patch.seq ? {seq:Object.fromEntries(Object.keys(patch.seq).map(k => [k, q && q[k] !== undefined ? q[k] : null]))} : {})}]});
    patchDoc('leads', id, {...patch, updatedAt:Date.now()}); n++;
    const email = String(l.email || '').toLowerCase();
    if (op === 'block' && email && !(S.data.suppress || {})[email]) { setDoc('suppress', email, {email, reason:'Taken off by you', at:new Date().toISOString()}); ops.push({del:['suppress', email]}); }
  });
  if (n) S.lastUndo = {type:'restore', ops};
  return n;
}
// Starts a campaign for some leads: anyone with an email who isn't on the do-not-contact list, isn't
// in a campaign already and, for a cold campaign, isn't already talking to you, closed or lost.
function enrollLeads(ids, cid) {
  const c = (S.data.campaigns || {})[cid]; if (!c) return {n:0, skipped:ids.length};
  const sup = emSuppressed(), ops = [], t = todayISO(); let n = 0;
  ids.forEach(id => {
    const l = (S.data.leads || {})[id];
    if (!l || !isEmail(l.email) || l.dnc || l.emailBad || sup.has(String(l.email).toLowerCase())) return;
    if (l.seq && (LIVE_SEQ.includes(l.seq.status) || l.seq.sendingStep != null)) return;
    if (!c.trigger && !['New lead','Contacted'].includes(l.stage || 'New lead')) return;
    const patch = {...enrollPatch(l, cid, t, false), segment:l.segment || segmentOf(l.kind || l.business)};
    ops.push({patch:['leads', id, backOf(l, patch)]});
    patchDoc('leads', id, {...patch, updatedAt:Date.now()}); n++;
  });
  if (n) S.lastUndo = {type:'restore', ops};
  return {n, skipped:ids.length - n};
}
// A reply Claude (or the rules) sorted wrong: the lead and the do-not-contact list follow your call.
function emRelabel(rid, label) {
  const r = (S.data.replies || {})[rid]; if (!r || r.label === label || !EM_LABEL[label]) return;
  const lid = r.lead || r.prospect, l = (S.data.leads || {})[lid], email = String((l && l.email) || r.email || '').toLowerCase();
  const ops = [{patch:['replies', rid, {label:r.label, handled:!!r.handled, relabeled:!!r.relabeled}]}];
  patchDoc('replies', rid, {label, handled:!HOT.includes(label), relabeled:true});
  if (l) {
    let patch;
    if (label === 'auto') {
      const lastReply = (l.history || []).slice().reverse().find(h => h.by === 'reply');
      patch = {reply:null, seq:l.seq ? emResume(l) : null, ...(lastReply && l.stage === lastReply.to ? stagePatch(l, lastReply.from || 'Contacted', 'you', Date.now()) : {})};
      if (l.seq) patch.seq = {...emResume(l)};
    } else patch = replyPatch(l, label, {summary:r.summary || r.snippet || ''}, Date.now(), todayISO());
    if (SUPPRESS[r.label] && !SUPPRESS[label]) { patch.dnc = false; if (r.label === 'bounce') patch.emailBad = false; }
    ops.push({patch:['leads', lid, backOf(l, patch)]});
    patchDoc('leads', lid, {...patch, updatedAt:Date.now()});
  }
  const sup = email ? (S.data.suppress || {})[email] : null;
  if (email && SUPPRESS[label] && !sup) { setDoc('suppress', email, {email, reason:EM_SUP_REASON[label], at:new Date().toISOString()}); ops.push({del:['suppress', email]}); }
  else if (email && !SUPPRESS[label] && sup && SUPPRESS[r.label]) { delDoc('suppress', email); ops.push({set:['suppress', email, clone(sup)]}); }
  S.lastUndo = {type:'restore', ops};
  toast(`Sorted as ${EM_LABEL[label][0]}.${HOT.includes(label) ? ' The lead is in Talking and on your hot list.' : ''}`, true);
}
async function emReadFile(f) {
  try {
    const rows = parseCSV(await f.text());
    if (!rows.length) { toast("That file is empty, or it isn't a spreadsheet."); return; }
    S.emImport = {name:f.name, rows};
    if (!S.modal || S.modal.type !== 'em-import') { S.confirm = null; S.modal = {type:'em-import', campaign:'auto'}; }
    render();
  } catch (e) { toast("Couldn't read that file."); }
}

/* ----- calling mode: one lead at a time ----- */
function callSheet() {
  const t = todayISO(), cm = S.callMode || {}, m = nowMin();
  const blocks = itemsFor(t).filter(i => i.kind === 'calls');
  const block = (cm.region ? blocks.find(i => i.region === cm.region) : null) || blocks.find(i => toMin(i.start) <= m && m < toMin(i.end)) || blocks.find(i => toMin(i.start) > m) || blocks[0] || null;
  const region = cm.region || (block ? block.region : '') || '';
  const due = leadsDue(t).sort(leadSortDue).filter(l => l.type !== 'Cold' || !region || l.region === region);
  const skipped = cm.skipped || [];
  const list = [...due.filter(l => !skipped.includes(l.id)), ...due.filter(l => skipped.includes(l.id))];
  const cur = list[0];
  const dials = dialsFor(t, region), quota = block && block.region === region ? block.quota : 0;
  const pct = quota ? Math.min(100, Math.round(dials / quota * 100)) : 0;
  const head = `<div class="card-h"><h2>Calling${region ? ' · ' + regionName(region) : ''}</h2><button class="btn sm ghost" data-act="modal-close">Done</button></div>
    <div class="progress"><div class="bar ${quota && dials >= quota ? 'good' : ''}"><i style="width:${pct}%"></i></div><span class="meta mono">${dials}${quota ? '/' + quota : ''} ${esc(regionName(region) || '')} dials · ${callsCount(t,'dial')} today</span><span class="meta">${plural(list.length,'lead')} up</span></div>`;
  if (!cur) return head + `<div class="card empty"><b>All caught up here.</b><br>${quota && dials < quota ? `${quota - dials} more dials to hit the block. Open calls and switch the filter to Call list to keep going.` : 'Nice work. Go hit the next block.'}</div><div class="btnrow"><button class="btn" data-act="view" data-v="calls" data-sub="calls">Open calls</button></div>`;
  return head + `<div class="callcard">${leadCard(cur, t)}</div>
    <div class="btnrow"><button class="btn ghost" data-act="call-skip" data-id="${esc(cur.id)}">Skip for now</button><span class="meta">Tap a result and the next lead comes up.</span></div>`;
}
function closeModal() { S.modal = null; S.confirm = null; S.callMode = null; S.emImport = null; }
async function signOut() {
  if (db) {
    if (db.status().pending) {
      try { await db.flush(); } catch(e) {}
      const n = db.status().pending;
      if (n && !confirm(`${plural(n,'change')} on this device haven't synced yet. Sign out anyway and lose them?`)) return;
    }
    db.destroy({wipe:true});
  }
  try { await supabase.auth.signOut(); } catch(e) {}
  location.reload();
}

/* ----- modals ----- */
function renderModal() {
  const el = document.getElementById('modal');
  if (!S.modal) { el.hidden = true; el.innerHTML = ''; return; }
  const a = document.activeElement;
  const keep = a && a.id && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) ? {id:a.id, s:a.selectionStart, e:a.selectionEnd} : null;
  const sig = [S.modal.type, S.modal.key || S.modal.id || '', S.modal.date || '', S.modal.step || ''].join('|');
  const old = el.querySelector('.sheet'), top = old && el.dataset.sig === sig ? old.scrollTop : 0;
  const ty = S.modal.type;
  el.hidden = false;
  el.innerHTML = `<div class="sheet ${old ? 'still' : ''} ${ty === 'sched' || ty === 'build' || ty === 'lead-view' || ty.startsWith('em-') ? 'wide' : ty === 'week' ? 'wide week' : ''}" role="dialog" aria-modal="true">${ty === 'em-campaign' ? emCampaignSheet() : ty === 'em-settings' ? emSettingsSheet() : ty === 'em-import' ? emImportSheet() : ty === 'em-finder' ? emFinderSheet() : ty === 'em-launch' ? emLaunchSheet() : ty === 'lead-view' ? leadSheet() : ty === 'em-setup' ? emSetupSheet() : ty === 'session' ? sessionForm() : ty === 'fresh' ? freshForm() : ty === 'block' ? blockSheet(S.modal.key, S.modal.date) : ty === 'task' ? taskSheet(S.modal.id) : ty === 'mile' ? mileSheet(S.modal.id) : ty === 'stat' ? statSheet(S.modal.id) : ty === 'notif' ? notifSheet() : ty === 'call' ? callSheet() : ty === 'event' ? eventForm() : ty === 'chat' ? chatSheet() : ty === 'assist' ? assistantSheet() : ty === 'sched' ? schedSheet() : ty === 'add' ? addForm() : ty === 'blockedit' ? blockEditForm() : ty === 'catchup' ? catchupSheet() : ty === 'quick' ? quickSheet() : ty === 'build' ? buildSheet() : ty === 'week' ? weekSheet() : leadEditForm()}</div>`;
  el.dataset.sig = sig;
  if (top) el.querySelector('.sheet').scrollTop = top;
  if (keep) { const n = document.getElementById(keep.id); if (n) { n.focus({preventScroll:true}); try { if (keep.s != null) n.setSelectionRange(keep.s, keep.e); } catch(e) {} } }
}
function sessionForm() {
  const id = S.modal.id, s = S.data.sessions[id] || {date:todayISO(), type:'Drill', hours:2};
  const f = (k, def) => draft('ss-' + k, def);
  const rated = S.drafts['ss-rated'] !== undefined ? S.drafts['ss-rated'] : !!s.rated;
  return `<div class="card-h"><h2>${S.data.sessions[id] ? 'Edit session' : 'Log a session'}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="session">
      <div class="grid3"><div class="fld"><label for="ss-date">Date</label><input class="in" type="date" id="ss-date" data-draft value="${esc(f('date', s.date))}"></div>
        <div class="fld"><label for="ss-type">Type</label><select class="in" id="ss-type" data-draft>${SESSION_TYPES.map(x => `<option ${f('type', s.type) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="fld"><label for="ss-hours">Hours</label><input class="in" id="ss-hours" data-draft inputmode="decimal" value="${esc(f('hours', s.hours))}"></div></div>
      <div class="grid3" style="align-items:end"><div class="fld"><label for="ss-games">Games</label><input class="in" id="ss-games" data-draft inputmode="numeric" value="${esc(f('games', s.games))}"></div>
        <div class="fld"><label for="ss-won">Won</label><input class="in" id="ss-won" data-draft inputmode="numeric" value="${esc(f('won', s.won))}"></div>
        <div class="btnrow" style="padding-bottom:8px"><button type="button" class="ck ${rated ? 'on' : ''}" data-act="ss-rated" aria-pressed="${rated}" aria-label="Rated on DUPR"></button><span>Rated</span></div></div>
      <div class="grid2"><div class="fld"><label for="ss-partner">Partner</label><input class="in" id="ss-partner" data-draft value="${esc(f('partner', s.partner))}"></div>
        <div class="fld"><label for="ss-opponents">Opponents or event</label><input class="in" id="ss-opponents" data-draft value="${esc(f('opponents', s.opponents))}"></div></div>
      <div class="fld"><label for="ss-wentWell">Went well</label><input class="in" id="ss-wentWell" data-draft value="${esc(f('wentWell', s.wentWell))}"></div>
      <div class="fld"><label for="ss-workOn">Work on most</label><input class="in" id="ss-workOn" data-draft value="${esc(f('workOn', s.workOn))}" placeholder="The one thing to fix next time"></div>
      <div class="fld"><label for="ss-notes">Notes</label><textarea class="in" id="ss-notes" data-draft>${esc(f('notes', s.notes))}</textarea></div>
      <div class="btnrow"><button class="btn primary" type="submit">Save session</button>${S.data.sessions[id] ? (S.confirm === 'ss-del' ? '<button class="btn badb" type="button" data-act="session-delete">Yes, delete it</button>' : '<button class="btn ghost" type="button" data-act="confirm" data-c="ss-del">Delete</button>') : ''}</div>
    </form>`;
}
function leadEditForm() {
  const id = S.modal.id, l = S.data.leads[id] || {type:'Cold', stage:'New lead', region:'AZ', nextDate:todayISO()};
  const isNew = !S.data.leads[id];
  const f = (k, def) => draft('le-' + k, def);
  const sel = (k, opts, def) => `<select class="in" id="le-${k}" data-draft>${opts.map(o => { const [v,lab] = Array.isArray(o) ? o : [o,o]; return `<option value="${esc(v)}" ${String(f(k, def)) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  const inp = (k, label, def, extra) => `<div class="fld"><label for="le-${k}">${label}</label><input class="in" id="le-${k}" data-draft value="${esc(f(k, def))}" ${extra || ''}></div>`;
  const calls = S.drafts['le-calls'] !== undefined ? !!S.drafts['le-calls'] : (isNew ? true : l.callList !== false);
  return `<div class="card-h"><h2>${isNew ? 'Add a lead' : 'Edit lead'}</h2><button class="btn sm ghost" data-act="lead-edit-close">Close</button></div>
    <form class="stack" data-form="lead-edit" novalidate>
      ${inp('name','Business name',l.name)}
      <div class="grid2">${inp('business','Type + city',l.business,'placeholder="Med spa, Scottsdale"')}${inp('contact','Owner / contact',l.contact)}</div>
      <div class="grid2">${inp('phone','Phone',l.phone,'inputmode="tel"')}${inp('email','Email',l.email,'inputmode="email" autocapitalize="off" autocomplete="off" spellcheck="false"')}</div>
      <div class="grid2">${inp('website','Website',l.website)}${inp('firstName','First name for emails',l.firstName,'placeholder="Optional"')}</div>
      <div class="grid3"><div class="fld"><label for="le-type">Kind</label>${sel('type',['Cold','Warm','Client','Partner'],l.type)}</div>
        <div class="fld"><label for="le-region">Call block</label>${sel('region',[['IA','Iowa (block 1)'],['AZ','Arizona (block 2)'],['','Other']],l.region || '')}</div>
        <div class="fld"><label for="le-stage">Stage</label>${sel('stage',STAGES,l.stage)}</div></div>
      <div class="grid2">${inp('nextStep','Next step',l.nextStep)}<div class="fld"><label for="le-nextDate">Next date</label><input class="in" type="date" id="le-nextDate" data-draft value="${esc(f('nextDate', l.nextDate))}"></div></div>
      <div class="grid3">${inp('deal','Deal ($)',l.deal,'inputmode="decimal"')}${inp('monthly','Monthly ($)',l.monthly,'inputmode="decimal"')}${inp('collected','Collected ($)',l.collected,'inputmode="decimal"')}</div>
      <div class="fld"><label for="le-notes">Notes</label><textarea class="in" id="le-notes" data-draft>${esc(f('notes', l.notes))}</textarea></div>
      ${toggleRow('le-calls', calls, 'On my call list')}
      ${!isNew && inCadence(l) ? `<div class="meta">${num(l.touches)||0} of 5 touches done.</div>` : ''}
      <div class="btnrow"><button class="btn primary" type="submit">${isNew ? 'Add lead' : 'Save'}</button>${!isNew ? (S.confirm === 'le-del' ? '<button class="btn badb" type="button" data-act="lead-delete">Yes, delete it</button>' : '<button class="btn ghost" type="button" data-act="confirm" data-c="le-del">Delete</button>') : ''}</div>
    </form>`;
}

/* ----- toast ----- */
let toastTimer = null;
function toast(msg, withUndo, action) {
  S.toast = {msg, undo:!!withUndo, action:action || null};
  renderToast();
  clearTimeout(toastTimer);
  const ms = action && action.sticky ? 0 : withUndo ? 7000 : 4000;
  if (ms) toastTimer = setTimeout(() => { S.toast = null; if (withUndo) S.lastUndo = null; renderToast(); }, ms);
}
function renderToast() {
  const el = document.getElementById('toast');
  if (!S.toast) { el.hidden = true; return; }
  el.hidden = false;
  const a = S.toast.action;
  el.innerHTML = `<span>${esc(S.toast.msg)}</span>${S.toast.undo && S.lastUndo ? '<button data-act="undo">Undo</button>' : ''}${a ? `<button data-act="${esc(a.act)}">${esc(a.label)}</button>` : ''}`;
}

/* ---------- actions ---------- */
function setView(v) {
  S.view = v; S.openItem = null; S.leadForm = null; S.modal = null; S.confirm = null; S.emImport = null;
  try { localStorage.setItem('lcc-view', v); } catch(e) {}
  if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch(e) {} }
  render(); window.scrollTo(0, 0);
}
function toggleCheck(key) {
  const t = todayISO(), i = itemsFor(t).find(x => x.key === key); if (!i) return;
  const day = dayOf(t), ch = day.checks || {};
  if (i.kind === 'calls' && !ch[key] && isDone(i, t)) { toast('Quota hit, so this block is already done.'); return; }
  const on = !ch[key];
  patchDay(t, {checks:{[key]:on}});
  if (i.kind === 'session') {
    const sid = `auto-${t}-${key}`, s = S.data.sessions[sid];
    if (on && !s) setDoc('sessions', sid, {date:t, type:i.sessionType || 'Drill', hours:i.hours || 2, rated:false, auto:true, createdAt:Date.now()});
    if (!on && s && s.auto && !num(s.games) && !s.wentWell && !s.workOn && !s.notes) delDoc('sessions', sid);
  }
}
function taskToggle(id) {
  const x = S.data.tasks[id]; if (!x) return;
  const t = todayISO();
  S.lastUndo = {type:'task', id, prev:clone(x)};
  setDoc('tasks', id, {...x, done:!x.done, doneOn:!x.done ? t : null});
  if (!x.done) toast('Done.', true);
}
function handle(act, el, ev) {
  const t = todayISO(), d = el.dataset;
  switch (act) {
    case 'view': if (d.v === 'today' && S.view === 'today') S.day = null; if (d.sub) setPipeView(d.sub); setView(d.v); break;
    case 'goto': { if (S.modal) { S.modal = null; render(); } const tgt = document.getElementById(d.id); if (tgt) { tgt.scrollIntoView({behavior:'smooth', block:'start'}); const f = tgt.querySelector('input'); if (f) setTimeout(() => f.focus({preventScroll:true}), 350); } break; }
    case 'check': toggleCheck(d.key); break;
    case 'item-menu': S.openItem = S.openItem === d.key ? null : d.key; render(); break;
    case 'skip': {
      const date = d.date || t, on = d.on === '1', it = itemsFor(date).find(x => x.key === d.key);
      S.lastUndo = {type:'restore', ops:[{patch:['days', date, {skips:{[d.key]: !!((dayOf(date).skips || {})[d.key])}}]}]};
      patchDay(date, {skips:{[d.key]: on}}); S.openItem = null;
      const dw = dayWord(date), when = dw === 'today' || dw === 'tomorrow' ? 'for ' + dw : 'on ' + dw;
      toast(on ? `Canceled ${it ? itemName(it) : 'it'} ${when}. No make-up.` : `${it ? itemName(it) : 'It'} is back on.`, true);
      render(); break;
    }
    case 'catchup': S.openItem = null; S.confirm = null; S.modal = {type:'catchup'}; render(); break;
    case 'catchup-cancel': {
      const list = behindOn(t).filter(i => !['checkin','checkout'].includes(i.kind));
      const prev = {}, sk = {};
      list.forEach(i => { prev[i.key] = !!((dayOf(t).skips || {})[i.key]); sk[i.key] = true; });
      if (list.length) { patchDay(t, {skips:sk}); S.lastUndo = {type:'restore', ops:[{patch:['days', t, {skips:prev}]}]}; toast(`Canceled ${plural(list.length, 'block')} for today.`, true); }
      render(); break;
    }
    case 'move-day': {
      const msg = moveToDay(d.date || t, d.key, d.to);
      if (msg) { const back = S.modal && S.modal.back; S.modal = back === 'sched' ? {type:'sched', date:d.date || t} : back === 'catchup' ? {type:'catchup'} : back === 'week' ? {type:'week'} : null; toast(msg, true); }
      render(); break;
    }
    case 'task-toggle': taskToggle(d.id); if (S.modal && S.modal.type === 'task') S.modal = null; break;
    case 'task-tomorrow': { const x = S.data.tasks[d.id]; if (!x) break; const to = addDays(x.due && x.due > t ? x.due : t, 1); S.lastUndo = {type:'task', id:d.id, prev:clone(x)}; patchDoc('tasks', d.id, {due:to, origDue:x.origDue || x.due}); if (S.modal && S.modal.type === 'task') S.modal = null; toast(`Moved "${x.title.slice(0, 40)}" to ${dayWord(to)}.`, true); break; }
    case 'task-drop': { const x = S.data.tasks[d.id]; if (!x) break; S.lastUndo = {type:'task', id:d.id, prev:clone(x)}; patchDoc('tasks', d.id, {dropped:true, droppedOn:t}); if (S.modal && S.modal.type === 'task') S.modal = null; toast(`Dropped "${x.title.slice(0, 40)}".`, true); break; }
    case 'top3': { const am = clone(dayOf(t).am || {}); const arr = am.top3 || []; const n = +d.i; if (!arr[n]) break; arr[n].done = !arr[n].done; patchDay(t, {am:{top3:arr}}); break; }
    case 'energy': S.drafts['am-energy'] = d.n; render(); break;
    case 'am-edit': S.editAM = true; clearDrafts('am-'); render(); break;
    case 'am-cancel': S.editAM = false; clearDrafts('am-'); render(); break;
    case 'pm-edit': S.editPM = true; clearDrafts('pm-'); render(); break;
    case 'pm-cancel': S.editPM = false; clearDrafts('pm-'); render(); break;
    case 'protein': { const cur = S.drafts['pm-protein'] !== undefined ? S.drafts['pm-protein'] : !!(dayOf(t).pm || {}).protein; S.drafts['pm-protein'] = !cur; render(); break; }
    case 'call-filter': S.callFilter = d.f; S.leadForm = null; render(); break;
    case 'outcome':
      if (d.k === 'talked' || d.k === 'demo') { clearDrafts('lf-'); S.leadForm = {id:d.id, type:d.k}; render(); }
      else outcome(d.id, d.k, {});
      break;
    case 'lead-form-close': S.leadForm = null; clearDrafts('lf-'); render(); break;
    case 'lead-edit': {
      const cur = S.modal, from = cur && cur.type === 'lead-view' ? 'lead-view' : cur && cur.type === 'call' ? 'call' : null;
      clearDrafts('le-'); S.confirm = null; S.modal = {type:'lead', id:d.id, back:from, back2:from === 'lead-view' ? cur.back || null : null}; render(); break;
    }
    case 'lead-edit-close': clearDrafts('le-'); S.confirm = null; leadEditDone(S.modal); render(); break;
    case 'lead-add': clearDrafts('le-'); S.confirm = null; S.modal = {type:'lead', id:'lead-' + Date.now().toString(36)}; render(); break;
    case 'lead-delete': {
      const m = S.modal, l = m && S.data.leads[m.id]; if (!l) break;
      delDoc('leads', m.id); S.lastUndo = {type:'restore', ops:[{set:['leads', m.id, clone(l)]}]};
      S.confirm = null; if (m.back === 'call' || m.back2 === 'call') S.modal = {type:'call'}; else closeModal();
      toast(`${l.name || 'The lead'} is deleted.`, true); render(); break;
    }
    /* the pipeline */
    case 'lead-open': {
      if (!d.id || !(S.data.leads || {})[d.id]) { toast('That lead was removed.'); break; }
      const cur = S.modal, back = !cur ? null : cur.type === 'call' ? 'call' : cur.type === 'lead-view' ? cur.back || null : cur.type === 'lead' ? (cur.back2 || (cur.back === 'call' ? 'call' : null)) : null;
      clearDrafts('ls-'); S.confirm = null; S.openItem = null; S.modal = {type:'lead-view', id:d.id, back}; render(); break;
    }
    case 'lead-close': clearDrafts('ls-'); if (S.modal && S.modal.back === 'call') { S.confirm = null; S.modal = {type:'call'}; } else closeModal(); render(); break;
    case 'lead-stage': { const msg = moveLeadStage(d.id, d.s); if (msg) toast(msg, true); render(); break; }
    case 'lead-next': {
      const l = S.data.leads[d.id]; if (!l) break;
      const step = String(fval('ls-step')).trim(), date = String(fval('ls-date'));
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date.'); break; }
      const patch = {};
      if (step !== (l.nextStep || '')) patch.nextStep = step;
      if (date !== (l.nextDate || '')) patch.nextDate = date;
      if (!Object.keys(patch).length) { toast('Nothing changed.'); break; }
      S.lastUndo = {type:'restore', ops:[{patch:['leads', d.id, backOf(l, patch)]}]};
      patchDoc('leads', d.id, {...patch, updatedAt:Date.now()}); clearDrafts('ls-step'); clearDrafts('ls-date');
      toast(date && l.callList !== false ? `Saved. It shows on your Calls list ${dayWord(date)}.` : 'Saved.', true); render(); break;
    }
    case 'lead-calls': {
      const l = S.data.leads[d.id]; if (!l) break;
      const on = l.callList === false, patch = {callList:on, ...(on && !l.nextDate ? {nextDate:t, nextStep:l.nextStep || 'Call'} : {})};
      S.lastUndo = {type:'restore', ops:[{patch:['leads', d.id, backOf(l, patch)]}]};
      patchDoc('leads', d.id, {...patch, updatedAt:Date.now()});
      const when = (patch.nextDate || l.nextDate) <= t ? 'today' : dayWord(l.nextDate);
      toast(on ? `${l.name} is on your call list ${['today','tomorrow'].includes(when) ? when : 'for ' + when}.` : `${l.name} is off your call list.`, true); render(); break;
    }
    case 'lead-note': {
      const l = S.data.leads[d.id]; if (!l) break;
      const txt = String(fval('ls-note')).trim(); if (!txt) { toast('Type the note first.'); break; }
      S.lastUndo = {type:'restore', ops:[{patch:['leads', d.id, {notes:l.notes ?? ''}]}]};
      patchDoc('leads', d.id, {notes:(l.notes ? l.notes + '\n' : '') + `${fmtShort(t)}: ${txt}`, updatedAt:Date.now()});
      clearDrafts('ls-note'); toast('Note added.', true); render(); break;
    }
    case 'lead-enroll': {
      const l = S.data.leads[d.id]; if (!l) break;
      const cid = String(fval('ls-camp')), c = S.data.campaigns[cid]; if (!c) { toast('Pick a campaign first.'); break; }
      if (!c.trigger && !['New lead','Contacted'].includes(l.stage || 'New lead')) { toast(`${c.name} is for businesses you haven't talked to yet. Move ${l.name} back to New lead first, or pick another campaign.`); break; }
      const r = enrollLeads([d.id], cid);
      if (!r.n) { toast("Couldn't start it. Check the email address and your do-not-contact list."); break; }
      toast(`${l.name} is in ${c.name}.${!liveCampaign(c) ? ' Nothing goes out until you approve the campaign.' : emSettings().enabled ? ' The first email goes out on its turn.' : ' Tap Start sending on the Email tab when you are ready.'}`, true); render(); break;
    }
    case 'lead-undnc': {
      const l = S.data.leads[d.id]; if (!l) break;
      const email = String(l.email || '').toLowerCase(), sup = email && (S.data.suppress || {})[email], ops = [{patch:['leads', d.id, {dnc:true}]}];
      patchDoc('leads', d.id, {dnc:false, updatedAt:Date.now()});
      if (sup) { delDoc('suppress', email); ops.push({set:['suppress', email, clone(sup)]}); }
      S.lastUndo = {type:'restore', ops};
      toast(`${l.name} is off your do-not-contact list.`, true); render(); break;
    }
    case 'pipe-view': setPipeView(d.v); S.pipeLimit = 50; render(); break;
    case 'pipe-heat': S.pipeHeat = d.h || 'all'; S.pipeLimit = 50; render(); break;
    case 'pipe-col': setPipeView('all'); S.pipeStage = d.s || 'all'; S.pipeLimit = 50; render(); window.scrollTo(0, 0); break;
    case 'pipe-more': S.pipeLimit = (S.pipeLimit || 50) + 100; render(); break;
    case 'pipe-bulk': {
      let list = pipeFiltered(); if (S.pipeStage && S.pipeStage !== 'all') list = list.filter(l => (l.stage || 'New lead') === S.pipeStage);
      const ids = list.map(l => l.id), ops = []; let n = 0, msg = '';
      if (d.op === 'stage') {
        const to = String(fval('pb-stage')); if (!STAGES.includes(to)) { toast('Pick a stage first.'); break; }
        if (ids.length > 25 && !confirm(`Move all ${ids.length} leads to ${to}?`)) break;
        let stopped = 0;
        ids.forEach(id => {
          const l = S.data.leads[id]; if (!l || (l.stage || 'New lead') === to) return;
          const patch = stagePatch(l, to, 'you', Date.now()); if (to === 'Won' && l.type !== 'Client') patch.type = 'Client';
          if (patch.seq) stopped++;
          ops.push({patch:['leads', id, backOf(l, patch)]}); patchDoc('leads', id, {...patch, updatedAt:Date.now()}); n++;
        });
        msg = n ? `Moved ${plural(n, 'lead')} to ${to}.${stopped ? ` ${stopped} stopped getting emails.` : ''}` : `They are all in ${to} already.`;
      } else if (d.op === 'enroll') {
        const cid = String(fval('pb-camp')), c = S.data.campaigns[cid]; if (!c) { toast('Pick a campaign first.'); break; }
        if (ids.length > 25 && !confirm(`Start ${c.name} for up to ${ids.length} leads?`)) break;
        const r = enrollLeads(ids, cid); n = r.n;
        msg = n ? `${plural(n, 'lead')} started ${c.name}.${r.skipped ? ` ${r.skipped} skipped (no email, do not contact, already in a campaign${c.trigger ? '' : ' or already talking to you'}).` : ''}${liveCampaign(c) ? '' : ' Nothing goes out until you approve it.'}` : `Nobody here can start ${c.name}.`;
        S.pipeLimit = 50; toast(msg, !!n); render(); break;
      } else if (d.op === 'calls-on' || d.op === 'calls-off') {
        const on = d.op === 'calls-on';
        if (ids.length > 25 && !confirm(`${on ? 'Put' : 'Take'} up to ${ids.length} leads ${on ? 'on' : 'off'} your call list?`)) break;
        ids.forEach(id => {
          const l = S.data.leads[id]; if (!l || (l.callList !== false) === on) return;
          const patch = {callList:on, ...(on && !l.nextDate ? {nextDate:t, nextStep:l.nextStep || 'Call'} : {})};
          ops.push({patch:['leads', id, backOf(l, patch)]}); patchDoc('leads', id, {...patch, updatedAt:Date.now()}); n++;
        });
        msg = n ? `${plural(n, 'lead')} ${on ? 'put on' : 'taken off'} your call list.` : 'Nothing to change.';
      } else break;
      if (n && ops.length) S.lastUndo = {type:'restore', ops};
      toast(msg, !!n); render(); break;
    }
    case 'copy': { const txt = d.text; try { navigator.clipboard.writeText(txt).then(() => toast('Copied ' + txt), () => toast(txt)); } catch(e) { toast(txt); } break; }
    case 'week-nav': S.weekOffset += +d.d; S.weekDay = null; clearDrafts('rv-'); render(); break;
    case 'week-day': S.weekDay = d.d; render(); break;
    case 'session-new': clearDrafts('ss-'); S.confirm = null; S.modal = {type:'session', id:'s-' + Date.now().toString(36)}; render(); break;
    case 'session-edit': clearDrafts('ss-'); S.confirm = null; S.modal = {type:'session', id:d.id}; render(); break;
    case 'session-delete': delDoc('sessions', S.modal.id); S.modal = null; S.confirm = null; toast('Session deleted.'); render(); break;
    case 'ss-rated': { const s = S.data.sessions[S.modal.id] || {}; const cur = S.drafts['ss-rated'] !== undefined ? S.drafts['ss-rated'] : !!s.rated; S.drafts['ss-rated'] = !cur; render(); break; }
    case 'confirm': S.confirm = d.c; render(); break;
    case 'modal-close': closeModal(); render(); break;
    case 'call-start': S.leadForm = null; S.callMode = {region:d.region || null, skipped:[]}; S.modal = {type:'call'}; render(); break;
    case 'call-skip': if (S.callMode) S.callMode.skipped = [...(S.callMode.skipped || []), d.id]; render(); break;
    case 'tip-done': try { localStorage.setItem('lcc-tip3-done', '1'); } catch(e) {} render(); break;
    case 'event-new': handle('add-open', el, ev); break;
    case 'event-edit': clearDrafts('ev-'); clearDrafts('ad-'); S.confirm = null; S.modal = {type:'event', id:d.id}; render(); break;
    case 'sched-open': S.openItem = null; S.confirm = null; S.modal = {type:'sched', date:d.date || (S.view === 'today' && S.day) || t}; render(); break;
    case 'add-open': {
      clearDrafts('ev-'); clearDrafts('ad-'); S.confirm = null; S.openItem = null;
      const date = d.date || t;
      S.modal = {type:'add', date, scope:d.scope === 'week' ? 'week' : 'day', days:[dowOf(date)], back:d.back || null};
      render(); if (!coarsePointer()) setTimeout(() => { const b = document.getElementById('ev-title'); if (b) b.focus(); }, 60);
      break;
    }
    case 'add-scope': if (S.modal) { S.modal.scope = d.s === 'week' ? 'week' : 'day'; const ty = S.drafts['ad-type']; if (ty && !ITEM_TYPES.some(([v, , only]) => v === ty && (!only || only === S.modal.scope))) delete S.drafts['ad-type']; } render(); break;
    case 'ad-day': case 'be-day': if (S.modal) { const cur = S.modal.days && S.modal.days.length ? S.modal.days : [dowOf(S.modal.date || t)]; S.modal.days = cur.includes(d.d) ? cur.filter(x => x !== d.d) : [...cur, d.d]; if (S.confirm === 'be-del') S.confirm = null; } render(); break;
    case 'toggle-draft': S.drafts[d.k] = !(d.v === '1'); render(); break;
    case 'move-scope': if (S.modal) S.modal.scope = d.s === 'week' ? 'week' : 'day'; render(); break;
    case 'move-by': moveBy(d.date || t, d.key, Number(d.m) || 0, d.scope || (S.modal && S.modal.type === 'block' && S.modal.scope) || 'day'); S.openItem = null; render(); break;
    case 'move-reset': resetMove(d.date || t, d.key); render(); break;
    case 'block-edit': { clearDrafts('be-'); clearDrafts('ad-'); S.confirm = null; const date = d.date || t; S.modal = {type:'blockedit', key:d.key, date, days:[dowOf(date)], back:(S.modal && S.modal.back) || null}; render(); break; }
    case 'block-remove': {
      const m = S.modal || {}, date = m.date || t, sel = m.days && m.days.length ? m.days : [dowOf(date)];
      const name = itemName(templateItem(dowOf(date), m.key) || {tag:'It'});
      const changes = {}, prev = {}; let n = 0;
      sel.forEach(x => { prev[x] = templateDay(x); changes[x] = templateDay(x).filter(y => y.key !== m.key); if (changes[x].length !== prev[x].length) n++; });
      if (n) { patchDoc('config', 'schedule', {days:changes}); S.lastUndo = {type:'restore', ops:[{patch:['config', 'schedule', {days:prev}]}]}; }
      clearDrafts('be-'); clearDrafts('ad-'); S.confirm = null;
      S.modal = m.back === 'sched' ? {type:'sched', date} : null;
      toast(n ? `Removed ${name} from ${daysLabel(sel)}.` : 'Nothing to remove on those days.', !!n); render(); break;
    }
    case 'event-delete': delDoc('events', d.id); closeModal(); toast('Event deleted.'); render(); break;
    case 'event-ics': exportEvent(d.id); toast('Calendar file saved. Open it to add the event.'); break;
    case 'ask': S.modal = {type:'chat'}; S.chatErr = null; render(); chatScroll(); if (!S.assist || S.assist.fn !== 'ok') assistantCheck(true); setTimeout(() => { const b = document.getElementById('chat-in'); if (b && !coarsePointer()) b.focus(); }, 60); break;
    case 'chat-suggest': if (/[:：]\s*$/.test(d.text)) { S.drafts['chat-in'] = d.text; render(); setTimeout(() => { const b = document.getElementById('chat-in'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 30); } else askAssistant(d.text); break;
    case 'chat-clear': setDoc('chat', 'main', {messages:[]}); S.chatErr = null; render(); break;
    case 'chat-mic': chatMic(); break;
    case 'assistant-setup': S.modal = {type:'assist'}; render(); if (!S.assist) assistantCheck(); break;
    case 'assistant-check': assistantCheck(); break;
    case 'copy-assistant': navigator.clipboard.writeText(ASSISTANT_FN).then(() => toast('Function code copied. Paste it into the Supabase editor.'), () => toast("Couldn't copy. Open supabase/functions/assistant/index.ts in the repo instead.")); break;
    case 'undo': undo(); render(); break;
    case 'fresh-start': clearDrafts('fs-'); S.modal = {type:'fresh'}; render(); break;
    case 'block': {
      const prev = S.modal; S.openItem = null; S.confirm = null;
      S.modal = {type:'block', key:d.key, date:d.date || t, scope:'day', back:d.back || (prev && ['sched','catchup','week'].includes(prev.type) ? prev.type : prev && ['block','blockedit'].includes(prev.type) ? prev.back : null) || null};
      render(); break;
    }
    case 'task-open': clearDrafts('tk-'); S.confirm = null; S.modal = {type:'task', id:d.id}; render(); break;
    case 'task-delete': delDoc('tasks', d.id); S.modal = null; S.confirm = null; toast('Deleted.'); render(); break;
    case 'mile': S.modal = {type:'mile', id:d.id}; render(); break;
    case 'stat': S.modal = {type:'stat', id:d.id}; render(); break;
    case 'calendar': { const sub = pushDoc(); const lead = sub && sub.lead !== undefined ? Number(sub.lead) : 5; exportCalendar(lead); toast('Calendar file saved. Open it and add it to your calendar.'); break; }
    case 'notif-setup': S.modal = {type:'notif'}; render(); if (!S.notif) notifCheck(); break;
    case 'notif-check': notifCheck(); break;
    case 'notif-enable': notifEnable(); break;
    case 'notif-off': notifOff(); break;
    case 'notif-test': notifTest(); break;
    case 'copy-fn': { const code = REMINDERS_FN; navigator.clipboard.writeText(code).then(() => toast('Function code copied. Paste it into the Supabase editor.'), () => toast("Couldn't copy. Open supabase/functions/reminders/index.ts in the repo instead.")); break; }
    case 'copy-sql': { const sql = CRON_SQL.replace(/YOUR-PROJECT-REF/g, projectRef()); navigator.clipboard.writeText(sql).then(() => toast('SQL copied. Run it in the Supabase SQL Editor.'), () => toast("Couldn't copy. Open supabase/functions/reminders/cron.sql in the repo instead.")); break; }
    case 'fs-sunday': { const cur = S.drafts['fs-sunday'] !== undefined ? S.drafts['fs-sunday'] : true; S.drafts['fs-sunday'] = !cur; render(); break; }
    case 'export': exportBackup(); break;
    case 'signout': signOut(); break;
    case 'retry': S.dbState = 'ok'; S.err = null; render(); if (db) db.refresh().catch(e => { S.dbState = 'error'; S.err = e && e.message; render(); }); break;
    case 'sync-now': if (db) { toast('Syncing…'); db.refresh().then(() => toast(db.status().pending ? "Still offline. Your changes are saved on this device and will send when you're back online." : 'Up to date.')).catch(() => toast("Couldn't reach the server. Your changes are saved on this device.")); } break;
    case 'install': { const e = S.installEvt; if (!e) break; S.installEvt = null; render(); e.prompt(); e.userChoice.then(r => { if (!r || r.outcome !== 'accepted') { S.installEvt = e; render(); } }).catch(() => {}); break; }
    case 'install-dismiss': S.installDismissed = true; try { localStorage.setItem('lcc-install-dismissed', '1'); } catch(e) {} render(); break;
    case 'goto-settings': setView('plan'); setTimeout(() => { const el = document.getElementById('settings'); if (el) el.scrollIntoView({behavior:'smooth', block:'start'}); }, 60); break;
    case 'theme': theme = THEMES.includes(d.t) ? d.t : 'auto'; applyTheme(); render(); break;
    case 'update-app': if (S.updateApp) { S.toast = null; renderToast(); S.updateApp(); } break;
    case 'toast-close': S.toast = null; renderToast(); break;
    case 'show-canceled': S.showCanceled = !S.showCanceled; render(); break;
    case 'quick-open': S.openItem = null; S.confirm = null; S.modal = {type:'quick', date:d.date || (S.view === 'today' && S.day) || null}; render(); setTimeout(() => { const b = document.getElementById('qa-in'); if (b) b.focus(); }, 60); break;
    case 'quick-example': S.drafts['qa-in'] = d.text; render(); setTimeout(() => { const b = document.getElementById('qa-in'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 30); break;
    case 'quick-more': { const txt = String(S.drafts['qa-in'] || '').trim(), qd = (S.modal && S.modal.date) || t; clearDrafts('qa-'); quickToForm(txt ? quickPlan(txt, qd) : {kind:'oneoff', type:'event', title:'', date:qd}); render(); break; }
    case 'quick-as-task': {
      const src = d.src, txt = String(S.drafts[src] || (document.getElementById(src) || {}).value || '').trim(); if (!txt) break;
      const fb = src === 'qa-in' ? ((S.modal && S.modal.date) || t) : (S.drafts[src.replace('-title', '-date')] || (document.getElementById(src.replace('-title', '-date')) || {}).value || t);
      const q = quickPlan(txt, fb);
      const msg = addQuick({kind:'task', title:txt.charAt(0).toUpperCase() + txt.slice(1), date:q.kind === 'task' ? q.date : fb, area:q.area});
      clearDrafts(src.replace(/-(title|in)$/, '-')); if (src === 'qa-in') S.modal = null;
      toast(msg, true); render(); break;
    }
    case 'spread': { const r = spreadTasks(t); if (r) toast(`Kept the 5 most important for today and spread ${plural(r.n, 'to-do')} over ${fmtDay(r.first)} to ${fmtDay(r.last)}.`, true); render(); break; }
    case 'day-off': {
      const date = d.date || t, on = d.on === '1', prev = !!dayOf(date).off, word = dayWord(date);
      S.lastUndo = {type:'restore', ops:[{patch:['days', date, {off:prev}]}]};
      patchDay(date, {off:on});
      if (on && S.modal && S.modal.type === 'catchup') S.modal = null;
      const Word = word.charAt(0).toUpperCase() + word.slice(1);
      toast(on ? `${Word} is a day off. Nothing is late and nothing turns into a make-up.` : `${Word} counts again.`, true); render(); break;
    }
    case 'day-go': {
      S.day = d.date && d.date > t ? d.date : null; S.openItem = null; S.swipeKey = null; clearDrafts('qd-');
      if (S.view !== 'today' || S.modal) setView('today'); else { render(); window.scrollTo(0, 0); }
      break;
    }
    case 'week-open': S.openItem = null; S.confirm = null; S.modal = {type:'week', offset:0}; render(); break;
    case 'week-shift': if (S.modal) S.modal.offset = Math.max(0, (S.modal.offset || 0) + Number(d.d)); render(); break;
    case 'build-open': {
      const date = d.date && d.date >= t ? d.date : (S.view === 'today' && S.day) || t;
      S.openItem = null; S.confirm = null; if (!S.modal || S.modal.type !== 'build') clearDrafts('bd-');
      S.modal = {type:'build', date, step:'input'}; render();
      if (!coarsePointer()) setTimeout(() => { const b = document.getElementById('bd-in'); if (b) b.focus(); }, 60);
      break;
    }
    case 'build-date': if (S.modal) { S.modal.date = d.date; S.modal.step = 'input'; } render(); break;
    case 'build-back': if (S.modal) S.modal.step = 'input'; render(); setTimeout(() => { const b = document.getElementById('bd-in'); if (b && !coarsePointer()) b.focus(); }, 60); break;
    case 'build-apply': {
      const date = d.date || (S.modal && S.modal.date) || t, r = applyBuild(date), bits = buildSummary(r, ', ');
      clearDrafts('bd-'); S.modal = null; S.showCanceled = false;
      if (date !== t) S.day = date;
      if (S.view !== 'today') setView('today');
      toast(`${date === t ? 'Your day is' : dayWord(date).replace(/^./, c => c.toUpperCase()) + ' is'} rebuilt${bits ? ': ' + bits : ''}.`, true); render(); break;
    }
    case 'fresh-tomorrow': {
      const tm = addDays(t, 1), r = applyFreshStart(tm, false);
      patchDay(t, {off:true}); S.modal = null; S.lastUndo = null;
      toast(`Fresh start tomorrow, ${fmtDay(tm)}. Today is a day off. ${plural(r.moved, 'to-do')} and ${plural(r.leadsMoved, 'follow-up')} moved there.`); render(); break;
    }
    /* email */
    case 'em-setup': S.confirm = null; S.modal = {type:'em-setup'}; render(); outreachCheck(true); break;
    case 'em-check': outreachCheck(); break;
    case 'em-copy-fn': navigator.clipboard.writeText(OUTREACH_FN).then(() => toast('Function code copied. Paste it into the Supabase editor.'), () => toast("Couldn't copy. Open supabase/functions/outreach/index.ts in the repo instead.")); break;
    case 'em-copy-sql': navigator.clipboard.writeText(OUTREACH_CRON.replace(/YOUR-PROJECT-REF/g, projectRef())).then(() => toast('SQL copied. Run it in the Supabase SQL Editor.'), () => toast("Couldn't copy. Open supabase/functions/outreach/cron.sql in the repo instead.")); break;
    case 'em-settings': clearDrafts('es-'); S.confirm = null; S.modal = {type:'em-settings', days:emSettings().days.slice()}; render(); break;
    case 'es-day': if (S.modal) { const cur = S.modal.days || emSettings().days; S.modal.days = cur.includes(d.d) ? cur.filter(x => x !== d.d) : [...cur, d.d]; } render(); break;
    case 'em-import': S.confirm = null; S.emImport = null; S.modal = {type:'em-import', campaign:d.campaign || 'auto'}; render(); break;
    case 'ei-camp': if (S.modal) S.modal.campaign = d.k; render(); break;
    case 'ei-clear': S.emImport = null; render(); break;
    case 'ei-read': {
      const txt = String(S.drafts['ei-paste'] || (document.getElementById('ei-paste') || {}).value || '');
      const rows = parseCSV(txt);
      if (!rows.length) { toast('Paste the header row too, like business, email, type.'); break; }
      S.emImport = {name:'Pasted rows', rows}; clearDrafts('ei-'); render(); break;
    }
    case 'ei-add': {
      const imp = S.emImport; if (!imp) break;
      const r = importLeads(imp.rows, {campaign:(S.modal && S.modal.campaign) || 'auto', leads:S.data.leads || {}, suppressed:emSuppressed(), now:Date.now(), today:t});
      const create = r.create.filter(x => !S.data.leads[x.id]), update = r.update.filter(x => S.data.leads[x.id]);
      if (!create.length && !update.length) { toast('Nothing new to add.'); break; }
      const ops = [];
      create.forEach(x => { setDoc('leads', x.id, x.doc); ops.push({del:['leads', x.id]}); });
      update.forEach(x => { ops.push({patch:['leads', x.id, backOf(S.data.leads[x.id], x.patch)]}); patchDoc('leads', x.id, {...x.patch, updatedAt:Date.now()}); });
      S.lastUndo = {type:'restore', ops};
      const enrolled = update.filter(x => x.enroll).length;
      S.emImport = null; S.modal = null; S.emFilter = 'all'; S.emCamp = 'all'; S.emSearch = '';
      toast(`Added ${plural(create.length, 'lead')}${enrolled ? `, and ${enrolled} already in your pipeline get the email` : ''}.${r.held ? ` ${r.held} wait for you under Check first.` : ''}`, true); render(); break;
    }
    case 'em-review': { const c = emCampaigns().find(x => !x.reviewed) || emCampaigns()[0]; if (c) handle('em-campaign', {dataset:{id:c.id}}, ev); break; }
    case 'em-campaign': clearDrafts('ec-'); S.confirm = null; S.modal = {type:'em-campaign', id:d.id, n:0, seg:null}; render(); break;
    case 'ec-step': if (S.modal) S.modal.n = Number(d.n) || 0; render(); break;
    case 'ec-seg': if (S.modal) S.modal.seg = d.k; render(); break;
    case 'ec-approve': {
      const id = S.modal && S.modal.id, prev = id && S.data.campaigns[id]; if (!prev) break;
      const c = emClean(emDraftCampaign(id)), why = emCampaignProblem(c);
      if (why) { toast(why); break; }
      setDoc('campaigns', id, {...c, reviewed:true, reviewedAt:Date.now(), status:'running', updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{set:['campaigns', id, clone(prev)]}]};
      clearDrafts('ec-'); closeModal();
      toast(`${c.name} is approved and on. ${emSettings().enabled ? 'Its emails join the line now.' : 'Tap Start sending when you are ready.'}`, true); render(); break;
    }
    case 'ec-reset': {
      const id = S.modal && S.modal.id, prev = id && S.data.campaigns[id]; if (!prev || !DEFAULT_CAMPAIGNS[id]) break;
      setDoc('campaigns', id, {...clone(DEFAULT_CAMPAIGNS[id]), createdAt:prev.createdAt || Date.now(), updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{set:['campaigns', id, clone(prev)]}]};
      clearDrafts('ec-'); S.confirm = null; toast('Back to the original wording. It needs your OK again before it sends.', true); render(); break;
    }
    case 'em-test': {
      const id = d.id; if (!id) break;
      if (S.modal && S.modal.type === 'em-campaign' && S.modal.id === id) {
        const stored = S.data.campaigns[id], c = emDraftCampaign(id);
        if (stored && emEditable(c) !== emEditable(stored)) { setDoc('campaigns', id, {...emClean(c), updatedAt:Date.now()}); clearDrafts('ec-'); }
      }
      emTest(id); break;
    }
    case 'em-camp-toggle': {
      const c = S.data.campaigns[d.id]; if (!c) break;
      if (!c.reviewed) { handle('em-campaign', el, ev); toast('Read it and approve it first.'); break; }
      const on = c.status !== 'running';
      patchDoc('campaigns', d.id, {status:on ? 'running' : 'paused'});
      S.lastUndo = {type:'restore', ops:[{patch:['campaigns', d.id, {status:c.status || 'paused'}]}]};
      toast(on ? `${c.name} is on.${emSettings().enabled ? '' : ' Sending is still paused overall.'}` : `${c.name} is paused. Follow-ups wait too.`, true); render(); break;
    }
    case 'em-camp-filter': S.emCamp = d.id || 'all'; S.emFilter = 'all'; S.emLimit = 40; render(); if (d.go) setTimeout(() => { const x = document.getElementById('em-contacts'); if (x) x.scrollIntoView({behavior:'smooth', block:'start'}); }, 30); break;
    case 'em-filter': S.emFilter = d.f; S.emLimit = 40; render(); break;
    case 'em-more': S.emLimit = (S.emLimit || 40) + 60; render(); break;
    case 'em-rfilter': S.emReplies = d.f; S.emRLimit = 25; render(); break;
    case 'em-rmore': S.emRLimit = (S.emRLimit || 25) + 50; render(); break;
    case 'em-bulk': {
      const f = EM_FILTERS.find(x => x[0] === S.emFilter), q = S.emSearch.trim().toLowerCase(); if (!f) break;
      const ids = emLeads().filter(l => (S.emCamp === 'all' || l.seq.campaign === S.emCamp) && f[2](l) && (!q || [l.name, l.email, l.city, l.state, l.kind, l.business, l.firstName].join(' ').toLowerCase().includes(q))).map(l => l.id);
      const n = emSetStatus(ids, d.op);
      toast(n ? `${d.op === 'queue' ? 'Queued' : d.op === 'pause' ? 'Paused' : 'Resumed'} ${plural(n, 'lead')}.` : 'Nothing to change.', !!n); render(); break;
    }
    case 'em-status': {
      const l = S.data.leads[d.id]; if (!l) break;
      const n = emSetStatus([d.id], d.op), nm = l.name || l.email;
      if (n) toast(d.op === 'queue' ? `${nm} is in line.` : d.op === 'pause' ? `Emails to ${nm} are paused.` : d.op === 'resume' ? `Emails to ${nm} are back on.` : `${nm} won't be emailed again.`, true);
      render(); break;
    }
    case 'em-stuck': {
      const l = S.data.leads[d.id], q = l && l.seq; if (!q || q.sendingStep == null) break;
      const went = d.went === '1';
      const seq = went ? {sendingStep:null, sendingAt:null, step:Number(q.sendingStep) + 1, status:'done', nextOn:null, lastAt:q.sendingAt || new Date().toISOString()} : {sendingStep:null, sendingAt:null};
      const patch = {seq, ...(went && (l.stage || 'New lead') === 'New lead' ? stagePatch(l, 'Contacted', 'email', Date.now()) : {})};
      S.lastUndo = {type:'restore', ops:[{patch:['leads', d.id, backOf(l, patch)]}]};
      patchDoc('leads', d.id, {...patch, updatedAt:Date.now()});
      toast(went ? 'Marked as sent. No more emails to them.' : 'It goes out again on the next run.', true); render(); break;
    }
    case 'em-done': {
      const r = S.data.replies[d.id]; if (!r) break;
      patchDoc('replies', d.id, {handled:true, handledAt:Date.now()}); S.lastUndo = {type:'restore', ops:[{patch:['replies', d.id, {handled:false}]}]};
      toast('Off your hot list.', true); render(); break;
    }
    case 'em-finder': clearDrafts('ef-'); S.confirm = null; S.modal = {type:'em-finder'}; render(); break;
    case 'em-finder-toggle': {
      const f = emSettings().finder, on = !f.enabled;
      if (on && !Object.values(f.targets || {}).some(x => x && x.on)) { handle('em-finder', el, ev); toast('Pick a campaign to find leads for first.'); break; }
      patchDoc('outreach', 'settings', {finder:{enabled:on}, updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{patch:['outreach', 'settings', {finder:{enabled:!on}}]}]};
      toast(on ? (emEngineOk() ? `The finder is on: up to ${f.perDay} new leads a day, ${dollars(f.budget)} a day at most.` : 'The finder is on. It starts once the engine is set up (Engine setup).') : 'The finder is paused. Leads it already found stay.', true); render(); break;
    }
    case 'lx-test': emTestBoth(); break;
    case 'em-find-now': emFindNow(); break;
    case 'em-start': case 'em-launch': clearDrafts('lx-'); S.confirm = null; S.modal = {type:'em-launch'}; render(); outreachCheck(true); break;
    // Logan's own tap: approves the two cold campaigns as they read now, saves the address and the finder,
    // and sets sending to start by itself on the day picked. The engine holds every email until then.
    case 'lx-go': {
      const s = emSettings(), ids = LAUNCH_CAMPS.filter(id => (S.data.campaigns || {})[id]);
      const w = launchWrites({campaigns:S.data.campaigns, settings:outDoc('settings'), ids, address:fval('lx-address'), startOn:String(fval('lx-date')), today:todayISO(), find:Object.fromEntries(LAUNCH_CAMPS.map(id => [id, lxFind(id)])), now:Date.now()});
      if (w.error === 'address') { toast('Add the mailing address first. A PO box or virtual mailbox works.'); const a = document.getElementById('lx-address'); if (a) a.focus(); break; }
      if (w.error) { toast('Pick a start day from today on.'); break; }
      const bad = ids.map(id => [S.data.campaigns[id], emCampaignProblem(emClean(S.data.campaigns[id]))]).find(([, why]) => why);
      if (bad) { toast(`${bad[0].name}: ${bad[1]}`); break; }
      Object.entries(w.campaigns).forEach(([id, doc]) => setDoc('campaigns', id, doc));
      patchDoc('outreach', 'settings', w.settings);
      S.lastUndo = {type:'restore', ops:w.undo}; clearDrafts('lx-'); closeModal();
      const eng = S.outEng || {}, ready = eng.fn === 'ok' && (eng.version || 1) >= OUTREACH_V && eng.gmail && eng.gmail.ok;
      toast(`Approved. Sending starts ${dayWord(w.settings.startOn)} at ${fmtTap(s.start)} in each business's own time.${w.finderOn ? ' The finder starts looking for leads now.' : ''}${ready ? '' : ' Finish Engine setup before then.'}`, true); render(); break;
    }
    case 'em-pause': {
      const cur = outDoc('settings') || {};
      patchDoc('outreach', 'settings', {enabled:false, autoStart:false, updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{patch:['outreach', 'settings', {enabled:!!cur.enabled, autoStart:!!cur.autoStart}]}]};
      toast('Paused. Nothing more goes out until you start again. Replies still get read.', true); render(); break;
    }
    case 'goto-email': S.toast = null; renderToast(); setView('email'); break;
    case 'disconnect': if (confirm('Disconnect this device from your Supabase project? You will need to paste the URL and key again.')) { clearConfig(); if (db) db.destroy({wipe:true}); Promise.resolve(supabase && supabase.auth.signOut()).catch(() => {}).then(() => location.reload()); } break;
  }
}
function submit(form) {
  const t = todayISO(), kind = form.dataset.form, v = id => (S.drafts[id] !== undefined ? S.drafts[id] : (document.getElementById(id) || {}).value || '');
  switch (kind) {
    case 'login': {
      const email = String(v('lg-email')).trim(), password = (document.getElementById('lg-pass') || {}).value || v('lg-pass') || '';
      if (!email || !password) { S.loginErr = 'Enter your email and password.'; render(); return; }
      S.loginBusy = true; S.loginErr = null; render();
      supabase.auth.signInWithPassword({email, password}).then(({error}) => {
        S.loginBusy = false;
        if (error) { S.loginErr = /invalid login/i.test(error.message) ? 'Wrong email or password.' : error.message; render(); return; }
        try { localStorage.setItem('lcc-email', email); } catch(e) {}
        clearDrafts('lg-');
      }).catch(() => { S.loginBusy = false; S.loginErr = "Couldn't reach the server. Check your connection and try again."; render(); });
      break;
    }
    case 'connect': {
      const url = String(v('cn-url')).trim().replace(/\/+$/, ''), key = String(v('cn-key')).trim();
      if (!/^https:\/\/[^\s/]+$/.test(url)) { S.connectErr = 'The URL should look like https://abcdefgh.supabase.co'; render(); return; }
      if (key.length < 20) { S.connectErr = 'Paste the whole publishable (anon) key.'; render(); return; }
      S.connectBusy = true; S.connectErr = null; render();
      fetch(url + '/auth/v1/settings', {headers:{apikey:key}}).then(r => {
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'That key was not accepted. Copy the publishable (anon) key again.' : `That URL did not answer like a Supabase project (HTTP ${r.status}).`);
        saveConfig(url, key); clearDrafts('cn-'); location.reload();
      }).catch(e => { S.connectBusy = false; S.connectErr = (e && e.message) || "Couldn't reach that URL."; render(); });
      break;
    }
    case 'build': {
      if (!S.modal) return;
      S.modal.step = 'preview'; render(); break;
    }
    case 'task': {
      const p = form.dataset.p, text = String(v(p + '-title')).trim(), fallback = v(p + '-date') || t;
      if (!text) { toast('Type something first.'); return; }
      const q = quickPlan(text, fallback);
      if (q.kind === 'weekly' && !q.start) { clearDrafts(p + '-'); quickToForm(q); toast('Pick a time for it.'); render(); return; }
      const msg = addQuick(q); clearDrafts(p + '-'); toast(msg, true); render(); break;
    }
    case 'quick': {
      const text = String(v('qa-in')).trim();
      if (!text) { toast('Type something first.'); return; }
      const q = quickPlan(text, (S.modal && S.modal.date) || t);
      clearDrafts('qa-');
      if (q.kind === 'weekly' && !q.start) { quickToForm(q); toast('Pick a time for it.'); render(); return; }
      const msg = addQuick(q); S.modal = null; toast(msg, true); render(); break;
    }
    case 'am': {
      const old = (dayOf(t).am || {}).top3 || [];
      const top3 = [1,2,3].map((n,i) => { const txt = String(v('am-t' + n)).trim(); return {t:txt, done: !!(old[i] && old[i].t === txt && old[i].done)}; });
      patchDay(t, {am:{weight:num(v('am-weight')), sleep:num(v('am-sleep')), energy:num(S.drafts['am-energy'] ?? (dayOf(t).am || {}).energy), top3, note:String(v('am-note')).trim(), savedAt:new Date().toISOString()}});
      S.editAM = false; clearDrafts('am-'); toast('Check-in saved. Go get it.'); render(); break;
    }
    case 'pm': {
      const pm = dayOf(t).pm || {};
      const fix = String(v('pm-fix')).trim();
      const prot = S.drafts['pm-protein'] !== undefined ? S.drafts['pm-protein'] : !!pm.protein;
      patchDay(t, {pm:{proposals:num(v('pm-proposals')), deals:num(v('pm-deals')), cash:num(v('pm-cash')), mockups:num(v('pm-mockups')), dms:num(v('pm-dms')), proExtra:num(v('pm-pro')), protein:!!prot,
        win:String(v('pm-win')).trim(), fix, biz:String(v('pm-biz')).trim(), pb:String(v('pm-pb')).trim(), savedAt:new Date().toISOString()}});
      const fid = 'fix-' + t, existing = S.data.tasks[fid];
      if (fix) { if (existing) patchDoc('tasks', fid, {title:'Fix: ' + fix}); else setDoc('tasks', fid, {title:'Fix: ' + fix, due:addDays(t,1), origDue:addDays(t,1), area:'Fix', kind:'fix', done:false, createdAt:Date.now()}); }
      else if (existing && !existing.done) delDoc('tasks', fid);
      S.editPM = false; clearDrafts('pm-'); toast(fix ? 'Checked out. Your fix is on tomorrow\'s list.' : 'Checked out. Nice work.'); render(); break;
    }
    case 'lead-talked': case 'lead-demo': {
      const id = form.dataset.id;
      if (kind === 'lead-demo') outcome(id, 'demo', {date:v('lf-date') || nextWeekday(t), time:String(v('lf-time')).trim(), note:String(v('lf-note')).trim()});
      else outcome(id, 'talked', {step:String(v('lf-step')).trim() || 'Follow up', date:v('lf-date') || addDays(t,3), note:String(v('lf-note')).trim()});
      break;
    }
    case 'lead-edit': {
      const m = S.modal, id = m.id, l = S.data.leads[id], isNew = !l;
      const name = String(v('le-name')).trim(); if (!name) { toast('Add the business name first.'); return; }
      const email = String(v('le-email')).trim().toLowerCase();
      if (email && !isEmail(email)) { toast("That email doesn't look right."); return; }
      const dup = email && allLeads().find(x => x.id !== id && String(x.email || '').toLowerCase() === email);
      if (dup) { toast(`${dup.name || 'Another lead'} already has that email.`); return; }
      const calls = S.drafts['le-calls'] !== undefined ? !!S.drafts['le-calls'] : (isNew || l.callList !== false);
      const body = {name, business:String(v('le-business')).trim(), contact:String(v('le-contact')).trim(), phone:String(v('le-phone')).trim(), website:String(v('le-website')).trim(),
        email, firstName:String(v('le-firstName')).trim(), type:v('le-type') || 'Cold', region:v('le-region'), nextStep:String(v('le-nextStep')).trim(), nextDate:v('le-nextDate'),
        deal:num(v('le-deal')), monthly:num(v('le-monthly')), collected:num(v('le-collected')), notes:String(v('le-notes')).trim(), callList:calls};
      const stage = STAGES.includes(v('le-stage')) ? v('le-stage') : 'New lead';
      if (isNew) {
        const now = Date.now();
        if (!body.nextStep && body.type === 'Cold') body.nextStep = body.region === 'IA' ? 'Call: block 1 (Iowa)' : body.region === 'AZ' ? 'Call: block 2 (Arizona)' : 'Call';
        if (!body.nextDate) body.nextDate = t;
        setDoc('leads', id, {...body, stage, stageAt:now, history:[{at:now, from:'', to:stage, by:'manual'}], source:'Manual', touches:0, createdAt:now, updatedAt:now});
        S.lastUndo = {type:'restore', ops:[{del:['leads', id]}]};
        toast('Lead added.', true);
      } else {
        // Only the fields you changed, so what the engine wrote meanwhile (a sent email, a reply) stays.
        const patch = {};
        for (const [k, x] of Object.entries(body)) if (JSON.stringify(x ?? '') !== JSON.stringify(l[k] ?? '')) patch[k] = x;
        if (patch.email !== undefined && l.emailBad) patch.emailBad = false;
        Object.assign(patch, stagePatch(l, stage, 'you', Date.now()));
        if (!Object.keys(patch).length) { toast('Nothing changed.'); leadEditDone(m); render(); return; }
        S.lastUndo = {type:'restore', ops:[{patch:['leads', id, backOf(l, patch)]}]};
        patchDoc('leads', id, {...patch, updatedAt:Date.now()});
        toast(patch.seq && patch.seq.status === 'stopped' ? 'Saved. Its emails stopped.' : 'Lead saved.', true);
      }
      clearDrafts('le-'); leadEditDone(m); render(); break;
    }
    case 'session': {
      const id = S.modal.id, s = S.data.sessions[id] || {};
      const rated = S.drafts['ss-rated'] !== undefined ? S.drafts['ss-rated'] : !!s.rated;
      setDoc('sessions', id, {...s, date:v('ss-date') || t, type:v('ss-type') || 'Drill', hours:num(v('ss-hours')), games:num(v('ss-games')), won:num(v('ss-won')), rated:!!rated,
        partner:String(v('ss-partner')).trim(), opponents:String(v('ss-opponents')).trim(), wentWell:String(v('ss-wentWell')).trim(), workOn:String(v('ss-workOn')).trim(), notes:String(v('ss-notes')).trim(), updatedAt:Date.now()});
      S.modal = null; clearDrafts('ss-'); toast('Session saved.'); render(); break;
    }
    case 'dupr': {
      const r = num(v('dupr-in')); if (!r || r < 1 || r > 8) { toast('Type a DUPR like 4.912.'); return; }
      setDoc('dupr', t, {date:t, rating:r}); clearDrafts('dupr-'); toast('DUPR saved.'); render(); break;
    }
    case 'goal': { const g = num(v('goal-in')); if (!g) { toast('Type a goal weight.'); return; } patchDoc('config', 'profile', {goalWeight:g}); clearDrafts('goal-'); toast('Goal saved.'); render(); break; }
    case 'money': {
      const sc = num(v('mn-sc')), tx = num(v('mn-tx')), m = cfg().money || {};
      const hist = (m.history || []).filter(h => h.date !== t).concat([{date:t, scottsdale:sc, taxes:tx}]);
      patchDoc('config', 'money', {scottsdale:sc, taxes:tx, updated:t, history:hist}); clearDrafts('mn-'); toast('Balances saved.'); render(); break;
    }
    case 'fresh': {
      const date = v('fs-date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a start date.'); return; }
      const sun = S.drafts['fs-sunday'] !== undefined ? S.drafts['fs-sunday'] : true;
      const {moved, dropped, leadsMoved} = applyFreshStart(date, sun);
      S.modal = null; clearDrafts('fs-');
      toast(`Fresh start on ${fmtDay(date)}. ${plural(moved,'to-do')} and ${plural(leadsMoved,'follow-up')} moved, ${plural(dropped,'make-up')} dropped.`); render(); break;
    }
    case 'event-edit': {
      const id = form.dataset.id, old = (S.data.events || {})[id] || {};
      const title = String(v('ev-title')).trim(), date = v('ev-date'), start = v('ev-start'), end = v('ev-end');
      if (!title) { toast('Give it a name first.'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date.'); return; }
      if (!isHM(start)) { toast('Pick a start time.'); return; }
      if (isHM(end) && toMin(end) < toMin(start)) { toast('The end is before the start.'); return; }
      const ty = splitType(v('ad-type') || 'event');
      const doc = {...old, title, date, start, end:isHM(end) ? end : '', where:String(v('ev-where')).trim(), notes:String(v('ev-notes')).trim(), createdAt:old.createdAt || Date.now(), updatedAt:Date.now()};
      delete doc.kind; delete doc.sessionType;
      if (ty.kind !== 'event') { doc.kind = ty.kind; if (ty.sessionType) doc.sessionType = ty.sessionType; }
      S.lastUndo = old.title ? {type:'restore', ops:[{set:['events', id, clone(old)]}]} : {type:'restore', ops:[{del:['events', id]}]};
      setDoc('events', id, doc);
      closeModal(); clearDrafts('ev-'); clearDrafts('ad-'); toast(old.title ? 'Saved.' : `Added ${title}, ${dayWord(date)} at ${fmtTap(start)}.`, true); render(); break;
    }
    case 'add': {
      const m = S.modal || {}, scope = m.scope === 'week' ? 'week' : 'day';
      const title = String(v('ev-title')).trim(), start = v('ev-start'), endIn = v('ev-end');
      if (!title) { toast('Give it a name first.'); return; }
      if (!isHM(start)) { toast('Pick a start time.'); return; }
      if (isHM(endIn) && toMin(endIn) < toMin(start)) { toast('The end is before the start.'); return; }
      const end = isHM(endIn) ? endIn : hhmm(Math.min(toMin(start) + 60, 24*60 - 1));
      const ty = splitType(v('ad-type') || (scope === 'day' ? 'event' : 'task'));
      const back = m.back === 'sched';
      if (scope === 'day') {
        const date = v('ev-date') || m.date || t;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date.'); return; }
        const id = 'ev-' + Date.now().toString(36);
        const doc = {title, date, start, end, where:String(v('ev-where')).trim(), notes:String(v('ev-notes')).trim(), createdAt:Date.now(), updatedAt:Date.now()};
        if (ty.kind !== 'event') { doc.kind = ty.kind; if (ty.sessionType) doc.sessionType = ty.sessionType; }
        if (ty.kind === 'calls') { doc.quota = 10; doc.region = ''; }
        setDoc('events', id, doc);
        S.lastUndo = {type:'restore', ops:[{del:['events', id]}]};
        const over = overlaps(date, start, end, 'ev-' + id);
        clearDrafts('ev-'); clearDrafts('ad-'); S.confirm = null;
        S.modal = back ? {type:'sched', date} : null;
        toast(`Added ${title}, ${dayWord(date)} at ${fmtTap(start)}.${over.length ? ` It overlaps ${listNames(over)}. Tap one to move it.` : ''}`, true);
      } else {
        const sel = m.days && m.days.length ? m.days : [dowOf(m.date || t)];
        const item = {key:'b' + Date.now().toString(36), start, end, tag:title, text:String(v('ev-notes')).trim(), kind:ty.kind};
        if (ty.kind === 'session') { item.sessionType = ty.sessionType; item.hours = Math.round((toMin(end) - toMin(start)) / 30) / 2 || 1; }
        if (ty.kind === 'calls') { item.quota = 10; item.region = ''; }
        if (['mobility','watch'].includes(ty.kind)) item.minutes = Math.max(5, toMin(end) - toMin(start));
        if (carryable(ty.kind) && S.drafts['ad-carry'] === true) item.carry = true;
        const changes = {}, prev = {};
        sel.forEach(x => { prev[x] = templateDay(x); changes[x] = [...templateDay(x), clone(item)].sort(byStart); });
        patchDoc('config', 'schedule', {days:changes});
        S.lastUndo = {type:'restore', ops:[{patch:['config', 'schedule', {days:prev}]}]};
        clearDrafts('ev-'); clearDrafts('ad-'); S.confirm = null;
        S.modal = back ? {type:'sched', date:m.date || t} : null;
        toast(`Added ${title} to ${daysLabel(sel)} at ${fmtTap(start)}.`, true);
      }
      render(); break;
    }
    case 'block-edit': {
      const m = S.modal || {}, date = m.date || t, dow = dowOf(date), ti = templateItem(dow, m.key);
      if (!ti) { closeModal(); render(); return; }
      const sel = m.days && m.days.length ? m.days : [dow];
      const tag = String(v('be-tag')).trim(), text = String(v('be-text')).trim(), start = v('be-start'), endIn = v('be-end');
      if (!tag && !text) { toast('Give it a label or some details.'); return; }
      if (!isHM(start)) { toast('Pick a start time.'); return; }
      if (isHM(endIn) && toMin(endIn) < toMin(start)) { toast('The end is before the start.'); return; }
      const end = isHM(endIn) ? endIn : start;
      const special = ['checkin','checkout','dupr'].includes(ti.kind);
      const ty = special ? {kind:ti.kind, sessionType:ti.sessionType} : splitType(v('ad-type') || typeOf(ti));
      const next = {...ti, tag, text, start, end, kind:ty.kind};
      ['sessionType','hours','quota','region','carry','minutes'].forEach(k => delete next[k]);
      if (ty.kind === 'session') { next.sessionType = ty.sessionType; next.hours = Math.round((toMin(end) - toMin(start)) / 30) / 2 || ti.hours || 1; }
      if (ty.kind === 'calls') { next.quota = Number(v('be-quota')) || ti.quota || 10; next.region = String(v('be-region') || ''); }
      if (['mobility','watch'].includes(ty.kind)) next.minutes = Math.max(5, toMin(end) - toMin(start));
      if (carryable(ty.kind) && (S.drafts['be-carry'] !== undefined ? S.drafts['be-carry'] : !!ti.carry)) next.carry = true;
      // The fields that changed on this day's copy are what every selected day gets.
      const changed = Object.keys({...ti, ...next}).filter(k => JSON.stringify(next[k]) !== JSON.stringify(ti[k]));
      const changes = {}, prev = {};
      sel.forEach(x => {
        prev[x] = templateDay(x);
        const arr = templateDay(x), idx = arr.findIndex(y => y.key === m.key);
        if (idx >= 0) { const y = {...arr[idx]}; changed.forEach(k => { if (next[k] === undefined) delete y[k]; else y[k] = next[k]; }); arr[idx] = y; }
        else arr.push(clone(next));
        changes[x] = arr.sort(byStart);
      });
      patchDoc('config', 'schedule', {days:changes});
      S.lastUndo = {type:'restore', ops:[{patch:['config', 'schedule', {days:prev}]}]};
      clearDrafts('be-'); clearDrafts('ad-'); S.confirm = null;
      S.modal = {type:'block', key:m.key, date, scope:'day', back:m.back || null};
      toast(`Saved for ${daysLabel(sel)}.`, true); render(); break;
    }
    case 'em-campaign': {
      const id = S.modal && S.modal.id, prev = id && S.data.campaigns[id]; if (!prev) return;
      const c = emClean(emDraftCampaign(id));
      if (emEditable(c) === emEditable(prev)) { toast('Saved.'); return; }
      setDoc('campaigns', id, {...c, updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{set:['campaigns', id, clone(prev)]}]};
      clearDrafts('ec-'); const why = prev.reviewed ? emCampaignProblem(c) : '';
      toast(why ? `Saved, but ${why.charAt(0).toLowerCase() + why.slice(1)}` : 'Saved.', true); render(); break;
    }
    case 'em-settings': {
      const address = String(v('es-address')).trim(), fwd = String(v('es-forward')).trim(), start = v('es-start'), end = v('es-end');
      if (fwd && !isEmail(fwd)) { toast("That forwarding address doesn't look right."); return; }
      if (!isHM(start) || !isHM(end) || toMin(end) <= toMin(start)) { toast('The start time has to be before the end time.'); return; }
      const days = (S.modal && S.modal.days) || emSettings().days;
      if (!days.length) { toast('Pick at least one sending day.'); return; }
      const n = (id, lo, hi, def) => { const raw = String(v(id)).trim(), x = Math.round(Number(raw)); return raw !== '' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def; };
      const capMax = n('es-capMax', 1, 200, 50);
      const patch = {address, forwardTo:fwd, fromName:String(v('es-name')).trim() || 'Logan Newman', website:String(v('es-website')).trim(), days:WEEK_ORDER.filter(x => days.includes(x)), start, end,
        capStart:Math.min(capMax, n('es-capStart', 1, 200, 20)), capStep:n('es-capStep', 0, 50, 5), capMax, gap:n('es-gap', 3, 120, 6), tz:EM_TZS.some(z => z[0] === v('es-tz')) ? v('es-tz') : 'America/Chicago'};
      const cur = emSettings(), back = {}; Object.keys(patch).forEach(k => { back[k] = cur[k]; });
      patchDoc('outreach', 'settings', {...patch, updatedAt:Date.now()});
      S.lastUndo = {type:'restore', ops:[{patch:['outreach', 'settings', back]}]};
      clearDrafts('es-'); closeModal(); toast(address ? 'Settings saved.' : 'Saved. Add your mailing address before you start sending.', true); render(); break;
    }
    case 'em-finder': {
      const f = emSettings().finder;
      const n = (id, lo, hi) => { const raw = String(v(id)).trim(), x = Number(raw); return raw !== '' && Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
      const perDay = n('ef-perDay', 1, 500), budget = n('ef-budget', 0.5, 100);
      if (perDay === null) { toast('New leads a day: pick a number from 1 to 500.'); return; }
      if (budget === null) { toast('Spend at most: pick from $0.50 to $100 a day.'); return; }
      const targets = {};
      for (const [cid, tg] of Object.entries(f.targets || {})) {
        const on = S.drafts[`ef-${cid}-on`] !== undefined ? !!S.drafts[`ef-${cid}-on`] : !!tg.on;
        const niches = [...new Set(String(v(`ef-${cid}-niches`)).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];
        const areas = [...new Set(String(v(`ef-${cid}-areas`)).split(/[;\n]+/).map(x => x.trim()).filter(Boolean))];
        const name = ((S.data.campaigns || {})[cid] || DEFAULT_CAMPAIGNS[cid] || {}).name || cid;
        if (on && (!niches.length || !areas.length)) { toast(`Add at least one type of business and one city for ${name}.`); return; }
        targets[cid] = {on, niches:niches.join(', '), areas:areas.join('; ')};
      }
      const model = EM_MODELS.some(m => m[0] === v('ef-model')) ? v('ef-model') : f.model;
      const review = S.drafts['ef-review'] !== undefined ? !!S.drafts['ef-review'] : !!f.review;
      S.lastUndo = {type:'restore', ops:[{patch:['outreach', 'settings', {finder:{perDay:f.perDay, budget:f.budget, model:f.model, review:!!f.review, targets:clone(f.targets)}}]}]};
      patchDoc('outreach', 'settings', {finder:{perDay:Math.round(perDay), budget:Math.round(budget * 100) / 100, model, review, targets}, updatedAt:Date.now()});
      clearDrafts('ef-'); closeModal();
      toast(Object.values(targets).some(x => x.on) ? 'Finder settings saved.' : 'Saved. No campaign is picked, so the finder has nothing to look for.', true); render(); break;
    }
    case 'chat': { const txt = v('chat-in'); askAssistant(txt); break; }
    case 'task-edit': {
      const id = form.dataset.id, x = S.data.tasks[id]; if (!x) { S.modal = null; render(); return; }
      const title = String(v('tk-title')).trim(); if (!title) { toast('Give it a name first.'); return; }
      patchDoc('tasks', id, {title, due:v('tk-due') || x.due, area:v('tk-area') || x.area || 'Other', notes:String(v('tk-notes')).trim()});
      S.modal = null; clearDrafts('tk-'); toast('Saved.'); render(); break;
    }
    case 'review': {
      const ws = form.dataset.ws;
      setDoc('weeks', ws, {...(S.data.weeks[ws] || {}), leak:String(v('rv-leak')).trim(), fix:String(v('rv-fix')).trim(), savedAt:new Date().toISOString()});
      clearDrafts('rv-'); toast('Review saved. The fix shows on next week\'s drills.'); render(); break;
    }
  }
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  // An open swipe row closes on the next tap anywhere outside its buttons.
  const openRow = document.querySelector('.swipe.open');
  if (openRow && !ev.target.closest('.swipe-acts')) {
    closeSwipe();
    if (openRow.contains(ev.target)) { ev.preventDefault(); return; }
  }
  if (Date.now() - swipeEnded < 400 && ev.target.closest('.swipe') && !ev.target.closest('.swipe-acts')) { ev.preventDefault(); return; }
  if (ev.target.closest('.swipe-acts')) S.swipeKey = null;
  const el = ev.target.closest('[data-act]');
  if (!el) { if (ev.target.id === 'modal') { closeModal(); render(); } return; }
  if (el.tagName === 'INPUT') return;
  ev.preventDefault();
  handle(el.dataset.act, el, ev);
  if (!['goto','copy','view','undo','export','signout','retry','sync-now','install','update-app','disconnect','goto-settings','calendar','notif-check','notif-enable','notif-off','notif-test','copy-fn','copy-sql','event-ics','ask','chat-suggest','chat-mic','assistant-setup','assistant-check','copy-assistant','em-check','em-test','em-copy-fn','em-copy-sql','goto-email','lx-test','em-find-now'].includes(el.dataset.act)) render();
});
/* ----- swipe a plan row (touch): left shows +30 min, Reschedule and Cancel; right marks it done ----- */
let sw = null, swipeEnded = 0;
function closeSwipe(except) {
  document.querySelectorAll('.swipe.open').forEach(w => { if (w !== except) w.classList.remove('open'); });
  if (!except || S.swipeKey !== except.dataset.key) S.swipeKey = null;
}
document.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse') return;
  const row = ev.target.closest('.swipe > .row, .swipe > .trow'); if (!row) return;
  const wrap = row.parentElement, cw = parseFloat(getComputedStyle(wrap).getPropertyValue('--acts-w')), w = Number.isFinite(cw) ? cw : 250;
  sw = {row, wrap, key:wrap.dataset.key, id:ev.pointerId, x:ev.clientX, y:ev.clientY, w, base:wrap.classList.contains('open') ? -w : 0, canDone:wrap.dataset.done === '1', active:false, pos:0};
}, {passive:true});
document.addEventListener('pointermove', ev => {
  if (!sw || ev.pointerId !== sw.id) return;
  const dx = ev.clientX - sw.x, dy = ev.clientY - sw.y;
  if (!sw.active) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4) { sw.active = true; sw.row.style.transition = 'none'; closeSwipe(sw.wrap); }
    else if (Math.abs(dy) > 12) { sw = null; return; }
    else return;
  }
  let x = sw.base + dx;
  if (x < -sw.w) x = -sw.w + (x + sw.w) * 0.35; // a little give past the buttons
  x = Math.max(-sw.w - 40, Math.min(sw.canDone ? 130 : 18, x));
  sw.pos = x; sw.row.style.transform = `translateX(${x}px)`;
  sw.wrap.classList.toggle('done-ready', sw.canDone && x >= 76);
}, {passive:true});
function endSwipe(ev) {
  if (!sw || ev.pointerId !== sw.id) return;
  const s = sw; sw = null;
  if (!s.active) return;
  swipeEnded = Date.now();
  s.row.style.transition = ''; s.row.style.transform = ''; s.wrap.classList.remove('done-ready');
  if (ev.type === 'pointerup' && s.canDone && s.pos >= 76) {
    s.wrap.classList.remove('open'); S.swipeKey = null;
    if (s.wrap.dataset.task) taskToggle(s.wrap.dataset.task); else toggleCheck(s.key);
    render(); return;
  }
  const open = s.w > 0 && (ev.type === 'pointerup' ? s.pos <= -s.w / 2 : s.base < 0);
  s.wrap.classList.toggle('open', open);
  s.wrap.querySelectorAll('.swipe-acts button').forEach(b => b.tabIndex = open ? 0 : -1);
  S.swipeKey = open ? s.key : (S.swipeKey === s.key ? null : S.swipeKey);
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
document.addEventListener('submit', ev => { const f = ev.target.closest('form[data-form]'); if (!f) return; ev.preventDefault(); submit(f); });
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'lead-search') { S.search = el.value; const pos = el.selectionStart; render(); const n = document.getElementById('lead-search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch(e) {} } return; }
  if (el.id === 'em-search') { S.emSearch = el.value; S.emLimit = 40; const pos = el.selectionStart; render(); const n = document.getElementById('em-search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch(e) {} } return; }
  if (el.hasAttribute && el.hasAttribute('data-draft') && el.id) S.drafts[el.id] = el.value;
  if (el.hasAttribute && el.hasAttribute('data-emprev')) { const out = document.getElementById('em-preview'); if (out) out.innerHTML = emPreviewHtml(); }
  if (el.hasAttribute && el.hasAttribute('data-build')) {
    const out = document.getElementById(el.id + '-prev'), date = el.dataset.date || todayISO();
    if (out) { const {parsed, r} = buildPlanFor(date, el.value); out.innerHTML = buildChips(parsed, r, date); }
  }
  if (el.hasAttribute && el.hasAttribute('data-quick')) {
    const out = document.getElementById(el.id + '-prev'), fb = el.dataset.fallback ? (document.getElementById(el.dataset.fallback) || {}).value : (el.dataset.date || '');
    if (out) out.innerHTML = el.value.trim() ? quickPreview(quickPlan(el.value, fb), el.id) : (el.id === 'qa-in' ? esc(QUICK_HINT) : '');
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.act === 'move-time') { moveTime(el); render(); return; }
  if (el.id === 'sc-date' && el.value) { S.modal = {type:'sched', date:el.value}; render(); return; }
  if (el.id === 'mv-day' && el.value) { handle('move-day', {dataset:{key:el.dataset.key, date:el.dataset.date, to:el.value}}, ev); return; }
  if (el.hasAttribute && el.hasAttribute('data-rerender')) { S.drafts[el.id] = el.value; render(); return; }
  if (el.id === 'fs-date') { S.drafts['fs-date'] = el.value; render(); return; }
  if (el.id === 'nt-lead') { S.drafts['nt-lead'] = el.value; if (pushDoc()) { patchDoc('push', deviceId(), {lead:Number(el.value), updatedAt:Date.now()}); toast('Saved.'); } return; }
  if (el.id === 'import-file' && el.files && el.files[0]) { importFile(el.files[0]); el.value = ''; return; }
  if (el.id === 'ei-file' && el.files && el.files[0]) { emReadFile(el.files[0]); el.value = ''; return; }
  if (el.id === 'pipe-source') { S.pipeSource = el.value; S.pipeLimit = 50; render(); return; }
  if (el.id === 'pipe-stage') { S.pipeStage = el.value; S.pipeLimit = 50; render(); return; }
  if (el.id === 'pipe-sort') { S.pipeSort = el.value; S.pipeLimit = 50; render(); return; }
  if (el.dataset && el.dataset.relabel) { emRelabel(el.dataset.relabel, el.value); render(); return; }
  if (el.dataset && el.dataset.act === 'task-date' && el.value) { const x = S.data.tasks[el.dataset.id]; if (x) patchDoc('tasks', el.dataset.id, {due:el.value, origDue:x.origDue || x.due}); toast('Moved to ' + fmtDay(el.value) + '.'); return; }
  if (el.hasAttribute && el.hasAttribute('data-draft') && el.id) S.drafts[el.id] = el.value;
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && S.modal) { closeModal(); render(); return; }
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const a = document.activeElement;
  // Cards and rows that act like buttons (a lead on the board, a block's text) open with Enter or Space too.
  if (a && (ev.key === 'Enter' || ev.key === ' ') && a.getAttribute && a.getAttribute('role') === 'button' && a.tagName !== 'BUTTON' && a.dataset && a.dataset.act) { ev.preventDefault(); handle(a.dataset.act, a, ev); render(); return; }
  if (a && a.id === 'chat-in' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); askAssistant(a.value); return; }
  if (a && a.id === 'bd-in' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const f = a.closest('form'); if (f) f.requestSubmit(); return; }
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  if (typing || S.modal || S.dbState !== 'ok' || !allLoaded()) return;
  if (ev.key >= '1' && ev.key <= String(VIEWS.length)) { ev.preventDefault(); setView(VIEWS[+ev.key - 1][0]); }
  else if (ev.key === '/') { ev.preventDefault(); setView('calls'); setTimeout(() => { const s = document.getElementById('lead-search'); if (s) s.focus(); }, 0); }
  else if (ev.key === 'n') { ev.preventDefault(); if (!['today','plan'].includes(S.view)) setView('today'); setTimeout(() => { const f = document.getElementById(S.view === 'plan' ? 'pt-title' : S.day ? 'qd-title' : 'qt-title'); if (f) { f.scrollIntoView({block:'center'}); f.focus(); } }, 0); }
  else if (ev.key === 'c') { ev.preventDefault(); handle('call-start', {dataset:{}}, ev); render(); }
  else if (ev.key === 'e') { ev.preventDefault(); handle('quick-open', {dataset:{}}, ev); }
  else if (ev.key === 's') { ev.preventDefault(); handle('sched-open', {dataset:{}}, ev); }
  else if (ev.key === 'b') { ev.preventDefault(); handle('build-open', {dataset:{}}, ev); }
  else if (ev.key === 'w') { ev.preventDefault(); handle('week-open', {dataset:{}}, ev); }
  else if (ev.key === 'a') { ev.preventDefault(); handle('ask', {dataset:{}}, ev); }
});
// Drag a lead card to another column of the board (laptop). Phones open the lead and tap a stage.
let dragLead = null;
const dropCol = ev => ev.target && ev.target.closest ? ev.target.closest('.pcol[data-stage]') : null;
document.addEventListener('dragstart', ev => {
  const c = ev.target && ev.target.closest ? ev.target.closest('.lcard[data-lead]') : null; if (!c) return;
  dragLead = c.dataset.lead;
  try { ev.dataTransfer.setData('text/x-lcc-lead', dragLead); ev.dataTransfer.effectAllowed = 'move'; } catch(e) {}
  requestAnimationFrame(() => { c.classList.add('dragging'); document.body.classList.add('pipe-drag'); });
});
document.addEventListener('dragend', () => {
  dragLead = null; document.body.classList.remove('pipe-drag');
  document.querySelectorAll('.lcard.dragging, .pcol.over').forEach(x => x.classList.remove('dragging', 'over'));
});
document.addEventListener('dragover', ev => {
  if (!dragLead) return;
  const col = dropCol(ev); if (!col) return;
  ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'move'; } catch(e) {}
  document.querySelectorAll('.pcol.over').forEach(x => { if (x !== col) x.classList.remove('over'); });
  col.classList.add('over');
});
// Drop a backup file anywhere on the page to import it.
const dragHasFiles = ev => !!(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files'));
let dragDepth = 0;
document.addEventListener('dragenter', ev => { if (!db || !dragHasFiles(ev)) return; ev.preventDefault(); dragDepth++; document.body.classList.add('dropping'); });
document.addEventListener('dragover', ev => { if (!db || !dragHasFiles(ev)) return; ev.preventDefault(); });
document.addEventListener('dragleave', ev => { if (!db) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
document.addEventListener('drop', ev => {
  if (!db) return;
  if (dragLead) {
    ev.preventDefault();
    const id = dragLead, col = dropCol(ev); dragLead = null;
    document.body.classList.remove('pipe-drag');
    if (col) { const msg = moveLeadStage(id, col.dataset.stage); if (msg) { S.flash = {key:'lead:' + id, at:Date.now()}; toast(msg, true); } }
    render(); return;
  }
  ev.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!f) return;
  if (/\.(csv|tsv)$/i.test(f.name) || /csv|tab-separated/.test(f.type)) { emReadFile(f); return; }
  if (!/\.json$/i.test(f.name) && f.type !== 'application/json') { toast('Drop a backup .json file or a contacts .csv file.'); return; }
  importFile(f);
});

let lastDate = todayISO();
setInterval(() => {
  const t = todayISO();
  if (t !== lastDate) { lastDate = t; S.editAM = false; S.editPM = false; S.weekOffset = 0; }
  scheduleRender(); maybeRollover();
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleRender(); maybeRollover(); } });

/* ---------- boot ---------- */
function startDb(session) {
  if (db) return;
  S.email = (session.user && session.user.email) || '';
  let lastErr = null;
  db = createDb(supabase, session.user.id, {onStatus: s => {
    S.sync = s;
    if (s.error && s.error !== lastErr) {
      lastErr = s.error;
      toast(/row-level security|permission|policy/i.test(s.error) ? "A change couldn't be saved: this account isn't allowed to write it. Sign in with your own account." : "A change couldn't be saved: " + s.error);
    } else if (!s.error) lastErr = null;
    if (S.dbState === 'ok') { renderHeader(); if (S.view === 'plan' && allLoaded()) scheduleRender(); }
  }});
  S.dbState = 'ok'; S.got = {};
  db.ready.catch(e => { S.dbState = 'error'; S.err = e && e.message; render(); });
  COLS.forEach(c => {
    db.collection(c).onSnapshot(snap => {
      const o = {}; snap.docs.forEach(doc => { o[doc.id] = doc.data(); });
      S.data[c] = o; S.got[c] = true;
      scheduleRender(); maybeRollover();
    }, err => { S.err = err && err.message; S.got[c] = true; scheduleRender(); });
  });
  render();
}
applyTheme();
render();
window.__lcc = { status: () => db && db.status(), state: S, version: APP_VERSION, pushes: [] };
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', ev => {
  const d = ev.data;
  if (!d || d.type !== 'lcc-push') return;
  window.__lcc.pushes.push(d);
  toast(d.title + (d.body ? ' · ' + d.body : ''), false, /#email/.test(d.url || '') && S.view !== 'email' ? {act:'goto-email', label:'Open'} : null);
});
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (S.dbState === 'ok' && VIEWS.some(x => x[0] === v)) setView(v); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.dbState === 'ok') scheduleRender(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Installed. Open Command from your home screen or dock.'); scheduleRender(); });
const updateSW = registerSW({
  onNeedRefresh() {
    S.updateApp = () => updateSW(true);
    toast('A new version is ready.', false, {label:'Reload', act:'update-app', sticky:true});
  },
  onRegisteredSW(url, reg) {
    if (!reg) return;
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  },
});
(async () => {
  if (!supabase) { S.dbState = 'config'; render(); return; }
  const { data } = await supabase.auth.getSession();
  if (data && data.session) startDb(data.session); else { S.dbState = 'auth'; render(); }
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && !db) startDb(session);
    if (event === 'SIGNED_OUT') location.reload();
  });
})();
})();
