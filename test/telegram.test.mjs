// Mock end-to-end test of the bundled Telegram + assistant functions.
import { build } from "esbuild";
import { rows } from "./load.mjs";
import assert from "assert";

const alias = { name: "alias", setup(b) { b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: new URL("./mock-supabase.mjs", import.meta.url).pathname })); } };
for (const n of ["telegram", "assistant"]) await build({ entryPoints: [`server/${n}.ts`], outfile: `test/out/${n}.mjs`, bundle: true, format: "esm", platform: "neutral", target: "es2022", plugins: [alias], banner: { js: 'var location = { hash: "" };' }, logLevel: "error" });

const ENV = { TELEGRAM_BOT_TOKEN: "123:ABC", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "k", SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s" };
globalThis.Deno = { env: { get: k => ENV[k] } };
globalThis.__POS_TEST__ = true;
const OWNER = "user-1";
globalThis.__DB__ = { tables: { os_docs: rows().map(r => ({ ...r, user_id: OWNER })), os_config: [], telegram_links: [], telegram_pairing: [], telegram_state: [], ai_spend: [] }, users: { "jwt-good": { id: OWNER } } };
const DB = globalThis.__DB__;

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

const T = await import("./out/telegram.mjs"); const A = await import("./out/assistant.mjs");
const secret = await T.secretToken("123:ABC");
const post = (update, sec = secret) => T.serve(new Request("https://ref.supabase.co/functions/v1/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": sec, "content-type": "application/json" }, body: JSON.stringify(update) }));
const msg = (text, extra = {}) => ({ message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 9, username: "omar", first_name: "Omar" }, text, ...extra } });
const lastText = () => { const s = sent.filter(x => x.m === "sendMessage").pop(); return s ? s.body.text : null; };
const texts = () => sent.filter(x => x.m === "sendMessage").map(x => x.body.text);
const todos = () => DB.tables.os_docs.filter(r => r.coll === "todos");

// 1. setup
let r = await T.serve(new Request("https://ref.supabase.co/functions/v1/telegram?setup=1"));
const sj = await r.json(); console.log("setup:", sj);
assert.equal(sj.bot, "@omar_personal_os_bot");
const wh = sent.find(x => x.m === "setWebhook"); assert.equal(wh.body.secret_token, secret); assert.equal(wh.body.url, "https://ref.supabase.co/functions/v1/telegram");
assert.equal(DB.tables.os_config.find(c => c.key === "bot_username").value, "omar_personal_os_bot");

// 2. secret check
r = await post(msg("hi"), "wrong"); assert.equal(r.status, 401); console.log("bad secret -> 401");

// 3. unlinked chat is refused, no data leaks
sent.length = 0; await post(msg("what's for today?")); assert.match(lastText(), /private bot/); console.log("unlinked:", lastText());

// 4. pairing: expired code, then a valid one
DB.tables.telegram_pairing.push({ code: "111111", user_id: OWNER, expires_at: new Date(Date.now() - 1000).toISOString() });
await post(msg("/start 111111")); assert.match(lastText(), /wrong or has expired/);
DB.tables.telegram_pairing.push({ code: "482913", user_id: OWNER, expires_at: new Date(Date.now() + 15 * 60000).toISOString() });
await post(msg("/start 482913")); assert.match(lastText(), /Linked/); assert.equal(DB.tables.telegram_links[0].user_id, OWNER); assert.equal(DB.tables.telegram_pairing.find(p => p.code === "482913"), undefined);
console.log("paired:", lastText().split("\n")[0]);

// 5. a question answered by the free brain (no Claude call), with typing indicator
sent.length = 0; await post(msg("what's for today?"));
assert.equal(claudeCalls.length, 0); assert.ok(sent.some(x => x.m === "sendChatAction")); console.log("today ->", lastText().slice(0, 160).replace(/\n/g, " | "));

// 6. a change from the free brain waits for confirm, then the button saves it
const before = todos().length; sent.length = 0;
await post(msg("add call the accountant tomorrow high 30 min"));
let sm = sent.filter(x => x.m === "sendMessage").pop(); assert.ok(sm.body.reply_markup.inline_keyboard[0][0].text.includes("Confirm")); assert.equal(todos().length, before);
console.log("proposal ->", sm.body.text.replace(/\n/g, " | "));
await post({ callback_query: { id: "cb1", data: "ok", message: { message_id: 7, chat: { id: 555 } } } });
assert.equal(todos().length, before + 1); console.log("confirmed ->", lastText());
const added = todos().find(t => t.data.text === "Call the accountant"); assert.ok(added && added.data.pri === "High" && added.data.mins === 30);

// 7. reply "لا" cancels
await post(msg("spent 120 on coffee")); const moneyBefore = DB.tables.os_docs.filter(r => r.coll === "money").length;
await post(msg("لا")); assert.match(lastText(), /Cancelled/); assert.equal(DB.tables.os_docs.filter(r => r.coll === "money").length, moneyBefore); console.log("cancel ->", lastText());
// and "تمام" confirms
await post(msg("spent 120 on coffee")); await post(msg("تمام")); assert.equal(DB.tables.os_docs.filter(r => r.coll === "money").length, moneyBefore + 1); console.log("تمام ->", lastText());

