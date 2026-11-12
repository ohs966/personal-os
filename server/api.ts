// The OS's own API, served by the Worker at /api/*. Only the owner, signed in, can use it.
import * as C from "../docs/core.js";
import { db, type Ctx } from "./env.ts";
import { now, loadDocs, upsertStmt, undeleteStmt, deleteStmts, getConfig, setConfig, listLinks, removeLink, newPairingCode } from "./shims/d1.ts";
import { think, Friendly } from "./brain.ts";

const COOKIE = "pos_session";
const ITER = 25000;   // fits the free plan CPU budget; wrong guesses are also locked out after 8 tries
const SESSION_MS = 90 * 24 * 3600 * 1000;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function pbkdf2(password: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g)!.map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const cookieOf = (req: Request) => (req.headers.get("cookie") || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === COOKIE)?.[1] || "";
const setCookie = (token: string, maxAgeSec: number) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

async function newSession(req: Request) {
  const a = new Uint8Array(32); crypto.getRandomValues(a); const token = hex(a);
  await db().prepare("INSERT INTO sessions (token_hash, created_at, expires_at, agent) VALUES (?, ?, ?, ?)").bind(await sha(token), now(), now() + SESSION_MS, (req.headers.get("user-agent") || "").slice(0, 200)).run();
  await db().prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run();
  return setCookie(token, SESSION_MS / 1000);
}
async function signedIn(req: Request) {
  const t = cookieOf(req); if (!t) return false;
  const r = await db().prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(await sha(t)).first<{ expires_at: number }>();
  return !!r && r.expires_at > now();
}
const ownerRow = () => db().prepare("SELECT email, pass_hash, salt, iterations FROM owner WHERE id = 1").first<{ email: string; pass_hash: string; salt: string; iterations: number }>();

async function body(req: Request) { try { return await req.json(); } catch { return {}; } }

