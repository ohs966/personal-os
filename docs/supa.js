// The OS's data layer on Supabase. It gives the app the same collection/doc API it always used,
// backed by the os_docs table, with live updates so changes from Telegram appear instantly.
export function supaDb(sb, uid) {
  const cache = new Map(), subs = new Set(); let loaded = false;
  const C = c => { if (!cache.has(c)) cache.set(c, new Map()); return cache.get(c); };
  const copy = d => d === undefined ? undefined : JSON.parse(JSON.stringify(d));
  const snapColl = c => ({ docs: [...C(c).entries()].map(([id, d]) => ({ id, data: () => copy(d) })) });
  const snapDoc = (c, id) => { const d = C(c).get(id); return { exists: d !== undefined, data: () => copy(d) }; };
  const call = s => { try { s.id ? s.cb(snapDoc(s.c, s.id)) : s.cb(snapColl(s.c)); } catch (e) { console.error(e); } };
  const fire = c => { if (loaded) subs.forEach(s => { if (s.c === c) call(s); }); };
  const put = (c, id, d) => { if (d === undefined) C(c).delete(id); else C(c).set(id, d); fire(c); };
  const rid = () => { const a = new Uint8Array(20); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

  const ready = (async () => {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("os_docs").select("coll,id,data").range(from, from + 999);
      if (error) throw new Error(error.message);
      data.forEach(r => C(r.coll).set(r.id, r.data));
      if (data.length < 1000) break;
    }
    loaded = true;
  })();

  sb.channel("os-docs-" + uid)
    .on("postgres_changes", { event: "*", schema: "public", table: "os_docs", filter: `user_id=eq.${uid}` }, p => {
      if (p.eventType === "DELETE") { const o = p.old || {}; if (o.coll && o.id) put(o.coll, o.id, undefined); }
      else if (p.new && p.new.coll) put(p.new.coll, p.new.id, p.new.data);
    })
    .subscribe();

  // Optimistic: the screen updates at once; if the server refuses, the change is rolled back and the error surfaces.
  const write = async (c, id, d, prev) => {
    put(c, id, d);
    const q = d === undefined ? sb.from("os_docs").delete().eq("coll", c).eq("id", id)
      : sb.from("os_docs").upsert({ coll: c, id, user_id: uid, data: d }, { onConflict: "coll,id" });
    const { error } = await q;
    if (error) { put(c, id, prev); throw new Error(error.message); }
  };
  const listen = (c, id, cb, err) => { const s = { c, id, cb }; subs.add(s); if (loaded) call(s); else ready.then(() => call(s), e => err && err(e)); return () => subs.delete(s); };
  const docApi = (c, id) => ({
    onSnapshot: (cb, err) => listen(c, id, cb, err),
    get: async () => { await ready; return snapDoc(c, id); },
    update: async patch => { await ready; const prev = C(c).get(id); if (prev === undefined) throw new Error("not_found"); await write(c, id, { ...prev, ...copy(patch) }, prev); },
    set: async d => { await ready; await write(c, id, copy(d), C(c).get(id)); },
    delete: async () => { await ready; await write(c, id, undefined, C(c).get(id)); },
  });
  return {
    ready, uid,
    collection: c => ({
      onSnapshot: (cb, err) => listen(c, null, cb, err),
      add: async d => { await ready; const id = rid(); await write(c, id, copy(d), undefined); return { id }; },
      doc: id => docApi(c, id),
    }),
    doc: path => { const [c, id] = path.split("/"); return docApi(c, id); },
  };
}

// Native browser download (replaces the Claude-only downloads capability).
export const downloader = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? "application/json" : "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return { status: "saved" };
  },
};
