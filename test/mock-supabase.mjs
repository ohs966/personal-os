// In-memory stand-in for @supabase/supabase-js used by the mock tests.
export const DB = globalThis.__DB__ ||= { tables: {}, users: {} };
const T = name => (DB.tables[name] ||= []);
const PK = { os_docs: ["coll", "id"], os_config: ["key"], telegram_links: ["chat_id"], telegram_pairing: ["code"], telegram_state: ["chat_id"] };

class Q {
  constructor(table) { this.t = table; this.filters = []; this.op = "select"; this.payload = null; this.rng = null; this.single = false; this.opts = {}; }
  select() { if (this.op === "select") this.op = "select"; return this; }
  eq(k, v) { this.filters.push(r => String(r[k]) === String(v)); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(p) { this.op = "insert"; this.payload = p; return this; }
  update(p) { this.op = "update"; this.payload = p; return this; }
  upsert(p, o) { this.op = "upsert"; this.payload = p; this.opts = o || {}; return this; }
  delete() { this.op = "delete"; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const rows = T(this.t), match = r => this.filters.every(f => f(r));
    const clone = x => JSON.parse(JSON.stringify(x));
    if (this.op === "select") {
      let out = rows.filter(match).map(clone);
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      return { data: this.single ? (out[0] ?? null) : out, error: null };
    }
    if (this.op === "insert") { for (const p of [].concat(this.payload)) rows.push(clone(p)); return { data: null, error: null }; }
    if (this.op === "update") { rows.filter(match).forEach(r => Object.assign(r, clone(this.payload))); return { data: null, error: null }; }
    if (this.op === "delete") { DB.tables[this.t] = rows.filter(r => !match(r)); return { data: null, error: null }; }
    if (this.op === "upsert") {
      const keys = this.opts.onConflict ? this.opts.onConflict.split(",") : PK[this.t];
      for (const p of [].concat(this.payload)) { const ex = rows.find(r => keys.every(k => String(r[k]) === String(p[k]))); if (ex) Object.assign(ex, clone(p)); else rows.push(clone(p)); }
      return { data: null, error: null };
    }
  }
}
export function createClient() {
  return { from: t => new Q(t), auth: { getUser: async jwt => ({ data: { user: DB.users[jwt] ?? null }, error: null }) } };
}
