// The OS's data layer on its own Cloudflare backend. It gives the app the same collection/doc API it
// always used, backed by /api/*. Changes made elsewhere (Telegram, another device) show up within seconds.

// Every call to the OS's own API. The X-POS header proves the request comes from this app.
export async function api(path, body, opts = {}) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", signal: opts.signal,
    headers: body === undefined ? { "x-pos": "1" } : { "x-pos": "1", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "Server error " + r.status); e.status = r.status; throw e; }
  return j;
}

export function cfDb({ pollMs = 4000, onSignedOut } = {}) {
  const cache = new Map(), subs = new Set(), inflight = new Map(); let loaded = false, since = 0, timer = null, polling = false;
  const C = c => { if (!cache.has(c)) cache.set(c, new Map()); return cache.get(c); };
  const copy = d => d === undefined ? undefined : JSON.parse(JSON.stringify(d));
  const snapColl = c => ({ docs: [...C(c).entries()].map(([id, d]) => ({ id, data: () => copy(d) })) });
  const snapDoc = (c, id) => { const d = C(c).get(id); return { exists: d !== undefined, data: () => copy(d) }; };
  const call = s => { try { s.id ? s.cb(snapDoc(s.c, s.id)) : s.cb(snapColl(s.c)); } catch (e) { console.error(e); } };
  const fire = colls => { if (loaded) subs.forEach(s => { if (colls.has(s.c)) call(s); }); };
  const set = (c, id, d) => { if (d === undefined) C(c).delete(id); else C(c).set(id, d); };
  const key = (c, id) => c + "\u0000" + id;
  const rid = () => { const a = new Uint8Array(20); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };
  const signedOut = e => { if (e && e.status === 401) { stop(); onSignedOut && onSignedOut(); } };

  const ready = (async () => {
    const j = await api("/api/docs");
    j.rows.forEach(r => C(r.coll).set(r.id, r.data)); since = j.now; loaded = true;
    schedule();
  })();
  ready.catch(signedOut);

  // Pull what changed since the last look. A 5 second overlap covers writes that landed while we were reading.
  async function poll() {
    if (polling || !loaded) return; polling = true;
    try {
      const j = await api("/api/changes?since=" + Math.max(0, since - 5000));
      const changed = new Set();
      for (const r of j.rows) {
        if (inflight.has(key(r.coll, r.id))) continue;
        const cur = C(r.coll).get(r.id);
        if (cur === undefined || JSON.stringify(cur) !== JSON.stringify(r.data)) { set(r.coll, r.id, r.data); changed.add(r.coll); }
      }
      for (const d of j.deleted) {
        if (inflight.has(key(d.coll, d.id)) || !C(d.coll).has(d.id)) continue;
        set(d.coll, d.id, undefined); changed.add(d.coll);
      }
      since = j.now; if (changed.size) fire(changed);
    } catch (e) { signedOut(e); }
    finally { polling = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden) await poll(); schedule(); }, pollMs); }
  function stop() { clearTimeout(timer); timer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) poll(); });
  window.addEventListener("focus", () => { if (timer) poll(); });

  // Optimistic: the screen updates at once; if the server refuses, the change is rolled back and the error surfaces.
  const write = async (c, id, d, prev) => {
    const k = key(c, id); inflight.set(k, (inflight.get(k) || 0) + 1);
    set(c, id, d); fire(new Set([c]));
    try { await api("/api/write", { ops: [d === undefined ? { op: "delete", coll: c, id } : { op: "set", coll: c, id, data: d }] }); }
    catch (e) { set(c, id, prev); fire(new Set([c])); signedOut(e); throw e; }
    finally { const n = inflight.get(k) - 1; if (n > 0) inflight.set(k, n); else inflight.delete(k); }
  };
  const listen = (c, id, cb, err) => { const s = { c, id, cb }; subs.add(s); if (loaded) call(s); else ready.then(() => call(s), e => err && err(e)); return () => subs.delete(s); };
  const docApi = (c, id) => ({
    onSnapshot: (cb, err) => listen(c, id, cb, err),
    get: async () => { await ready; return snapDoc(c, id); },
    update: async patch => { await ready; const prev = C(c).get(id); if (prev === undefined) throw new Error("not_found"); await write(c, id, { ...prev, ...copy(patch) }, prev); },
    set: async d => { await ready; await write(c, id, copy(d), C(c).get(id)); },
    delete: async () => { await ready; await write(c, id, undefined, C(c).get(id)); },
  });
  // Many records in a few requests (used by Restore).
  async function bulkSet(rows, onProgress) {
    await ready;
    for (let i = 0; i < rows.length; i += 150) {
      const part = rows.slice(i, i + 150);
      await api("/api/write", { ops: part.map(r => ({ op: "set", coll: r.coll, id: r.id, data: r.data })) }).catch(e => { signedOut(e); throw e; });
      part.forEach(r => set(r.coll, r.id, copy(r.data))); fire(new Set(part.map(r => r.coll)));
      onProgress && onProgress(Math.min(rows.length, i + part.length));
    }
  }
  return {
    ready, poll, bulkSet,
    collection: c => ({
      onSnapshot: (cb, err) => listen(c, null, cb, err),
      add: async d => { await ready; const id = rid(); await write(c, id, copy(d), undefined); return { id }; },
      doc: id => docApi(c, id),
    }),
    doc: path => { const [c, id] = path.split("/"); return docApi(c, id); },
  };
}

// Native browser download.
export const downloader = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? "application/json" : "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return { status: "saved" };
  },
};
