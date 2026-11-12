// Mock end-to-end test of the bundled Cloudflare Worker: owner auth, sync API, in-app assistant and Telegram.
// D1 is simulated with node:sqlite running the real migration; Telegram, Gemini and Claude are faked.
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import assert from "assert";
import { rows } from "./load.mjs";

await build({ entryPoints: ["server/worker.ts"], outfile: "test/out/worker.mjs", bundle: true, format: "esm", platform: "neutral", target: "es2022", banner: { js: 'var location = { hash: "" };' }, logLevel: "error" });

// ---- D1 on node:sqlite ----
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync("migrations/0001_init.sql", "utf8"));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  async all() { return { results: sql.prepare(q).all(...args) }; },
  async first() { return sql.prepare(q).get(...args) ?? null; },
  async run() { return sql.prepare(q).run(...args); },
});
const DB = {
  prepare: q => stmt(q),
  async batch(list) { sql.exec("BEGIN"); try { const out = []; for (const s of list) out.push(await s.run()); sql.exec("COMMIT"); return out; } catch (e) { sql.exec("ROLLBACK"); throw e; } },
};
const q = (s, ...a) => sql.prepare(s).all(...a);
// seed with the real exported data
const seed = !process.env.NO_SEED && existsSync("/home/claude/pos/export") ? rows() : [];
for (const r of seed) sql.prepare("INSERT INTO os_docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?)").run(r.coll, r.id, JSON.stringify(r.data), 1);
if (!seed.length) sql.prepare("INSERT INTO os_docs (coll, id, data, updated_at) VALUES ('todos','nkgqpzq1cknkyl20qte1',?,1)").run(JSON.stringify({ text: "Update Blnka website", date: "2026-11-10", done: false, pri: "High" }));

const ENV = { DB, TELEGRAM_BOT_TOKEN: "123:ABC", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "k" };
const W = (await import("./out/worker.mjs")).default;
let bg = [];
const ctx = { waitUntil: p => bg.push(p) };
const settle = async () => { while (bg.length) { const b = bg; bg = []; await Promise.all(b); } };
const ORIGIN = "https://personal-os.omar.workers.dev";
async function call(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const h = { ...headers }; if (cookie) h.cookie = cookie; if (body !== undefined) h["content-type"] = "application/json";
  if (method !== "GET" && !("x-pos" in h)) h["x-pos"] = "1";
  const r = await W.fetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), ENV, ctx);
  await settle(); return r;
}

// ---- fake network ----
const sent = []; let claudeScript = []; const claudeCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const body = init.body ? JSON.parse(init.body) : null;
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.telegram.org/bot123:ABC/")) {
    const m = url.split("/").pop(); sent.push({ m, body });
    if (m === "getMe") return J({ ok: true, result: { username: "omar_personal_os_bot" } });
    if (m === "getFile") return J({ ok: true, result: { file_path: "voice/1.oga" } });
    return J({ ok: true, result: {} });
  }
  if (url.startsWith("https://api.telegram.org/file/")) return new Response(new Uint8Array([1, 2, 3, 4]));
  if (url.includes("generativelanguage")) { if (url.includes("3.5-flash-lite")) return J({ error: "nope" }, 404); return J({ candidates: [{ content: { parts: [{ text: "ايه اللي ورايا النهارده؟" }] } }] }); }
  if (url.startsWith("https://api.anthropic.com/")) {
    claudeCalls.push(body); const next = claudeScript.shift() ?? '{"reply":"ok","read":[],"actions":[]}';
    return J({ content: [{ type: "text", text: next }], usage: { input_tokens: 900, output_tokens: 80, cache_creation_input_tokens: 2100, cache_read_input_tokens: 0 } });
  }
  throw new Error("unexpected fetch " + url);
};

