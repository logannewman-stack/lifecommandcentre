import { supabase } from './supabase.js';
import { createDb } from './db.js';
import './styles.css';

(() => {
'use strict';

/* ---------- constants ---------- */
const COLS = ['config','days','tasks','leads','sessions','dupr','weeks','meta'];
const VIEWS = [['today','Today'],['calls','Calls'],['week','Week'],['log','Log'],['plan','Plan']];
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

/* ---------- state ---------- */
const S = {
  dbState:'loading', err:null,
  data:{config:{},days:{},tasks:{},leads:{},sessions:{},dupr:{},weeks:{},meta:{}},
  got:{},
  view:'today', drafts:{}, openItem:null, editAM:false, editPM:false,
  callFilter:'due', search:'', leadForm:null,
  weekOffset:0, weekDay:null, modal:null, toast:null, lastUndo:null, confirm:null
};
let db = null;
try { const v = localStorage.getItem('lcc-view'); if (v && VIEWS.some(x => x[0] === v)) S.view = v; } catch(e) {}
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
function deepMerge(a, b) {
  const out = (a && typeof a === 'object' && !Array.isArray(a)) ? {...a} : {};
  for (const [k,v] of Object.entries(b || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  }
  return out;
}
const draft = (id, def) => S.drafts[id] !== undefined ? S.drafts[id] : (def ?? '');
const clearDrafts = prefix => { Object.keys(S.drafts).forEach(k => { if (k.startsWith(prefix)) delete S.drafts[k]; }); };

/* ---------- data getters ---------- */
const cfg = () => S.data.config || {};
const profile = () => cfg().profile || {};
const targets = () => profile().targets || {};
const scheduleFor = d => ((cfg().schedule || {}).days || {})[dowOf(d)] || [];
const roadmap = () => ((cfg().roadmap || {}).weeks || []).slice().sort((a,b) => a.start < b.start ? -1 : 1);
const roadmapFor = d => { let cur = null; roadmap().forEach(w => { if (w.start <= d) cur = w; }); return cur; };
const dayOf = d => S.data.days[d] || {};
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
    .filter(l => l.stage !== 'Lost' && l.nextDate && l.nextDate <= d);
}
const leadSortDue = (a,b) => {
  const g = l => l.type === 'Cold' ? (l.region === 'IA' ? 1 : l.region === 'AZ' ? 2 : 3) : 0;
  return g(a) - g(b) || (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0) || a.name.localeCompare(b.name);
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
  const existed = !!(S.data[col] && S.data[col][id] !== undefined);
  S.data[col] = {...S.data[col], [id]: deepMerge((S.data[col] || {})[id] || {}, patch)};
  return enqueue(col + '/' + id, async () => {
    const ref = db.collection(col).doc(id);
    if (existed) {
      try { await ref.update(patch); return; } catch (e) { if (!e || e.code !== 'invalid_argument') throw e; }
    }
    const snap = await ref.get();
    const base = snap.exists ? clone(snap.data()) : {};
    await ref.set(deepMerge(base, patch));
  });
}
function delDoc(col, id) {
  if (!db) return Promise.resolve();
  if (S.data[col]) { const o = {...S.data[col]}; delete o[id]; S.data[col] = o; }
  return enqueue(col + '/' + id, () => db.collection(col).doc(id).delete());
}
const patchDay = (d, patch) => patchDoc('days', d, deepMerge({date:d}, patch));

/* ---------- rollover automation ---------- */
let rollTimer = null, rolling = false;
const allLoaded = () => COLS.every(c => S.got[c]);
function maybeRollover() {
  if (!db || !allLoaded() || rolling || !cfg().schedule) return;
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
      for (const i of scheduleFor(d)) {
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
  if (S.dbState === 'config') html = `<div class="card empty"><b>Supabase isn't connected yet.</b><br>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local (or to your Vercel project's environment variables) and reload.</div>`;
  else if (S.dbState === 'auth') html = loginView();
  else if (S.dbState === 'error') html = `<div class="card empty"><b>Couldn't load your data.</b><br>${esc(S.err || 'Check your connection and reload.')}</div>`;
  else if (!allLoaded()) html = `<div class="card empty">Loading your plan, calls and to-dos…</div>`;
  else if (!cfg().schedule) html = importView();
  else html = ({today:viewToday, calls:viewCalls, week:viewWeek, log:viewLog, plan:viewPlan})[S.view]();
  app.innerHTML = html;
  renderTabs(); renderModal(); renderToast();
}
function renderHeader() {
  const t = todayISO(), p = profile();
  const days = p.moveDate ? Math.max(0, daysBetween(t, p.moveDate)) : null;
  document.getElementById('hdr').innerHTML = `<div class="min0"><div class="eyebrow">Life Command Center</div><h1>${esc(fmtLong(t))}</h1></div>` +
    (days !== null ? `<div class="count"><b>${days}</b><span>days to<br>Scottsdale</span></div>` : '');
}
function renderTabs() {
  if (S.dbState !== 'ok') { document.getElementById('tabs').innerHTML = ''; return; }
  const due = allLoaded() ? leadsDue(todayISO()).length : 0;
  document.getElementById('tabs').innerHTML = VIEWS.map(([k,l]) =>
    `<button data-act="view" data-v="${k}" class="${S.view === k ? 'on' : ''}" aria-current="${S.view === k ? 'page' : 'false'}">${l}${k === 'calls' && due ? `<span class="badge">${due}</span>` : ''}</button>`).join('');
}

/* ----- TODAY ----- */
function viewToday() {
  const t = todayISO(), day = dayOf(t), items = scheduleFor(t);
  const checkable = items.filter(isCheckable);
  const doneN = checkable.filter(i => isDone(i, t)).length;
  const carried = tasksCarried(t), due = tasksDue(t), doneTasks = tasksDoneOn(t);
  const wk = roadmapFor(t);
  const pct = checkable.length ? Math.round(doneN / checkable.length * 100) : 0;
  const behind = checkable.filter(i => !isDone(i,t) && toMin(i.end || i.start) <= nowMin()).length;
  return [
    wk ? `<div class="week-banner"><div class="eyebrow">This week</div><b>${esc(wk.focus)}</b>${wk.musts ? `<details><summary>Must-dos this week</summary><div class="meta" style="margin-top:4px;color:var(--ink-2)">${esc(wk.musts)}</div></details>` : ''}</div>` : '',
    `<div class="progress ${pct === 100 ? 'good' : ''}"><div class="bar"><i style="width:${pct}%"></i></div><span class="meta mono">${doneN}/${checkable.length} blocks</span>${behind ? `<span class="pill warn">${behind} behind</span>` : ''}${carried.length ? `<span class="pill bad">${carried.length} carried over</span>` : ''}</div>`,
    nowCard(items, t),
    amCard(t, day),
    carried.length ? `<section class="card"><div class="card-h"><h2>Carried over</h2><span class="meta">Not done yet, so they moved to today</span></div>${carried.map(x => taskRow(x, t)).join('')}</section>` : '',
    `<section class="card"><div class="card-h"><h2>Today's plan</h2><span class="meta">${esc(dowOf(t))} schedule</span></div>${items.map(i => planRow(i, t, day)).join('')}</section>`,
    `<section class="card"><div class="card-h"><h2>To-dos due today</h2><span class="meta">${due.length ? plural(due.length,'item') : 'All clear'}</span></div>
      ${due.map(x => taskRow(x, t)).join('') || '<div class="meta">Nothing else due today.</div>'}
      ${addTaskForm('qt', t)}
      ${doneTasks.length ? `<details style="margin-top:8px"><summary>Done today (${doneTasks.length})</summary>${doneTasks.map(x => taskRow(x, t)).join('')}</details>` : ''}
    </section>`,
    pmCard(t, day)
  ].join('');
}
function nowCard(items, t) {
  const m = nowMin();
  const cur = items.find(i => toMin(i.start) <= m && m < toMin(i.end || i.start));
  const nextI = items.find(i => toMin(i.start) > m);
  const focus = cur && !(isCheckable(cur) && isDone(cur, t)) ? cur : (nextI || cur);
  if (!focus) return `<div class="now"><div class="eyebrow">Day's done</div><div class="what">${dayOf(t).pm && dayOf(t).pm.savedAt ? 'Checked out. Rest up.' : 'Do your evening check-out, then you are off.'}</div></div>`;
  const live = focus === cur;
  let extra = '';
  if (focus.kind === 'calls') extra = `<div class="nextline mono">${dialsFor(t, focus.region)}/${focus.quota} ${regionName(focus.region)} dials · ${callsCount(t,'convo')} conversations today</div>`;
  const act = actionFor(focus, t, true);
  const after = items.find(i => toMin(i.start) > toMin(focus.start));
  return `<div class="now"><div class="eyebrow">${live ? '<span class="live">Now</span>' : 'Up next'} <span class="mono">${fmtTap(focus.start)}${focus.end && focus.end !== focus.start ? '–' + fmtTap(focus.end) : ''}</span></div>
    <div class="what">${focus.tag ? `<span class="tag">${esc(focus.tag)}</span>` : ''}${esc(focus.text)}</div>${extra}
    ${act ? `<div class="acts">${act}</div>` : ''}
    ${after ? `<div class="nextline">Then ${esc(fmtTap(after.start))}: ${esc(after.tag ? after.tag.toLowerCase() : after.text)}</div>` : ''}</div>`;
}
function actionFor(i, t, big) {
  const cls = big ? 'btn' : 'btn sm';
  if (i.kind === 'checkin') return isDone(i,t) ? '' : `<button class="${cls}" data-act="goto" data-id="am-card">Start check-in</button>`;
  if (i.kind === 'checkout') return isDone(i,t) ? '' : `<button class="${cls}" data-act="goto" data-id="pm-card">Start check-out</button>`;
  if (i.kind === 'calls') return `<button class="${cls}" data-act="view" data-v="calls">Open calls</button>`;
  if (i.kind === 'dupr') return isDone(i,t) ? '' : `<button class="${cls}" data-act="view" data-v="log">Log DUPR</button>`;
  if (i.kind === 'marker') return '';
  if (!big) return '';
  return isDone(i,t) ? `<button class="${cls} ghost" data-act="check" data-key="${esc(i.key)}">Undo</button>` : `<button class="${cls}" data-act="check" data-key="${esc(i.key)}">Mark done</button>`;
}
function planRow(i, t, day) {
  const m = nowMin(), done = isCheckable(i) && isDone(i, t), skipped = isSkipped(i, t);
  const isNow = toMin(i.start) <= m && m < toMin(i.end || i.start);
  const late = isCheckable(i) && !done && toMin(i.end || i.start) <= m;
  let box;
  if (!isCheckable(i)) box = `<span class="dot" aria-hidden="true"></span>`;
  else if (i.kind === 'checkin' || i.kind === 'checkout') box = `<button class="ck ${done ? 'on' : ''}" data-act="goto" data-id="${i.kind === 'checkin' ? 'am-card' : 'pm-card'}" aria-label="${esc(i.tag || i.text)}"></button>`;
  else if (i.kind === 'dupr' && !done) box = `<button class="ck" data-act="view" data-v="log" aria-label="Log DUPR"></button>`;
  else box = `<button class="ck ${done ? 'on' : ''} ${skipped ? 'skip' : ''}" data-act="check" data-key="${esc(i.key)}" aria-pressed="${done}" aria-label="Done: ${esc(i.tag || i.text)}"></button>`;
  const subs = [];
  if (i.kind === 'calls') subs.push(`<span class="mono">${dialsFor(t, i.region)}/${i.quota}</span> ${regionName(i.region)} dials · <a data-act="view" data-v="calls">Open calls</a>`);
  if (i.kind === 'session' && i.sessionType === 'Drill') { const f = lastFix(t); if (f) subs.push(`This week's fix: ${esc(f)}`); }
  if (i.kind === 'session' && done && !skipped) {
    const sid = `auto-${t}-${i.key}`, s = S.data.sessions[sid];
    const rec = s && num(s.games) ? `Record ${num(s.won)||0}-${num(s.games)-(num(s.won)||0)} · ` : '';
    subs.push(`${rec}<a data-act="session-edit" data-id="${sid}">${s && (num(s.games) || s.workOn || s.wentWell) ? 'Edit session' : 'Add record + notes'}</a>`);
  }
  if (skipped) subs.push('Skipped today. No make-up.');
  else if (i.carry && !done) subs.push('Moves to tomorrow if not done.');
  const menu = S.openItem === i.key ? `<div class="menu">${skipped
      ? `<button class="btn sm" data-act="skip" data-key="${esc(i.key)}" data-on="0">Unskip</button>`
      : `<button class="btn sm" data-act="skip" data-key="${esc(i.key)}" data-on="1">Skip today (no make-up)</button>`}</div>` : '';
  return `<div class="row ${!isCheckable(i) ? 'marker' : ''} ${done ? 'done' : ''} ${isNow ? 'is-now' : ''} ${late ? 'late' : ''}">
    <div class="time">${fmtT(i.start)}</div>${box}
    <div class="txt">${i.tag ? `<span class="tag">${esc(i.tag)}</span>` : ''}${esc(i.text)}${subs.map(s => `<div class="sub">${s}</div>`).join('')}</div>
    ${isCheckable(i) && !['checkin','checkout'].includes(i.kind) ? `<button class="more" data-act="item-menu" data-key="${esc(i.key)}" aria-label="More options">⋯</button>` : '<span></span>'}
    ${menu}</div>`;
}
function taskRow(x, t) {
  const late = !x.done && x.due && x.due < t ? daysBetween(x.due, t) : 0;
  const bits = [];
  if (late) bits.push(`<span class="pill bad">${late === 1 ? '1 day late' : late + ' days late'}</span>`);
  if (x.kind === 'makeup') bits.push('<span class="pill warn">Make-up</span>');
  if (x.area) bits.push(`<span class="pill">${esc(x.area)}</span>`);
  if (x.notes) bits.push(esc(x.notes));
  return `<div class="trow ${x.done ? 'done' : ''}"><button class="ck ${x.done ? 'on' : ''}" data-act="task-toggle" data-id="${esc(x.id)}" aria-pressed="${!!x.done}" aria-label="Done: ${esc(x.title)}"></button>
    <div class="min0"><div class="txt">${esc(x.title)}</div>${bits.length ? `<div class="meta">${bits.join(' ')}</div>` : ''}</div>
    ${!x.done ? `<div class="acts"><button class="btn sm" data-act="task-tomorrow" data-id="${esc(x.id)}">Tomorrow</button><button class="btn sm ghost" data-act="task-drop" data-id="${esc(x.id)}">Drop</button></div>` : ''}</div>`;
}
function addTaskForm(p, defDate) {
  return `<form class="btnrow" data-form="task" data-p="${p}" style="margin-top:10px">
    <input class="in" id="${p}-title" data-draft placeholder="Add a to-do" value="${esc(draft(p+'-title'))}" style="flex:1 1 180px">
    <input class="in" type="date" id="${p}-date" data-draft value="${esc(draft(p+'-date', defDate))}" style="flex:0 1 160px">
    <button class="btn primary" type="submit">Add</button></form>`;
}
function amCard(t, day) {
  const am = day.am || {};
  if (am.savedAt && !S.editAM) {
    const top = (am.top3 || []).map((x,n) => ({...x, n})).filter(x => x.t);
    return `<section class="card" id="am-card"><div class="card-h"><h2>Morning check-in</h2><button class="btn sm ghost" data-act="am-edit">Edit</button></div>
      <div class="kv">${num(am.weight) ? `<span><b>${num(am.weight).toFixed(1)}</b> lb</span>` : ''}${num(am.sleep) ? `<span><b>${num(am.sleep)}</b> h sleep</span>` : ''}${num(am.energy) ? `<span><b>${num(am.energy)}</b>/10 energy</span>` : ''}</div>
      ${top.length ? `<h3>Top 3 today</h3>${top.map(x => `<div class="trow ${x.done ? 'done' : ''}"><button class="ck ${x.done ? 'on' : ''}" data-act="top3" data-i="${x.n}" aria-pressed="${!!x.done}" aria-label="Done: ${esc(x.t)}"></button><div class="txt">${esc(x.t)}</div></div>`).join('')}<div class="meta">Anything left unchecked moves to tomorrow.</div>` : ''}
      ${am.note ? `<p class="note">${esc(am.note)}</p>` : ''}</section>`;
  }
  const top = am.top3 || [];
  const e = S.drafts['am-energy'] !== undefined ? S.drafts['am-energy'] : (am.energy ?? '');
  return `<section class="card" id="am-card"><div class="card-h"><h2>Morning check-in</h2><span class="meta">2 minutes</span></div>
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
  const day = dayOf(t), sched = scheduleFor(t), ch = day.checks || {};
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
    return `<section class="card" id="pm-card"><div class="card-h"><h2>Evening check-out</h2><button class="btn sm ghost" data-act="pm-edit">Edit</button></div>${autoGrid}
      <div class="kv"><span>Proposals <b>${num(pm.proposals)||0}</b></span><span>Deals <b>${num(pm.deals)||0}</b></span><span>Cash in <b>${money(num(pm.cash))}</b></span><span>Protein ${pm.protein ? '<b>hit</b>' : '<b>missed</b>'}</span></div>
      ${pm.win ? `<p class="note"><b>Win:</b> ${esc(pm.win)}</p>` : ''}${pm.fix ? `<p class="note"><b>Fix tomorrow:</b> ${esc(pm.fix)} <span class="meta">(on tomorrow's to-dos)</span></p>` : ''}
      ${pm.biz ? `<p class="note"><b>Business:</b> ${esc(pm.biz)}</p>` : ''}${pm.pb ? `<p class="note"><b>Pickleball:</b> ${esc(pm.pb)}</p>` : ''}</section>`;
  }
  const f = (id, label, def, ph, mode) => `<div class="fld"><label for="${id}">${label}</label><input class="in" id="${id}" data-draft ${mode ? `inputmode="${mode}"` : ''} value="${esc(draft(id, def))}" placeholder="${ph || ''}"></div>`;
  const prot = S.drafts['pm-protein'] !== undefined ? S.drafts['pm-protein'] : !!pm.protein;
  return `<section class="card" id="pm-card"><div class="card-h"><h2>Evening check-out</h2><span class="meta">5 minutes · counts fill in by themselves</span></div>${autoGrid}
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

/* ----- CALLS ----- */
const inCadence = l => l.type === 'Cold' && ['New lead','Contacted'].includes(l.stage);
const cadenceStep = l => CADENCE[Math.min(num(l.touches) || 0, CADENCE.length - 1)];
function viewCalls() {
  const t = todayISO();
  const quotas = scheduleFor(t).filter(i => i.kind === 'calls');
  const due = leadsDue(t).sort(leadSortDue);
  const all = Object.entries(S.data.leads).map(([id,l]) => ({id, ...l}));
  const q = S.search.trim().toLowerCase();
  let list;
  if (q) list = all.filter(l => [l.name,l.business,l.contact,l.phone].join(' ').toLowerCase().includes(q)).sort((a,b) => a.name.localeCompare(b.name));
  else if (S.callFilter === 'IA' || S.callFilter === 'AZ') list = due.filter(l => l.type === 'Cold' && l.region === S.callFilter);
  else if (S.callFilter === 'warm') list = due.filter(l => l.type !== 'Cold');
  else if (S.callFilter === 'all') list = all.sort((a,b) => (STAGE_RANK[b.stage] ?? -1) - (STAGE_RANK[a.stage] ?? -1) || a.name.localeCompare(b.name));
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
    <div class="btnrow"><input class="in" id="lead-search" placeholder="Search all leads" value="${esc(S.search)}" style="flex:1 1 200px"><button class="btn primary" data-act="lead-add">Add lead</button></div>
    ${q ? '' : `<div class="chips">${[['due',`Due now ${due.length}`],['warm',`Warm + clients ${n(l => l.type !== 'Cold')}`],['IA',`Iowa ${n(l => l.type === 'Cold' && l.region === 'IA')}`],['AZ',`Arizona ${n(l => l.type === 'Cold' && l.region === 'AZ')}`],['all',`All leads ${all.length}`]].map(([k,l]) => `<button class="chip ${S.callFilter === k ? 'on' : ''}" data-act="call-filter" data-f="${k}">${l}</button>`).join('')}</div>`}
    ${list.length ? list.map(l => leadCard(l, t)).join('') : `<div class="card empty">${q ? 'No leads match that search.' : 'No calls due here. Add new leads on Monday, or switch filters.'}</div>`}`;
}
function leadCard(l, t) {
  const id = l.id, step = inCadence(l) ? cadenceStep(l) : null;
  const late = l.nextDate && l.nextDate < t ? daysBetween(l.nextDate, t) : 0;
  const isDue = l.nextDate && l.nextDate <= t;
  let btns;
  if (step && step.type === 'call') btns = [['noanswer','No answer'],['talked','Talked'],['demo','Demo booked'],['notint','Not interested'],['bad','Bad number']];
  else if (step) btns = [['sent', step.type === 'dm' ? 'DM sent' : 'Email sent'],['replied','They replied']];
  else btns = [['noanswer','No answer'],['talked','Talked'],['demo','Demo booked']];
  const stageCls = l.stage === 'Won' ? 'good' : l.stage === 'Lost' ? 'bad' : ['Talking','Demo booked','Proposal sent'].includes(l.stage) ? 'acc' : '';
  const form = S.leadForm && S.leadForm.id === id ? S.leadForm.type : null;
  const tel = String(l.phone || '').replace(/[^\d+]/g,'');
  return `<article class="lead">
    <div class="lead-h"><div class="min0"><div class="lname">${esc(l.name)}</div><div class="meta">${esc(l.business || '')}${l.contact ? ' · ' + esc(l.contact) : ''}${l.website ? ` · <a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : ''}</div></div><span class="pill ${stageCls}">${esc(l.stage || '')}</span></div>
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
  const prev = clone(l), next = clone(l), step = cadenceStep(l), cad = inCadence(l);
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
  S.leadForm = null; clearDrafts('lf-');
  setDoc('leads', id, next);
  patchDay(t, {calls:[...(dayOf(t).calls || []), call]});
  const created = [];
  for (const nt of newTasks) { if (!S.data.tasks[nt.id]) { const {id:tid, ...b} = nt; created.push(tid); setDoc('tasks', tid, {...b, done:false, origDue:b.due, kind:'sales', createdAt:Date.now()}); } }
  S.lastUndo = {type:'outcome', id, prev, date:t, callT:call.t, tasks:created};
  toast(msg || 'Saved.', true);
  render();
}
function undo() {
  const u = S.lastUndo; if (!u) return; S.lastUndo = null;
  if (u.type === 'outcome') {
    setDoc('leads', u.id, u.prev);
    patchDay(u.date, {calls:(dayOf(u.date).calls || []).filter(c => c.t !== u.callT)});
    u.tasks.forEach(id => delDoc('tasks', id));
  } else if (u.type === 'task') {
    setDoc('tasks', u.id, u.prev);
  }
  toast('Undone.');
}

/* ----- WEEK ----- */
function weekStats(ws) {
  const dates = [0,1,2,3,4,5,6].map(i => addDays(ws, i)), end = dates[6];
  const st = {dials:0,convos:0,demos:0,dms:0,proposals:0,deals:0,mockups:0,cash:0,gym:0,mobility:0,pro:0,checkins:0,checkouts:0,drill:0,competitive:0};
  dates.forEach(d => {
    const day = dayOf(d), pm = day.pm || {}, ch = day.checks || {};
    (day.calls || []).forEach(c => { if (c.dial) st.dials++; if (c.convo) st.convos++; if (c.demo) st.demos++; if (c.dm) st.dms++; });
    st.proposals += num(pm.proposals)||0; st.deals += num(pm.deals)||0; st.mockups += num(pm.mockups)||0; st.dms += num(pm.dms)||0; st.cash += num(pm.cash)||0; st.pro += num(pm.proExtra)||0;
    if (day.am && day.am.savedAt) st.checkins++; if (pm.savedAt) st.checkouts++;
    scheduleFor(d).forEach(i => { if (!ch[i.key]) return; if (i.kind === 'gym') st.gym++; if (i.kind === 'mobility') st.mobility += i.minutes||15; if (i.kind === 'watch') st.pro += i.minutes||30; });
  });
  Object.values(S.data.sessions).forEach(s => { if (s.date >= ws && s.date <= end) { if (s.type === 'Drill') st.drill++; if (['Competitive','Tournament'].includes(s.type)) st.competitive++; } });
  return st;
}
function stat(label, val, target, fmt) {
  fmt = fmt || (v => v);
  const pct = target ? Math.min(100, Math.round(val / target * 100)) : 0;
  return `<div class="stat ${target && val >= target ? 'good' : ''}"><div class="stat-h"><span>${label}</span><b>${fmt(val)}${target ? `<small> / ${fmt(target)}</small>` : ''}</b></div>${target ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>`;
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
    <section class="card"><div class="card-h"><h2>Business</h2><span class="meta">Counted from your calls + check-outs</span></div><div class="stats">
      ${stat('Dials', st.dials, T.dials)}${stat('Owner conversations', st.convos, T.convos)}${stat('Demos booked', st.demos, T.demos)}${stat('Proposals sent', st.proposals, T.proposals)}
      ${stat('Deals won', st.deals, T.deals)}${stat('Mockups sent', st.mockups, T.mockups)}${stat('DMs sent', st.dms, T.dms)}${stat('Cash in', st.cash, 0, money)}</div></section>
    <section class="card"><div class="card-h"><h2>Pickleball + body</h2><span class="meta">Counted from your checkoffs + sessions</span></div><div class="stats">
      ${stat('Drill sessions', st.drill, T.drill)}${stat('Competitive sessions', st.competitive, T.competitive)}${stat('Gym sessions', st.gym, T.gym)}${stat('Mobility (min)', st.mobility, T.mobility)}
      ${stat('Pro video (hrs)', Math.round(st.pro/6)/10, (T.proMinutes||210)/60)}${stat('Check-ins', st.checkins, 7)}${stat('Check-outs', st.checkouts, 7)}${stat(`Rated games in ${parseISO(month+'-01').toLocaleDateString('en-US',{month:'long'})}`, ratedGames, 0)}</div>
      <div class="meta" style="margin-top:8px">Rated DUPR games only happen at events, so they're counted by month, not week.</div></section>
    ${moneyCard(t)}
    <section class="card"><div class="card-h"><h2>Sunday review</h2><span class="meta">Biggest leak + one fix</span></div>
      <form class="stack" data-form="review" data-ws="${ws}">
        <div class="fld"><label for="rv-leak">Biggest leak this week</label><input class="in" id="rv-leak" data-draft value="${esc(draft('rv-leak', review.leak))}" placeholder="e.g. popping up resets from the transition zone"></div>
        <div class="fld"><label for="rv-fix">One fix for next week</label><input class="in" id="rv-fix" data-draft value="${esc(draft('rv-fix', review.fix))}" placeholder="Shows on every drill block next week"></div>
        <div class="btnrow"><button class="btn primary" type="submit">Save review</button>${review.savedAt ? '<span class="meta">Saved</span>' : ''}</div></form></section>
    <section class="card"><div class="card-h"><h2>Exact schedule</h2><span class="meta">Same every week</span></div>
      <div class="daychips">${WEEK_ORDER.map(d => `<button class="${d === sel ? 'on' : ''}" data-act="week-day" data-d="${d}">${d}</button>`).join('')}</div>
      <div style="margin-top:6px">${scheduleFor(selDate).map(i => `<div class="row ${!isCheckable(i) ? 'marker' : ''}"><div class="time">${fmtT(i.start)}</div>${isCheckable(i) ? `<span class="ck ${isDone(i, selDate) ? 'on' : ''}" aria-hidden="true" style="cursor:default"></span>` : '<span class="dot"></span>'}<div class="txt">${i.tag ? `<span class="tag">${esc(i.tag)}</span>` : ''}${esc(i.text)}${i.carry ? '<div class="sub">Moves to the next day if missed.</div>' : ''}</div><span></span></div>`).join('')}</div></section>`;
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
    <section class="card"><div class="card-h"><h2>DUPR doubles</h2>${nextCp ? `<span class="meta">Next: ${nextCp.target.toFixed(1)} by ${esc(fmtShort(nextCp.date))}</span>` : ''}</div>
      <div class="kv"><span><b>${latest ? num(latest.rating).toFixed(3) : '–'}</b> now</span>${p.duprStart ? `<span>started at <b>${num(p.duprStart).toFixed(2)}</b></span>` : ''}<span>goal <b>5.50</b> by Jun 30</span></div>
      ${sparkline(dl.map(x => num(x.rating)))}
      <form class="btnrow" data-form="dupr" style="margin-top:8px"><input class="in" id="dupr-in" data-draft inputmode="decimal" placeholder="Today's DUPR, e.g. 4.912" value="${esc(draft('dupr-in'))}" style="flex:1 1 160px"><button class="btn primary" type="submit">Save DUPR</button></form>
      <div class="meta" style="margin-top:6px">Checkpoints: ${cps.map(c => `${c.target.toFixed(1)} by ${fmtShort(c.date)}`).join(' · ')}</div></section>
    <section class="card"><div class="card-h"><h2>Body</h2><span class="meta">From your morning weigh-ins</span></div>
      <div class="kv"><span><b>${a7 ? a7.toFixed(1) : '–'}</b> lb 7-day avg</span>${start ? `<span>start <b>${start.toFixed(1)}</b></span>` : ''}${start && a7 ? `<span>lost <b>${(start - a7).toFixed(1)}</b> lb</span>` : ''}${goal ? `<span>protein <b>${Math.round(goal*0.8)}</b> g/day</span>` : ''}</div>
      ${sparkline(ws.slice(-30).map(x => x.w))}
      <form class="btnrow" data-form="goal" style="margin-top:8px"><div class="fld" style="flex:1 1 140px"><label for="goal-in">Goal weight (lb)</label><input class="in" id="goal-in" data-draft inputmode="decimal" value="${esc(draft('goal-in', p.goalWeight))}" placeholder="${start ? Math.round(start - 15) : ''}"></div><button class="btn primary" type="submit" style="align-self:flex-end">Save goal</button></form>
      <div class="meta" style="margin-top:6px">Aim for about 1 lb a week. Losing more than 1.5 lb a week or feeling flat on court: eat about 200 more a day.</div></section>
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
  return `<section class="card" style="max-width:420px;margin:24px auto 0;width:100%"><div class="card-h"><h2>Sign in</h2></div>
    <form class="stack" data-form="login">
      <div class="fld"><label for="lg-email">Email</label><input class="in" type="email" id="lg-email" data-draft autocomplete="username" value="${esc(draft('lg-email'))}"></div>
      <div class="fld"><label for="lg-pass">Password</label><input class="in" type="password" id="lg-pass" autocomplete="current-password"></div>
      <button class="btn primary" type="submit">Sign in</button>
      <div class="meta">Use the user you created in Supabase. You stay signed in on this device.</div>
    </form></section>`;
}
function importView() {
  return `<section class="card"><div class="card-h"><h2>Load your plan</h2></div>
    <p style="margin:0 0 10px">Your database is empty. Choose <b>seed/data.json</b> from the project folder (or any backup you exported) to load your schedule, roadmap, leads and to-dos.</p>
    ${importControl()}</section>`;
}
function importControl() {
  return `<div class="btnrow"><label class="btn primary" for="import-file" style="cursor:pointer">Choose backup file</label><input type="file" id="import-file" accept="application/json,.json" hidden></div>`;
}
async function importFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || typeof data !== 'object' || (!data.config && !data.leads && !data.tasks)) { toast("That file doesn't look like a Life Command Center backup."); return; }
    toast('Importing…');
    const n = await db.importAll(data);
    toast(`Imported ${n} items.`);
    render();
  } catch (e) { toast("Couldn't import: " + ((e && e.message) || 'unknown error')); }
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(), app:'life-command-center', data:db.exportAll()}, null, 1)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `lcc-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ----- PLAN ----- */
function viewPlan() {
  const t = todayISO(), p = profile();
  const upcoming = liveTasks().filter(x => !x.done && !x.dropped && x.due && x.due >= t).sort((a,b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const groups = {}; upcoming.forEach(x => { (groups[x.due] = groups[x.due] || []).push(x); });
  const recent = liveTasks().filter(x => x.done && x.doneOn && x.doneOn >= addDays(t,-14)).sort((a,b) => a.doneOn < b.doneOn ? 1 : -1);
  const cur = roadmapFor(t);
  return `
    <section class="card"><div class="card-h"><h2>Add a to-do</h2></div>${addTaskForm('pt', t)}</section>
    <section class="card"><div class="card-h"><h2>Coming up</h2><span class="meta">${plural(upcoming.length,'to-do')}</span></div>
      ${Object.keys(groups).length ? Object.entries(groups).map(([d, xs]) => `<h3>${d === t ? 'Today' : esc(fmtDay(d))}</h3>${xs.map(x => `<div class="trow"><button class="ck" data-act="task-toggle" data-id="${esc(x.id)}" aria-label="Done: ${esc(x.title)}"></button><div class="min0"><div class="txt">${esc(x.title)}</div><div class="btnrow" style="margin-top:6px">${x.area ? `<span class="pill">${esc(x.area)}</span>` : ''}<input class="in" type="date" value="${esc(x.due)}" data-act="task-date" data-id="${esc(x.id)}" aria-label="Move date" style="width:auto;padding:4px 8px;font-size:14px"><button class="btn sm ghost" data-act="task-drop" data-id="${esc(x.id)}">Drop</button></div></div></div>`).join('')}`).join('') : '<div class="meta">Nothing scheduled.</div>'}</section>
    <section class="card"><div class="card-h"><h2>Roadmap</h2><span class="meta">To the move, then DUPR 5.5</span></div>
      ${roadmap().map(w => `<div class="road ${cur && w.start === cur.start ? 'cur' : ''}"><div class="d">${esc(fmtShort(w.start))}${w.start.slice(0,4) !== t.slice(0,4) ? '<br>' + w.start.slice(0,4) : ''}</div><div class="min0"><b>${esc(w.focus)}</b>${w.musts ? `<div class="meta">${esc(w.musts)}</div>` : ''}</div></div>`).join('')}</section>
    ${recent.length ? `<section class="card"><details><summary>Done in the last 2 weeks (${recent.length})</summary>${recent.map(x => taskRow(x, t)).join('')}</details></section>` : ''}
    <section class="card"><div class="card-h"><h2>What runs by itself</h2></div><ul class="howto meta" style="margin:0;padding-left:18px;color:var(--ink-2)">
      <li>Unchecked to-dos and top-3 items move to the next day and show how many days late they are.</li>
      <li>Missed key blocks (gym, adding leads, money check-in, DUPR, Sunday review and planning) come back the next day as make-ups. Use ⋯ › Skip when you mean to skip one.</li>
      <li>Short on dials? The difference becomes a make-up to-do tomorrow.</li>
      <li>Tapping a call result counts the dial, conversation or demo and schedules the next touch (day 1, 3, 5, 8, 14).</li>
      <li>Booking a demo adds the demo and a same-day proposal to your to-dos.</li>
      <li>Checking off a drill or play block logs the session. Your check-out "fix" becomes tomorrow's first to-do.</li>
      <li>Your Sunday fix shows on every drill block the next week.</li></ul>
      <div class="btnrow" style="margin-top:10px">${p.links && p.links.playbook ? `<a class="btn sm" href="${esc(p.links.playbook)}" target="_blank" rel="noopener">Playbook (scripts, workouts)</a>` : ''}${p.links && p.links.sheet ? `<a class="btn sm ghost" href="${esc(p.links.sheet)}" target="_blank" rel="noopener">Old Google Sheet</a>` : ''}</div></section>
    <section class="card"><div class="card-h"><h2>Backup + account</h2></div>
      <div class="btnrow"><button class="btn" data-act="export">Download backup</button>${importControl()}<button class="btn ghost" data-act="signout">Sign out</button></div>
      <div class="meta" style="margin-top:8px">Importing adds or replaces items with the same IDs. It never deletes anything.</div></section>`;
}

/* ----- modals ----- */
function renderModal() {
  const el = document.getElementById('modal');
  if (!S.modal) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${S.modal.type === 'session' ? sessionForm() : leadEditForm()}</div>`;
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
  return `<div class="card-h"><h2>${isNew ? 'Add a lead' : 'Edit lead'}</h2><button class="btn sm ghost" data-act="modal-close">Close</button></div>
    <form class="stack" data-form="lead-edit">
      ${inp('name','Business name',l.name)}
      <div class="grid2">${inp('business','Type + city',l.business,'placeholder="Med spa, Scottsdale"')}${inp('contact','Owner / contact',l.contact)}</div>
      <div class="grid2">${inp('phone','Phone',l.phone,'inputmode="tel"')}${inp('website','Website',l.website)}</div>
      <div class="grid3"><div class="fld"><label for="le-type">Kind</label>${sel('type',['Cold','Warm','Client','Partner'],l.type)}</div>
        <div class="fld"><label for="le-region">Call block</label>${sel('region',[['IA','Iowa (block 1)'],['AZ','Arizona (block 2)'],['','Other']],l.region || '')}</div>
        <div class="fld"><label for="le-stage">Stage</label>${sel('stage',STAGES,l.stage)}</div></div>
      <div class="grid2">${inp('nextStep','Next step',l.nextStep)}<div class="fld"><label for="le-nextDate">Next date</label><input class="in" type="date" id="le-nextDate" data-draft value="${esc(f('nextDate', l.nextDate))}"></div></div>
      <div class="grid3">${inp('deal','Deal ($)',l.deal,'inputmode="decimal"')}${inp('monthly','Monthly ($)',l.monthly,'inputmode="decimal"')}${inp('collected','Collected ($)',l.collected,'inputmode="decimal"')}</div>
      <div class="fld"><label for="le-notes">Notes</label><textarea class="in" id="le-notes" data-draft>${esc(f('notes', l.notes))}</textarea></div>
      ${!isNew && inCadence(l) ? `<div class="meta">${num(l.touches)||0} of 5 touches done.</div>` : ''}
      <div class="btnrow"><button class="btn primary" type="submit">${isNew ? 'Add lead' : 'Save'}</button>${!isNew ? (S.confirm === 'le-del' ? '<button class="btn badb" type="button" data-act="lead-delete">Yes, delete it</button>' : '<button class="btn ghost" type="button" data-act="confirm" data-c="le-del">Delete</button>') : ''}</div>
    </form>`;
}

/* ----- toast ----- */
let toastTimer = null;
function toast(msg, withUndo) {
  S.toast = {msg, undo:!!withUndo};
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; if (withUndo) S.lastUndo = null; renderToast(); }, withUndo ? 7000 : 4000);
}
function renderToast() {
  const el = document.getElementById('toast');
  if (!S.toast) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span>${esc(S.toast.msg)}</span>${S.toast.undo && S.lastUndo ? '<button data-act="undo">Undo</button>' : ''}`;
}

/* ---------- actions ---------- */
function setView(v) {
  S.view = v; S.openItem = null; S.leadForm = null;
  try { localStorage.setItem('lcc-view', v); } catch(e) {}
  render(); window.scrollTo(0, 0);
}
function toggleCheck(key) {
  const t = todayISO(), i = scheduleFor(t).find(x => x.key === key); if (!i) return;
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
    case 'view': setView(d.v); break;
    case 'goto': { const tgt = document.getElementById(d.id); if (tgt) { tgt.scrollIntoView({behavior:'smooth', block:'start'}); const f = tgt.querySelector('input'); if (f) setTimeout(() => f.focus({preventScroll:true}), 350); } break; }
    case 'check': toggleCheck(d.key); break;
    case 'item-menu': S.openItem = S.openItem === d.key ? null : d.key; render(); break;
    case 'skip': patchDay(t, {skips:{[d.key]: d.on === '1'}}); S.openItem = null; render(); break;
    case 'task-toggle': taskToggle(d.id); break;
    case 'task-tomorrow': { const x = S.data.tasks[d.id]; if (!x) break; S.lastUndo = {type:'task', id:d.id, prev:clone(x)}; patchDoc('tasks', d.id, {due:addDays(t,1), origDue:x.origDue || x.due}); toast('Moved to tomorrow.', true); break; }
    case 'task-drop': { const x = S.data.tasks[d.id]; if (!x) break; S.lastUndo = {type:'task', id:d.id, prev:clone(x)}; patchDoc('tasks', d.id, {dropped:true, droppedOn:t}); toast('Dropped.', true); break; }
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
    case 'lead-edit': clearDrafts('le-'); S.confirm = null; S.modal = {type:'lead', id:d.id}; render(); break;
    case 'lead-add': clearDrafts('le-'); S.confirm = null; S.modal = {type:'lead', id:'lead-' + Date.now().toString(36)}; render(); break;
    case 'lead-delete': delDoc('leads', S.modal.id); S.modal = null; S.confirm = null; toast('Lead deleted.'); render(); break;
    case 'copy': { const txt = d.text; try { navigator.clipboard.writeText(txt).then(() => toast('Copied ' + txt), () => toast(txt)); } catch(e) { toast(txt); } break; }
    case 'week-nav': S.weekOffset += +d.d; S.weekDay = null; clearDrafts('rv-'); render(); break;
    case 'week-day': S.weekDay = d.d; render(); break;
    case 'session-new': clearDrafts('ss-'); S.confirm = null; S.modal = {type:'session', id:'s-' + Date.now().toString(36)}; render(); break;
    case 'session-edit': clearDrafts('ss-'); S.confirm = null; S.modal = {type:'session', id:d.id}; render(); break;
    case 'session-delete': delDoc('sessions', S.modal.id); S.modal = null; S.confirm = null; toast('Session deleted.'); render(); break;
    case 'ss-rated': { const s = S.data.sessions[S.modal.id] || {}; const cur = S.drafts['ss-rated'] !== undefined ? S.drafts['ss-rated'] : !!s.rated; S.drafts['ss-rated'] = !cur; render(); break; }
    case 'confirm': S.confirm = d.c; render(); break;
    case 'modal-close': S.modal = null; S.confirm = null; render(); break;
    case 'undo': undo(); render(); break;
    case 'export': exportBackup(); break;
    case 'signout': supabase.auth.signOut().then(() => location.reload()); break;
  }
}
function submit(form) {
  const t = todayISO(), kind = form.dataset.form, v = id => (S.drafts[id] !== undefined ? S.drafts[id] : (document.getElementById(id) || {}).value || '');
  switch (kind) {
    case 'login': {
      const email = String(v('lg-email')).trim(), password = (document.getElementById('lg-pass') || {}).value || '';
      if (!email || !password) { toast('Enter your email and password.'); return; }
      supabase.auth.signInWithPassword({email, password}).then(({error}) => { if (error) toast(error.message); });
      break;
    }
    case 'task': {
      const p = form.dataset.p, title = String(v(p + '-title')).trim(), due = v(p + '-date') || t;
      if (!title) { toast('Type the to-do first.'); return; }
      setDoc('tasks', 'u-' + Date.now().toString(36), {title, due, origDue:due, area:'Other', done:false, kind:'task', createdAt:Date.now()});
      clearDrafts(p + '-'); toast(due === t ? 'Added to today.' : 'Added for ' + fmtDay(due) + '.'); render(); break;
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
      const id = S.modal.id, l = S.data.leads[id] || {};
      const name = String(v('le-name')).trim(); if (!name) { toast('Add the business name first.'); return; }
      const body = {...l, name, business:String(v('le-business')).trim(), contact:String(v('le-contact')).trim(), phone:String(v('le-phone')).trim(), website:String(v('le-website')).trim(),
        type:v('le-type') || 'Cold', region:v('le-region'), stage:v('le-stage') || 'New lead', nextStep:String(v('le-nextStep')).trim(), nextDate:v('le-nextDate'),
        deal:num(v('le-deal')), monthly:num(v('le-monthly')), collected:num(v('le-collected')), notes:String(v('le-notes')).trim(), updatedAt:Date.now()};
      if (!S.data.leads[id]) { body.touches = 0; body.createdAt = Date.now(); if (!body.nextStep && body.type === 'Cold') body.nextStep = body.region === 'IA' ? 'Call: block 1 (Iowa)' : body.region === 'AZ' ? 'Call: block 2 (Arizona)' : 'Call'; if (!body.nextDate) body.nextDate = t; }
      setDoc('leads', id, body); toast(S.data.leads[id] ? 'Lead saved.' : 'Lead added.'); S.modal = null; clearDrafts('le-'); render(); break;
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
    case 'review': {
      const ws = form.dataset.ws;
      setDoc('weeks', ws, {...(S.data.weeks[ws] || {}), leak:String(v('rv-leak')).trim(), fix:String(v('rv-fix')).trim(), savedAt:new Date().toISOString()});
      clearDrafts('rv-'); toast('Review saved. The fix shows on next week\'s drills.'); render(); break;
    }
  }
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) { if (ev.target.id === 'modal') { S.modal = null; S.confirm = null; render(); } return; }
  if (el.tagName === 'INPUT') return;
  ev.preventDefault();
  handle(el.dataset.act, el, ev);
  if (!['goto','copy','view','undo','export','signout'].includes(el.dataset.act)) render();
});
document.addEventListener('submit', ev => { const f = ev.target.closest('form[data-form]'); if (!f) return; ev.preventDefault(); submit(f); });
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'lead-search') { S.search = el.value; const pos = el.selectionStart; render(); const n = document.getElementById('lead-search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch(e) {} } return; }
  if (el.hasAttribute && el.hasAttribute('data-draft') && el.id) S.drafts[el.id] = el.value;
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'import-file' && el.files && el.files[0]) { importFile(el.files[0]); el.value = ''; return; }
  if (el.dataset && el.dataset.act === 'task-date' && el.value) { const x = S.data.tasks[el.dataset.id]; if (x) patchDoc('tasks', el.dataset.id, {due:el.value, origDue:x.origDue || x.due}); toast('Moved to ' + fmtDay(el.value) + '.'); return; }
  if (el.hasAttribute && el.hasAttribute('data-draft') && el.id) S.drafts[el.id] = el.value;
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.modal) { S.modal = null; S.confirm = null; render(); } });

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
  db = createDb(supabase, session.user.id);
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
render();
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
