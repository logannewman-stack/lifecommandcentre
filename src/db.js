// Supabase-backed document store, offline-first.
//
// The app was first built on a Firestore-style API: collections of JSON
// documents, live snapshots, set/update/get/delete. This adapter keeps that
// exact API so the app code stays simple, and stores every document as one
// row in the `docs` table: (owner, collection, id, data jsonb, updated_at).
//
// What it does for you:
// - Rows live in memory and are mirrored to localStorage, so the app paints
//   instantly on launch and still reads when there is no connection.
// - Writes update memory first (instant UI), then join a persisted queue that
//   is sent in order. If the network is down the queue waits and is retried
//   when the connection returns, when the tab comes back, and on a backoff
//   timer. The queue survives a reload or a closed app.
// - Patches are merged on the server (the patch_doc function, a deep JSON
//   merge), so your phone and laptop can change different fields of the same
//   document without overwriting each other. If the function is missing, the
//   client merges with the server's current row and upserts instead.
// - Supabase Realtime pushes changes made on your other devices. Whenever the
//   connection comes back, or the tab becomes visible again, everything is
//   reloaded in case an event was missed.
//
// API used by main.js (keep it stable):
//   db.ready                                   -> resolves once data is available (local or server)
//   db.collection(c).onSnapshot(fn, onError)   -> unsubscribe
//   db.collection(c).doc(id).get/set/update/delete
//   db.importAll({col: {id: data}})            -> number of documents
//   db.exportAll()                             -> {col: {id: data}}
//   db.status()                                -> {online, pending, syncing, live, loaded, fromCache, lastSync, error}
//   db.refresh()                               -> reload from the server and send queued writes
//   db.flush()                                 -> send queued writes now
//   db.destroy({wipe})                         -> stop listening; wipe local copies on sign-out

const PAGE = 1000;
const BATCH = 200;
const CACHE_LIMIT = 4 * 1024 * 1024; // bytes of JSON we are willing to keep in localStorage
const cacheKey = (uid) => 'lcc:cache:' + uid;
const queueKey = (uid) => 'lcc:queue:' + uid;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const deepMerge = (a, b) => {
  const out = isObj(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) ? deepMerge(out[k], v) : v;
  return out;
};

// Postgres timestamps come back as "2026-10-02T18:05:00.123456+00:00"; trim to
// something every browser parses the same way.
const ts = (s) => {
  if (!s) return 0;
  const n = Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1').replace(/\+00:00$/, 'Z'));
  return Number.isFinite(n) ? n : 0;
};