// ================= web app API =================
let r = await call("/api/me"); assert.deepEqual(await r.json(), { hasOwner: false, signedIn: false });
r = await call("/api/docs"); assert.equal(r.status, 401); console.log("docs without sign-in -> 401");
r = await call("/api/signup", { method: "POST", body: { email: "owner@example.com", password: "short" } }); assert.equal(r.status, 400);
r = await call("/api/signup", { method: "POST", body: { email: "owner@example.com", password: "a good password" }, headers: { "x-pos": "" } }); assert.equal(r.status, 403); console.log("missing X-POS header -> 403");
r = await call("/api/signup", { method: "POST", body: { email: "Owner@Example.com", password: "a good password" } }); assert.equal(r.status, 200);
const setc = r.headers.get("set-cookie"); assert.match(setc, /HttpOnly; Secure; SameSite=Lax/); const cookie = setc.split(";")[0];
assert.equal(q("SELECT email FROM owner")[0].email, "owner@example.com"); assert.ok(!JSON.stringify(q("SELECT * FROM owner")).includes("a good password"));
r = await call("/api/signup", { method: "POST", body: { email: "intruder@example.com", password: "another password" } }); assert.equal(r.status, 409); console.log("second sign-up refused -> 409");
r = await call("/api/me", { cookie }); assert.deepEqual(await r.json(), { hasOwner: true, signedIn: true });
r = await call("/api/login", { method: "POST", body: { email: "owner@example.com", password: "wrong one!" } }); assert.equal(r.status, 401);
r = await call("/api/login", { method: "POST", body: { email: "owner@example.com", password: "a good password" } }); assert.equal(r.status, 200); console.log("login ok");

r = await call("/api/docs", { cookie }); let j = await r.json(); assert.equal(j.rows.length, seed.length || 1); const t0 = j.now; console.log("loaded", j.rows.length, "records");
r = await call("/api/write", { method: "POST", cookie, body: { ops: [{ op: "set", coll: "todos", id: "t-web", data: { text: "From the web", date: "2026-11-14", done: false } }] } }); assert.equal(r.status, 200);
r = await call("/api/write", { method: "POST", cookie, body: { ops: [{ op: "set", coll: "bad coll!", id: "x", data: {} }] } }); assert.equal(r.status, 400);
r = await call(`/api/changes?since=${t0 - 1}`, { cookie }); j = await r.json(); assert.ok(j.rows.some(x => x.id === "t-web")); assert.equal(j.deleted.length, 0);
await call("/api/write", { method: "POST", cookie, body: { ops: [{ op: "delete", coll: "todos", id: "t-web" }] } });
r = await call(`/api/changes?since=${t0 - 1}`, { cookie }); j = await r.json(); assert.ok(j.deleted.some(x => x.id === "t-web")); assert.ok(!j.rows.some(x => x.id === "t-web")); console.log("write / changes / delete ok");

// in-app assistant (Haiku): returns a proposal, writes nothing
claudeScript = ['{"reply":"I\'ll add a goal for a new laptop.","read":[],"actions":[{"op":"create","section":"goals","fields":{"item":"New laptop","value":"Opens Doors","price":45000,"target":"2027-06-01"}}]}'];
const goalsBefore = q("SELECT COUNT(*) n FROM os_docs WHERE coll='goals'")[0].n;
r = await call("/api/assistant", { method: "POST", cookie, body: { text: "add a goal: new laptop 45k by June", convo: [] } }); j = await r.json();
console.log("app assistant ->", j.reply, j.ops.map(o => o.label)); assert.equal(j.ops.length, 1); assert.equal(q("SELECT COUNT(*) n FROM os_docs WHERE coll='goals'")[0].n, goalsBefore);
assert.equal(q("SELECT source FROM ai_spend")[0].source, "app");