// 8. Arabic question goes to Claude (Haiku), with a read round
claudeScript = ['{"reply":"ثانية أشوف","read":[{"section":"tasks","search":"Blnka"}],"actions":[]}', '{"reply":"عندك مهمتين من الأسبوع اللي فات: تختار ٦ صور وتحدّث موقع Blnka.","read":[],"actions":[]}'];
sent.length = 0; await post(msg("ايه اللي ورايا النهارده؟"));
assert.equal(claudeCalls.length, 2); assert.equal(claudeCalls[0].model, "claude-haiku-5-5"); assert.equal(claudeCalls[0].system[0].cache_control.type, "ephemeral");
assert.match(claudeCalls[1].messages.at(-1).content, /READ RESULTS/); assert.match(claudeCalls[0].messages.at(-1).content, /Egyptian Arabic/);
console.log("arabic ->", lastText()); console.log("spend rows:", DB.tables.ai_spend.length, "usd", DB.tables.ai_spend[0].usd.toFixed(6));

// 9. Claude proposes changes (incl. a bad id and a browser-only op) -> confirm buttons -> saved
claudeScript = ['{"reply":"I\'ll move the Blnka task to tomorrow and set your Transport budget to 3,000.","read":[],"actions":[{"op":"update","section":"tasks","id":"nkgqpzq1cknkyl20qte1","fields":{"date":"2026-11-13"}},{"op":"settings","action":"set_budget","category":"Transport","amount":3000},{"op":"update","section":"tasks","id":"nope","fields":{"done":true}},{"op":"backup"}]}'];
sent.length = 0; await post(msg("push the blnka website task to tomorrow and make transport budget 3000"));
sm = sent.filter(x => x.m === "sendMessage").pop(); console.log("haiku proposal ->", sm.body.text.replace(/\n/g, " | ")); assert.ok(sm.body.reply_markup);
await post({ callback_query: { id: "cb2", data: "ok", message: { message_id: 8, chat: { id: 555 } } } });
assert.equal(DB.tables.os_docs.find(r => r.id === "nkgqpzq1cknkyl20qte1").data.date, "2026-11-13");
assert.equal(DB.tables.os_docs.find(r => r.coll === "app" && r.id === "options").data.budgets.Transport, 3000);
console.log("saved ->", lastText().replace(/\n/g, " | "));

// 10. voice note: Gemini falls back past the first model, echoes what it heard
claudeScript = ['{"reply":"النهارده مفيش حاجة متسجلة، بس عندك مهمة Blnka بكره.","read":[],"actions":[]}'];
sent.length = 0; await post(msg(undefined, { text: undefined, voice: { file_id: "v1" } }));
assert.ok(texts().some(t => t.startsWith("🎙 ايه اللي ورايا"))); console.log("voice ->", texts().join(" || "));

// 11. /new resets memory; chat memory capped at 12
const st = DB.tables.telegram_state.find(s => s.chat_id === 555); assert.ok(st.convo.length <= 12); console.log("memory length", st.convo.length);
await post(msg("/new")); assert.equal(DB.tables.telegram_state.find(s => s.chat_id === 555).convo.length, 0); console.log("/new ->", lastText());

// 12. in-app endpoint: needs a valid user token, returns proposed ops (no writes)
let ar = await A.serve(new Request("https://ref.supabase.co/functions/v1/assistant", { method: "POST", headers: { Authorization: "Bearer bad" }, body: "{}" })); assert.equal(ar.status, 401);
claudeScript = ['{"reply":"I\'ll add a goal for a new laptop.","read":[],"actions":[{"op":"create","section":"goals","fields":{"item":"New laptop","value":"Opens Doors","price":45000,"target":"2027-06-01"}}]}'];
const goalsBefore = DB.tables.os_docs.filter(r => r.coll === "goals").length;
ar = await A.serve(new Request("https://ref.supabase.co/functions/v1/assistant", { method: "POST", headers: { Authorization: "Bearer jwt-good", "content-type": "application/json" }, body: JSON.stringify({ text: "add a goal: new laptop 45k by June", convo: [] }) }));
const aj = await ar.json(); console.log("app ->", aj.reply, aj.ops.map(o => o.label)); assert.equal(aj.ops.length, 1); assert.equal(DB.tables.os_docs.filter(r => r.coll === "goals").length, goalsBefore);
const opt = await A.serve(new Request("https://x/functions/v1/assistant", { method: "OPTIONS" })); assert.equal(opt.headers.get("Access-Control-Allow-Origin"), "*");

// 13. no em dashes anywhere we sent
assert.ok(!texts().join("").includes("—"));
console.log("\nALL TELEGRAM + ASSISTANT MOCK TESTS PASSED");
