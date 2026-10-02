// Supabase-backed document store.
//
// The app was first built on a Firestore-style API: collections of JSON
// documents, live snapshots, set/update/get/delete. This adapter keeps that
// exact API so the app code stays simple, and stores every document as one
// row in the `docs` table: (owner, collection, id, data jsonb).
//
// - All rows are loaded once at sign-in and kept in memory.
// - Writes update memory first (instant UI), then Supabase.
// - Supabase Realtime pushes changes made on your other devices.
// - Coming back to the tab reloads everything, in case realtime dropped.

const PAGE = 1000;

const deepMerge = (a, b) => {
  const out = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
};

const toErr = (e) => ({
  code: e && (e.code === '42501' || e.code === 'PGRST301') ? 'invalid_argument' : 'unavailable',
  message: (e && e.message) || 'Database error',
});

export function createDb(supabase, uid) {
  const cache = {};          // collection -> { id: data }
  const subs = {};           // collection -> Set(listener)
  const pending = {};        // "collection/id" -> number of writes in flight
  let ready = false;

  const snapOf = (col) => {
    const docs = Object.entries(cache[col] || {}).map(([id, d]) => ({
      id, exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false },
    }));
    return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = (col) => {
    if (!ready) return;
    (subs[col] || new Set()).forEach((fn) => { try { fn(snapOf(col)); } catch (e) { console.error(e); } });
  };
  const notifyAll = () => Object.keys(subs).forEach(notify);

  async function loadAll() {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('docs').select('collection,id,data').eq('owner', uid)
        .order('collection').order('id').range(from, from + PAGE - 1);
      if (error) throw toErr(error);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    const fresh = {};
    for (const r of rows) (fresh[r.collection] ||= {})[r.id] = r.data;
    // keep local values for docs with writes still in flight
    for (const key of Object.keys(pending)) {
      if (!pending[key]) continue;
      const [col, id] = key.split('/');
      if (cache[col] && cache[col][id] !== undefined) (fresh[col] ||= {})[id] = cache[col][id];
    }
    for (const k of Object.keys(cache)) delete cache[k];
    Object.assign(cache, fresh);
    ready = true;
    notifyAll();
  }

  supabase
    .channel('docs-' + uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: `owner=eq.${uid}` }, (p) => {
      const row = p.eventType === 'DELETE' ? p.old : p.new;
      if (!row || !row.collection || !row.id) return;
      if (pending[row.collection + '/' + row.id]) return; // our own newer write is on its way
      if (p.eventType === 'DELETE') { if (cache[row.collection]) delete cache[row.collection][row.id]; }
      else (cache[row.collection] ||= {})[row.id] = row.data;
      notify(row.collection);
    })
    .subscribe();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ready) loadAll().catch((e) => console.warn('refresh failed', e));
  });

  async function track(col, id, fn) {
    const key = col + '/' + id;
    pending[key] = (pending[key] || 0) + 1;
    try { return await fn(); } finally { pending[key] -= 1; }
  }

  function docRef(col, id) {
    const set = async (data) => {
      (cache[col] ||= {})[id] = data;
      notify(col);
      await track(col, id, async () => {
        const { error } = await supabase.from('docs')
          .upsert({ owner: uid, collection: col, id, data, updated_at: new Date().toISOString() }, { onConflict: 'owner,collection,id' });
        if (error) throw toErr(error);
      });
    };
    return {
      id, path: col + '/' + id,
      async get() {
        const { data, error } = await supabase.from('docs').select('data').match({ owner: uid, collection: col, id }).maybeSingle();
        if (error) throw toErr(error);
        return { id, exists: !!data, data: () => (data ? data.data : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
      },
      set,
      async update(patch) {
        const cur = cache[col] && cache[col][id];
        if (cur === undefined) throw { code: 'invalid_argument', message: 'Document does not exist' };
        await set(deepMerge(cur, patch));
      },
      async delete() {
        if (cache[col]) delete cache[col][id];
        notify(col);
        await track(col, id, async () => {
          const { error } = await supabase.from('docs').delete().match({ owner: uid, collection: col, id });
          if (error) throw toErr(error);
        });
      },
    };
  }

  const db = {
    ready: loadAll(),
    collection(col) {
      return {
        path: col,
        onSnapshot(next, onError) {
          (subs[col] ||= new Set()).add(next);
          if (ready) setTimeout(() => next(snapOf(col)), 0);
          db.ready.catch((e) => onError && onError(e));
          return () => subs[col].delete(next);
        },
        doc: (id) => docRef(col, id),
      };
    },
    // Replace-or-add many documents at once: { collection: { id: data } }
    async importAll(all) {
      const rows = [];
      for (const [col, docs] of Object.entries(all || {})) {
        for (const [id, data] of Object.entries(docs || {})) rows.push({ owner: uid, collection: col, id, data, updated_at: new Date().toISOString() });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('docs').upsert(rows.slice(i, i + 500), { onConflict: 'owner,collection,id' });
        if (error) throw toErr(error);
      }
      await loadAll();
      return rows.length;
    },
    exportAll() { return JSON.parse(JSON.stringify(cache)); },
  };
  return db;
}