// ================= Telegram =================
const T_SECRET = await (async () => { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("personal-os-telegram:123:ABC")); return Array.from(new Uint8Array(d).slice(0, 20), b => b.toString(16).padStart(2, "0")).join(""); })();
const post = (update, sec = T_SECRET) => call("/telegram", { method: "POST", body: update, headers: { "X-Telegram-Bot-Api-Secret-Token": sec, "x-pos": "" } });
const msg = (text, extra = {}) => ({ message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 9, username: "omar", first_name: "Omar" }, text, ...extra } });
const lastText = () => { const s = sent.filter(x => x.m === "sendMessage").pop(); return s ? s.body.text : null; };
const texts = () => sent.filter(x => x.m === "sendMessage").map(x => x.body.text);
const count = coll => q("SELECT COUNT(*) n FROM os_docs WHERE coll = ?", coll)[0].n;
const doc = (coll, id) => JSON.parse(q("SELECT data FROM os_docs WHERE coll = ? AND id = ?", coll, id)[0].data);
claudeCalls.length = 0;

// 1. setup
r = await call("/telegram?setup=1"); const sj = await r.json(); console.log("setup:", sj);
assert.equal(sj.bot, "@omar_personal_os_bot");
const wh = sent.find(x => x.m === "setWebhook"); assert.equal(wh.body.secret_token, T_SECRET); assert.equal(wh.body.url, ORIGIN + "/telegram");
assert.equal(q("SELECT value FROM config WHERE key='bot_username'")[0].value, "omar_personal_os_bot");

// 2. secret check
r = await post(msg("hi"), "wrong"); assert.equal(r.status, 401); console.log("bad secret -> 401");

// 3. unlinked chat is refused
sent.length = 0; await post(msg("what's for today?")); assert.match(lastText(), /private bot/); console.log("unlinked:", lastText());

// 4. pairing from the app card, expired code first
sql.prepare("INSERT INTO telegram_pairing (code, expires_at) VALUES ('111111', ?)").run(Date.now() - 1000);
await post(msg("/start 111111")); assert.match(lastText(), /wrong or has expired/);
r = await call("/api/telegram/pair", { method: "POST", cookie, body: {} }); const pair = await r.json();
assert.match(pair.code, /^\d{6}$/); assert.equal(pair.bot, "omar_personal_os_bot"); assert.ok(pair.expires_at - Date.now() > 14 * 60000);
await post(msg("/start " + pair.code)); assert.match(lastText(), /Linked/); assert.equal(q("SELECT COUNT(*) n FROM telegram_pairing")[0].n, 0);
console.log("paired:", lastText().split("\n")[0]);
r = await call("/api/telegram", { cookie }); j = await r.json(); assert.equal(j.links.length, 1); assert.equal(j.links[0].username, "omar");

// 5. a question answered by the free brain (no Claude call), with typing indicator
sent.length = 0; await post(msg("what's for today?"));
assert.equal(claudeCalls.length, 0); assert.ok(sent.some(x => x.m === "sendChatAction")); console.log("today ->", lastText().slice(0, 160).replace(/\n/g, " | "));

// 6. a change waits for confirm, then the button saves it
let before = count("todos"); sent.length = 0;
await post(msg("add call the accountant tomorrow high 30 min"));
let sm = sent.filter(x => x.m === "sendMessage").pop(); assert.ok(sm.body.reply_markup.inline_keyboard[0][0].text.includes("Confirm")); assert.equal(count("todos"), before);
console.log("proposal ->", sm.body.text.replace(/\n/g, " | "));
await post({ callback_query: { id: "cb1", data: "ok", message: { message_id: 7, chat: { id: 555 } } } });
assert.equal(count("todos"), before + 1); console.log("confirmed ->", lastText());
const added = q("SELECT data FROM os_docs WHERE coll='todos'").map(x => JSON.parse(x.data)).find(t => t.text === "Call the accountant"); assert.ok(added && added.pri === "High" && added.mins === 30);
// the web app sees it on its next poll
r = await call(`/api/changes?since=${Date.now() - 10000}`, { cookie }); j = await r.json(); assert.ok(j.rows.some(x => x.data.text === "Call the accountant")); console.log("web poll sees the Telegram change");

// 7. "لا" cancels, "تمام" confirms
await post(msg("spent 120 on coffee")); const moneyBefore = count("money");
await post(msg("لا")); assert.match(lastText(), /Cancelled/); assert.equal(count("money"), moneyBefore); console.log("cancel ->", lastText());
await post(msg("spent 120 on coffee")); await post(msg("تمام")); assert.equal(count("money"), moneyBefore + 1); console.log("تمام ->", lastText());