const storage = {
  get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  set(k, v) { try { const s = JSON.stringify(v); if (s.length > CACHE_LIMIT) return false; localStorage.setItem(k, s); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

// Turn a Supabase error into {code, message, retry}.
//   unavailable      network is down or the server is unhappy; try again later
//   missing_fn       the patch_doc function is not installed; fall back to a client merge
//   invalid_argument the request itself is wrong (wrong account, bad data); do not retry
export function classify(error, status) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || 'Database error');
  if (code === 'PGRST202') return { code: 'missing_fn', message, retry: false };
  if (code === '42501' || status === 403) return { code: 'invalid_argument', message, retry: false };
  const st = Number(status) || 0;
  const transient = st === 0 || st >= 500 || st === 401 || st === 408 || st === 429 || code === 'PGRST301' ||
    /fetch|network|timeout|load failed|socket|ECONN/i.test(message);
  if (transient) return { code: 'unavailable', message, retry: true };
  return { code: 'invalid_argument', message, retry: false };
}

export function createDb(supabase, uid, opts = {}) {
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

  const cache = {};        // collection -> { id: data }
  const stamps = {};       // "collection/id" -> updated_at (ms) of the version we hold
  const subs = {};         // collection -> Set(listener)
  let queue = [];          // pending writes, oldest first
  const byKey = new Map(); // "collection/id" -> newest queued op for that document
  const inflight = new Set();

  let ready = false, loaded = false, fromCache = false, loading = false, flushing = false, live = false;
  let everLive = false, rpcMissing = false, lastSync = 0, lastError = null, backoff = 0;
  let retryTimer = null, cacheTimer = null, destroyed = false;
  const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  /* ---------- status ---------- */
  const status = () => ({
    online: online(), pending: queue.length, syncing: loading || flushing, live, loaded, fromCache,
    lastSync, error: lastError ? lastError.message : null,
  });
  const emit = () => { if (!destroyed) { try { onStatus(status()); } catch (e) { console.error(e); } } };

  /* ---------- snapshots ---------- */
  const snapOf = (col) => {
    const docs = Object.entries(cache[col] || {}).map(([id, d]) => ({
      id, exists: true, data: () => d, metadata: { fromCache: !loaded, hasPendingWrites: byKey.has(col + '/' + id) },
    }));
    return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], metadata: { fromCache: !loaded, hasPendingWrites: queue.length > 0 } };
  };
  const notify = (col) => {
    if (!ready) return;
    (subs[col] || new Set()).forEach((fn) => { try { fn(snapOf(col)); } catch (e) { console.error(e); } });
  };
  const notifyAll = () => Object.keys(subs).forEach(notify);

  /* ---------- local copies ---------- */
  const persistCacheNow = () => {
    clearTimeout(cacheTimer); cacheTimer = null;
    storage.set(cacheKey(uid), { v: 1, at: Date.now(), stamps, data: cache });
  };
  const persistCacheSoon = () => { if (!cacheTimer) cacheTimer = setTimeout(persistCacheNow, 400); };
  const persistQueue = () => {
    if (queue.length) storage.set(queueKey(uid), { v: 1, ops: queue.map(({ k, col, id, op, data, at }) => ({ k, col, id, op, data, at })) });
    else storage.del(queueKey(uid));
  };

  (function hydrate() {
    const c = storage.get(cacheKey(uid));
    if (c && isObj(c.data)) {
      Object.assign(cache, c.data);
      Object.assign(stamps, isObj(c.stamps) ? c.stamps : {});
      fromCache = true; ready = true; lastSync = c.at || 0;
    }
    const q = storage.get(queueKey(uid));
    if (q && Array.isArray(q.ops)) {
      for (const o of q.ops) {
        if (!o || !o.col || !o.id || !['set', 'patch', 'del'].includes(o.op)) continue;
        const op = { k: o.col + '/' + o.id, col: o.col, id: o.id, op: o.op, data: o.data, at: o.at || Date.now() };
        queue.push(op); byKey.set(op.k, op);
      }
    }
  })();

  /* ---------- queue ---------- */
  const applyOp = (target, op) => {
    const col = (target[op.col] ||= {});
    if (op.op === 'del') delete col[op.id];
    else if (op.op === 'set') col[op.id] = clone(op.data);
    else col[op.id] = deepMerge(col[op.id], op.data);
  };
  function enqueue(col, id, op, data) {
    const k = col + '/' + id;
    const cur = byKey.get(k);
    if (cur && !inflight.has(cur)) {
      if (op === 'del' || op === 'set') { cur.op = op; cur.data = op === 'set' ? clone(data) : undefined; }
      else if (cur.op === 'del') { cur.op = 'set'; cur.data = clone(data); }
      else cur.data = deepMerge(cur.data, data);
      cur.at = Date.now();
    } else {
      const o = { k, col, id, op, data: clone(data), at: Date.now() };
      queue.push(o); byKey.set(k, o);
    }
    persistQueue();
    emit();
  }
  const dequeue = (op) => {
    const i = queue.indexOf(op);
    if (i >= 0) queue.splice(i, 1);
    if (byKey.get(op.k) === op) byKey.delete(op.k);
  };
  // A failed op whose document got a newer queued op: fold it into the newer one.
  const foldForward = (older) => {
    const newer = byKey.get(older.k);
    if (!newer || newer === older) return;
    if (newer.op === 'patch') {
      if (older.op === 'set') { newer.op = 'set'; newer.data = deepMerge(older.data, newer.data); }
      else if (older.op === 'patch') newer.data = deepMerge(older.data, newer.data);
      else newer.op = 'set';
    }
    const i = queue.indexOf(older); if (i >= 0) queue.splice(i, 1);
  };

  const adopt = (op, row) => {
    // The server's copy of a document we just wrote, unless something newer is queued.
    if (!row || byKey.has(op.k)) return;
    (cache[op.col] ||= {})[op.id] = row.data;
    stamps[op.k] = ts(row.updated_at) || Date.now();
    notify(op.col); persistCacheSoon();
  };

  async function fetchRow(col, id) {
    const { data, error, status: st } = await supabase.from('docs').select('data,updated_at').match({ owner: uid, collection: col, id }).maybeSingle();
    if (error) throw classify(error, st);
    return data || null;
  }
  async function sendSets(ops) {
    const now = new Date().toISOString();
    const rows = ops.map((o) => ({ owner: uid, collection: o.col, id: o.id, data: o.data, updated_at: now }));
    const { data, error, status: st } = await supabase.from('docs').upsert(rows, { onConflict: 'owner,collection,id' }).select('collection,id,data,updated_at');
    if (error) throw classify(error, st);
    const got = {};
    for (const r of data || []) got[r.collection + '/' + r.id] = r;
    return got;
  }
  async function sendPatch(op) {
    if (!rpcMissing) {
      const { data, error, status: st } = await supabase.rpc('patch_doc', { p_collection: op.col, p_id: op.id, p_patch: op.data });
      if (!error) return data && data.data !== undefined ? data : null;
      const c = classify(error, st);
      if (c.code !== 'missing_fn') throw c;
      rpcMissing = true;
    }
    const cur = await fetchRow(op.col, op.id);
    const merged = deepMerge(cur ? cur.data : {}, op.data);
    const got = await sendSets([{ col: op.col, id: op.id, data: merged }]);
    return got[op.k] || null;
  }
  async function sendDel(op) {
    const { error, status: st } = await supabase.from('docs').delete().match({ owner: uid, collection: op.col, id: op.id });
    if (error) throw classify(error, st);
  }

  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    backoff = Math.min(60000, backoff ? backoff * 2 : 3000);
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, backoff);
  };
  const report = (err, op) => {
    lastError = err; console.warn('write dropped', op && op.k, err);
    emit();
  };

  async function flush() {
    if (flushing || destroyed) return;
    flushing = true; emit();
    try {
      while (queue.length && online() && !destroyed) {
        const head = queue[0];
        let batch = [head];
        if (head.op === 'set') {
          for (let i = 1; i < queue.length && batch.length < BATCH && queue[i].op === 'set'; i++) batch.push(queue[i]);
        }
        batch.forEach((o) => inflight.add(o));
        try {
          if (head.op === 'set') {
            const got = await sendSets(batch);
            batch.forEach((o) => { inflight.delete(o); dequeue(o); adopt(o, got[o.k]); });
          } else if (head.op === 'patch') {
            const row = await sendPatch(head);
            inflight.delete(head); dequeue(head); adopt(head, row);
          } else {
            await sendDel(head);
            inflight.delete(head); dequeue(head); delete stamps[head.k];
          }
          backoff = 0; lastError = null;
          persistQueue(); emit();
        } catch (e) {
          batch.forEach((o) => inflight.delete(o));
          if (e && e.retry) { batch.forEach(foldForward); persistQueue(); scheduleRetry(); break; }
          batch.forEach((o) => { dequeue(o); });
          persistQueue(); report(e, head);
        }
      }
    } finally {
      flushing = false; emit();
    }
  }

  /* ---------- loading ---------- */
  async function loadAll() {
    if (loading) return loadAll.p;
    loading = true; emit();
    loadAll.p = (async () => {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error, status: st } = await supabase
          .from('docs').select('collection,id,data,updated_at').eq('owner', uid)
          .order('collection').order('id').range(from, from + PAGE - 1);
        if (error) throw classify(error, st);
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      const fresh = {}, freshStamps = {};
      for (const r of rows) { (fresh[r.collection] ||= {})[r.id] = r.data; freshStamps[r.collection + '/' + r.id] = ts(r.updated_at); }
      // Writes that have not reached the server yet still win locally.
      for (const op of queue) applyOp(fresh, op);
      for (const k of Object.keys(cache)) delete cache[k];
      Object.assign(cache, fresh);
      for (const k of Object.keys(stamps)) delete stamps[k];
      Object.assign(stamps, freshStamps);
      ready = true; loaded = true; fromCache = false; lastSync = Date.now(); lastError = null; rpcMissing = false;
      persistCacheNow();
      notifyAll();
    })();
    try { await loadAll.p; } finally { loading = false; loadAll.p = null; emit(); }
  }

  const first = loadAll().catch((e) => { if (!ready) throw e; console.warn('initial load failed, using local copy', e); });
  first.catch(() => {});
  // Queued writes from last time go out as soon as we are up.
  if (queue.length) setTimeout(flush, 0);

  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await flush();
      await loadAll();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  const refreshIfStale = () => { if (queue.length || Date.now() - lastSync > 15000) refresh().catch((e) => console.warn('refresh failed', e)); };

  /* ---------- realtime ---------- */
  const channel = supabase
    .channel('docs-' + uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: `owner=eq.${uid}` }, (p) => {
      const row = p.eventType === 'DELETE' ? p.old : p.new;
      if (!row || !row.collection || !row.id) return;
      const k = row.collection + '/' + row.id;
      if (byKey.has(k)) return; // our own newer write is on its way
      if (p.eventType === 'DELETE') { if (cache[row.collection]) delete cache[row.collection][row.id]; delete stamps[k]; }
      else {
        const when = ts(row.updated_at);
        if (when && stamps[k] && when < stamps[k]) return; // older than what we already hold
        (cache[row.collection] ||= {})[row.id] = row.data; stamps[k] = when || Date.now();
      }
      notify(row.collection); persistCacheSoon();
    })
    .subscribe((st) => {
      const was = live;
      live = st === 'SUBSCRIBED';
      if (live && everLive && !was) refreshIfStale(); // reconnected: catch up on anything we missed
      if (live) everLive = true;
      emit();
    });

  /* ---------- wake-ups ---------- */
  const onVisible = () => { if (!document.hidden) refreshIfStale(); };
  const onOnline = () => { emit(); refresh().catch((e) => console.warn('refresh failed', e)); };
  const onOffline = () => emit();
  if (hasDom) {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', () => { if (cacheTimer) persistCacheNow(); });
  }
  // Belt and braces for a realtime connection that silently died: a light reload every 5 minutes while visible.
  const tick = setInterval(() => { if (!hasDom || !document.hidden) refreshIfStale(); }, 5 * 60 * 1000);

  /* ---------- documents ---------- */
  function docRef(col, id) {
    const k = col + '/' + id;
    return {
      id, path: k,
      async get() {
        if (ready) {
          const d = cache[col] && cache[col][id];
          return { id, exists: d !== undefined, data: () => clone(d), metadata: { fromCache: !loaded, hasPendingWrites: byKey.has(k) } };
        }
        const row = await fetchRow(col, id);
        return { id, exists: !!row, data: () => (row ? row.data : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
      },
      async set(data) {
        (cache[col] ||= {})[id] = clone(data);
        notify(col); persistCacheSoon();
        enqueue(col, id, 'set', data);
        await flush();
      },
      async update(patch) {
        const cur = cache[col] && cache[col][id];
        (cache[col] ||= {})[id] = deepMerge(cur, patch);
        notify(col); persistCacheSoon();
        enqueue(col, id, 'patch', patch);
        await flush();
      },
      async delete() {
        if (cache[col]) delete cache[col][id];
        notify(col); persistCacheSoon();
        enqueue(col, id, 'del');
        await flush();
      },
    };
  }

  const db = {
    ready: (async () => { if (ready) return; await first; })(),
    status, refresh, flush,
    collection(col) {
      return {
        path: col,
        onSnapshot(next, onError) {
          (subs[col] ||= new Set()).add(next);
          if (ready) setTimeout(() => { if (subs[col] && subs[col].has(next)) next(snapOf(col)); }, 0);
          db.ready.catch((e) => onError && onError(e));
          return () => subs[col] && subs[col].delete(next);
        },
        doc: (id) => docRef(col, id),
      };
    },
    // Replace-or-add many documents at once: { collection: { id: data } }.
    // Goes through the same queue, so it works offline too.
    async importAll(all) {
      let n = 0;
      for (const [col, docs] of Object.entries(all || {})) {
        if (!isObj(docs)) continue;
        for (const [id, data] of Object.entries(docs)) {
          (cache[col] ||= {})[id] = clone(data);
          enqueue(col, id, 'set', data); n++;
        }
        notify(col);
      }
      persistCacheSoon();
      await flush();
      return n;
    },
    exportAll() { return clone(cache); },
    destroy({ wipe } = {}) {
      destroyed = true;
      clearTimeout(retryTimer); clearTimeout(cacheTimer); clearInterval(tick);
      if (hasDom) { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); }
      try { supabase.removeChannel(channel); } catch (e) { /* ignore */ }
      if (wipe) { storage.del(cacheKey(uid)); storage.del(queueKey(uid)); }
    },
  };
  db.ready.catch(() => {});
  emit();
  return db;
}