export async function serve(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url), path = url.pathname, method = req.method;
  // Writes must come from the app itself (custom header => browsers block cross-site attempts).
  if (method !== "GET" && req.headers.get("x-pos") !== "1") return json({ error: "Forbidden" }, 403);

  if (path === "/api/me") { const o = await ownerRow(); return json({ hasOwner: !!o, signedIn: await signedIn(req) }); }

  if (path === "/api/signup" && method === "POST") {
    const { email, password } = await body(req);
    if (await ownerRow()) return json({ error: "This OS already has its owner. Sign in instead." }, 409);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || "")) || String(password || "").length < 8) return json({ error: "Enter your email and a password of at least 8 characters." }, 400);
    const s = new Uint8Array(16); crypto.getRandomValues(s); const salt = hex(s);
    try {
      await db().prepare("INSERT INTO owner (id, email, pass_hash, salt, iterations, created_at) VALUES (1, ?, ?, ?, ?, ?)").bind(String(email).trim().toLowerCase(), await pbkdf2(String(password), salt, ITER), salt, ITER, now()).run();
    } catch { return json({ error: "This OS already has its owner. Sign in instead." }, 409); }
    return json({ ok: true }, 200, { "set-cookie": await newSession(req) });
  }

  if (path === "/api/login" && method === "POST") {
    const lock = JSON.parse((await getConfig("login_lock")) || '{"n":0,"until":0}');
    if (lock.until > now()) return json({ error: `Too many wrong attempts. Try again in ${Math.ceil((lock.until - now()) / 60000)} minutes.` }, 429);
    const { email, password } = await body(req); const o = await ownerRow();
    const ok = !!o && o.email === String(email || "").trim().toLowerCase() && same(await pbkdf2(String(password || ""), o.salt, o.iterations), o.pass_hash);
    if (!ok) {
      const n = lock.n + 1; await setConfig("login_lock", JSON.stringify(n >= 8 ? { n: 0, until: now() + 15 * 60000 } : { n, until: 0 }));
      return json({ error: o ? "Wrong email or password." : "No account yet. Use First time? Create account." }, 401);
    }
    await setConfig("login_lock", '{"n":0,"until":0}');
    return json({ ok: true }, 200, { "set-cookie": await newSession(req) });
  }

  if (path === "/api/logout" && method === "POST") {
    const t = cookieOf(req); if (t) await db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha(t)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
  }

  // ---------- everything below needs the owner signed in ----------
  if (!(await signedIn(req))) return json({ error: "Please sign in again." }, 401);

  if (path === "/api/docs" && method === "GET") {
    const t = now(); const r = await db().prepare("SELECT coll, id, data FROM os_docs").all<{ coll: string; id: string; data: string }>();
    return json({ now: t, rows: r.results.map(x => ({ coll: x.coll, id: x.id, data: JSON.parse(x.data) })) });
  }
  if (path === "/api/changes" && method === "GET") {
    const since = Number(url.searchParams.get("since") || 0), t = now();
    const [rows, del] = await Promise.all([
      db().prepare("SELECT coll, id, data FROM os_docs WHERE updated_at > ?").bind(since).all<{ coll: string; id: string; data: string }>(),
      db().prepare("SELECT coll, id FROM os_deleted WHERE deleted_at > ?").bind(since).all<{ coll: string; id: string }>(),
    ]);
    if (Math.random() < 0.02) ctx.waitUntil(db().prepare("DELETE FROM os_deleted WHERE deleted_at < ?").bind(t - 30 * 24 * 3600 * 1000).run());
    return json({ now: t, rows: rows.results.map(x => ({ coll: x.coll, id: x.id, data: JSON.parse(x.data) })), deleted: del.results });
  }
  if (path === "/api/write" && method === "POST") {
    const { ops } = await body(req); if (!Array.isArray(ops) || !ops.length || ops.length > 200) return json({ error: "Bad request" }, 400);
    const t = now(), stmts = [];
    for (const o of ops) {
      const coll = String(o.coll || ""), id = String(o.id || "");
      if (!/^[A-Za-z0-9_]{1,40}$/.test(coll) || !id || id.length > 200) return json({ error: "Bad record id" }, 400);
      if (o.op === "set") { if (typeof o.data !== "object" || o.data === null) return json({ error: "Bad data" }, 400); stmts.push(upsertStmt(coll, id, o.data, t), undeleteStmt(coll, id)); }
      else if (o.op === "delete") stmts.push(...deleteStmts(coll, id, t));
      else return json({ error: "Bad op" }, 400);
    }
    await db().batch(stmts);
    return json({ ok: true, now: t });
  }
  if (path === "/api/assistant" && method === "POST") {
    const b = await body(req); const text = String(b.text || "").trim().slice(0, 4000); if (!text) return json({ error: "Empty message" }, 400);
    try {
      C.loadDocs(await loadDocs());
      const r = await think(text, Array.isArray(b.convo) ? b.convo : [], "app", { skipFree: true });
      return json({ reply: r.reply, ops: r.ops, via: r.via });
    } catch (e) {
      if (e instanceof Friendly) return json({ reply: e.message, ops: [], via: "haiku" });
      console.error(e); return json({ error: "Something went wrong. Try again." }, 500);
    }
  }
  if (path === "/api/telegram" && method === "GET") {
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const [links, bot, spend] = await Promise.all([listLinks(), getConfig("bot_username"),
      db().prepare("SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS calls FROM ai_spend WHERE at >= ?").bind(month.getTime()).first<{ usd: number; calls: number }>()]);
    return json({ bot, links, spendMonth: spend?.usd ?? 0, callsMonth: spend?.calls ?? 0 });
  }
  if (path === "/api/telegram/pair" && method === "POST") { const c = await newPairingCode(); return json({ ...c, bot: await getConfig("bot_username") }); }
  if (path === "/api/telegram/unlink" && method === "POST") { const { chat_id } = await body(req); await removeLink(Number(chat_id)); return json({ ok: true }); }

  return json({ error: "Not found" }, 404);
}