// 8. Arabic question goes to Haiku, with a read round
claudeScript = ['{"reply":"ثانية أشوف","read":[{"section":"tasks","search":"Blnka"}],"actions":[]}', '{"reply":"عندك مهمة تحدّث موقع Blnka.","read":[],"actions":[]}'];
sent.length = 0; await post(msg("ايه اللي ورايا النهارده؟"));
assert.equal(claudeCalls.length, 2); assert.equal(claudeCalls[0].model, "claude-haiku-5-5"); assert.equal(claudeCalls[0].system[0].cache_control.type, "ephemeral");
assert.match(claudeCalls[1].messages.at(-1).content, /READ RESULTS/);
console.log("arabic ->", lastText()); const sp = q("SELECT * FROM ai_spend WHERE source='telegram'"); assert.equal(sp.length, 2); console.log("spend rows:", sp.length, "usd", sp[0].usd.toFixed(6));

// 9. Haiku proposes changes (incl. a bad id and a browser-only op) -> confirm -> saved
claudeScript = ['{"reply":"I\'ll move the Blnka task to tomorrow and set your Transport budget to 3,000.","read":[],"actions":[{"op":"update","section":"tasks","id":"nkgqpzq1cknkyl20qte1","fields":{"date":"2026-11-14"}},{"op":"settings","action":"set_budget","category":"Transport","amount":3000},{"op":"update","section":"tasks","id":"nope","fields":{"done":true}},{"op":"backup"}]}'];
sent.length = 0; await post(msg("push the blnka website task to tomorrow and make transport budget 3000"));
sm = sent.filter(x => x.m === "sendMessage").pop(); console.log("haiku proposal ->", sm.body.text.replace(/\n/g, " | ")); assert.ok(sm.body.reply_markup);
await post({ callback_query: { id: "cb2", data: "ok", message: { message_id: 8, chat: { id: 555 } } } });
assert.equal(doc("todos", "nkgqpzq1cknkyl20qte1").date, "2026-11-14");
assert.equal(doc("app", "options").budgets.Transport, 3000);
console.log("saved ->", lastText().replace(/\n/g, " | "));

// 10. voice note: Gemini falls back past the first model and echoes what it heard
claudeScript = ['{"reply":"بكره عندك مهمة Blnka.","read":[],"actions":[]}'];
sent.length = 0; await post(msg(undefined, { text: undefined, voice: { file_id: "v1" } }));
assert.ok(texts().some(t => t.startsWith("🎙 ايه اللي ورايا"))); console.log("voice ->", texts().join(" || "));

// 11. memory capped at 12; /new resets
assert.ok(JSON.parse(q("SELECT convo FROM telegram_state WHERE chat_id = 555")[0].convo).length <= 12);
await post(msg("/new")); assert.equal(JSON.parse(q("SELECT convo FROM telegram_state WHERE chat_id = 555")[0].convo).length, 0); console.log("/new ->", lastText());

// 12. Disconnect from the app card; the chat is refused again
await call("/api/telegram/unlink", { method: "POST", cookie, body: { chat_id: 555 } });
sent.length = 0; await post(msg("what's for today?")); assert.match(lastText(), /private bot/); console.log("after disconnect:", lastText());

// 13. sign out kills the session; lockout after repeated wrong passwords
await call("/api/logout", { method: "POST", cookie }); r = await call("/api/docs", { cookie }); assert.equal(r.status, 401);
for (let i = 0; i < 8; i++) await call("/api/login", { method: "POST", body: { email: "owner@example.com", password: "guess " + i } });
r = await call("/api/login", { method: "POST", body: { email: "owner@example.com", password: "a good password" } }); assert.equal(r.status, 429); console.log("lockout ->", (await r.json()).error);

// 14. no em dashes anywhere we sent
assert.ok(!texts().join("").includes("—"));
console.log("\nALL WORKER MOCK TESTS PASSED");
