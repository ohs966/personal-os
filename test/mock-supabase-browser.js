// Browser stand-in for supabase-js (served in place of the CDN module during tests).
const W = window;
const DB = W.__DB__ ||= { tables: { os_docs: [], telegram_links: [], ai_spend: [] }, users: {}, session: null, rpcCalls: [], channels: [] };
const T = n => (DB.tables[n] ||= []);
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = "select"; this.p = null; this.rng = null; this.o = {}; this.ord = null; }
  select() { return this; } order(k) { this.ord = k; return this; }
  eq(k, v) { this.f.push(r => String(r[k]) === String(v)); return this; }
  gte(k, v) { this.f.push(r => String(r[k]) >= String(v)); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(p) { this.op = "insert"; this.p = p; return this; }
  upsert(p, o) { this.op = "upsert"; this.p = p; this.o = o || {}; return this; }
  update(p) { this.op = "update"; this.p = p; return this; }
  delete() { this.op = "delete"; return this; }
  then(a, b) { return new Promise(r => setTimeout(r, 5)).then(() => this.run()).then(a, b); }
  run() {
    const rows = T(this.t), m = r => this.f.every(f => f(r)), c = x => JSON.parse(JSON.stringify(x));
    if (DB.failNext) { DB.failNext = false; return { data: null, error: { message: "simulated network error" } }; }
    if (this.op === "select") { let o = rows.filter(m).map(c); if (this.rng) o = o.slice(this.rng[0], this.rng[1] + 1); return { data: this.single ? o[0] ?? null : o, error: null }; }
    if (this.op === "delete") { DB.tables[this.t] = rows.filter(r => !m(r)); return { data: null, error: null }; }
    if (this.op === "update") { rows.filter(m).forEach(r => Object.assign(r, c(this.p))); return { data: null, error: null }; }
    const keys = (this.o.onConflict || "coll,id").split(",");
    for (const p of [].concat(this.p)) { const ex = rows.find(r => keys.every(k => r[k] === p[k])); if (ex) Object.assign(ex, c(p)); else rows.push(c(p)); }
    return { data: null, error: null };
  }
}
export function createClient() {
  const listeners = [];
  return {
    from: t => new Q(t),
    rpc: async name => { DB.rpcCalls.push(name); return name === "create_telegram_pairing" ? { data: { code: "482913", bot: "omar_personal_os_bot", expires_at: new Date(Date.now() + 9e5).toISOString() }, error: null } : { data: null, error: { message: "no rpc" } }; },
    channel: name => { const ch = { name, on: (...a) => { ch.args = a; return ch; }, subscribe: () => { DB.channels.push(ch); return ch; } }; return ch; },
    auth: {
      getSession: async () => ({ data: { session: DB.session } }),
      signUp: async ({ email, password }) => { if (Object.keys(DB.users).length) return { error: { message: "This Personal OS already has its owner." } }; DB.users[email] = { id: "user-1", email, password }; DB.tables.os_docs.forEach(r => { if (!r.user_id) r.user_id = "user-1"; }); return { data: {}, error: null }; },
      signInWithPassword: async ({ email, password }) => { const u = DB.users[email]; if (!u || u.password !== password) return { error: { message: "Invalid login credentials" } }; DB.session = { access_token: "jwt-good", user: { id: u.id, email } }; sessionStorage.setItem("mock-session", JSON.stringify(DB.session)); return { data: {}, error: null }; },
      signOut: async () => { DB.session = null; sessionStorage.removeItem("mock-session"); },
      onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
}
