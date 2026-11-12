// Browser test of the Supabase-backed web app with a mock Supabase and a mock assistant function.
import { chromium } from "playwright";
import http from "http"; import fs from "fs"; import path from "path";
import { rows } from "./load.mjs";

const ROOT = "/home/claude/pos/docs", SHOTS = process.argv[2] || "/tmp";
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  if (p === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end('export const SUPABASE_URL = "https://ref.supabase.co"; export const SUPABASE_ANON_KEY = "anon";'); }
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript" : "text/html" }); fs.createReadStream(f).pipe(res);
}).listen(8765);

const seed = rows().map(r => ({ ...r, user_id: null }));
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on("pageerror", e => errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/fonts|ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push(m.text()); });
await pg.route("https://cdn.jsdelivr.net/npm/@supabase/**", r => r.fulfill({ path: "/home/claude/pos/test/mock-supabase-browser.js", contentType: "text/javascript" }));
let assistantCalls = [];
await pg.route("https://ref.supabase.co/functions/v1/assistant", async r => {
  const body = JSON.parse(r.request().postData()); assistantCalls.push({ body, auth: r.request().headers()["authorization"] });
  const goal = { op: "add", coll: "goals", data: { item: "New laptop", value: "Opens Doors", price: 45000, target: "2027-06-01", have: "Not Have", priority: "Medium", created: 1 }, label: 'Add goal "New laptop"' };
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ reply: "I'll add a goal for a new laptop — 45,000 EGP by June.", ops: [goal], via: "haiku" }) });
});
await pg.addInitScript(seed => { window.__DB__ = { tables: { os_docs: seed, telegram_links: [], ai_spend: [{ usd: 0.0123, at: new Date().toISOString(), user_id: "user-1" }] }, users: {}, session: JSON.parse(sessionStorage.getItem("mock-session") || "null"), rpcCalls: [], channels: [] };
  const saved = sessionStorage.getItem("mock-db"); if (saved) { const d = JSON.parse(saved); window.__DB__.tables = d.tables; window.__DB__.users = d.users; }
  window.addEventListener("beforeunload", () => sessionStorage.setItem("mock-db", JSON.stringify({ tables: window.__DB__.tables, users: window.__DB__.users }))); }, seed);
await pg.goto("http://localhost:8765/#today"); await pg.waitForTimeout(800);
console.log("auth shown:", await pg.isVisible("#auth"));
await pg.screenshot({ path: SHOTS + "/w-auth.png" });
// first-time account creation
await pg.fill("#auth-email", "owner@example.com"); await pg.fill("#auth-pass", "a-strong-pass");
await pg.click('button[data-create="1"]'); await pg.waitForLoadState("load"); await pg.waitForTimeout(1200);
console.log("after sign-up, auth hidden:", await pg.isHidden("#auth"));
for (const t of ["today", "goals", "plans", "business", "money", "insights", "options"]) { await pg.click(`[data-tab="${t}"]`); await pg.waitForTimeout(250); await pg.screenshot({ path: `${SHOTS}/w-${t}.png`, fullPage: false }); }
console.log("goals rows:", await pg.$$eval("#view tbody tr", r => r.length));
await pg.click('[data-tab="business"]'); await pg.waitForTimeout(150);
console.log("business tiles:", (await pg.innerText(".tiles")).replace(/\n/g, " | ").slice(0, 200));
console.log("realtime channel subscribed:", await pg.evaluate(() => window.__DB__.channels.length));

// add a task by hand, then undo
await pg.click('[data-tab="today"]'); await pg.fill("#td-new", "Test from web"); await pg.click("[data-todo] button"); await pg.waitForTimeout(250);
const count = () => pg.evaluate(() => window.__DB__.tables.os_docs.filter(r => r.coll === "todos").length);
console.log("todos after add:", await count()); await pg.click("#undo"); await pg.waitForTimeout(300); console.log("todos after undo:", await count());

// assistant: free brain applies instantly
await pg.click(".ai-fab"); await pg.waitForTimeout(200);
await pg.fill("#ai-q", "spent 300 on uber"); await pg.press("#ai-q", "Enter"); await pg.waitForTimeout(400);
console.log("free ->", (await pg.innerText(".ai-msg.bot >> nth=-1")).replace(/\n/g, " | "));
console.log("money rows:", await pg.evaluate(() => window.__DB__.tables.os_docs.filter(r => r.coll === "money" && r.data.amount === 300).length));
// Haiku: proposal waits for Confirm
await pg.fill("#ai-q", "add a goal: new laptop 45k by June"); await pg.press("#ai-q", "Enter"); await pg.waitForTimeout(500);
const goals = () => pg.evaluate(() => window.__DB__.tables.os_docs.filter(r => r.coll === "goals").length);
const g0 = await goals(); console.log("proposal shown:", await pg.isVisible("[data-aiok]"), "goals before confirm", g0, "auth header", assistantCalls[0]?.auth);
console.log("haiku bubble:", (await pg.innerText(".ai-msg.bot >> nth=-1")).replace(/\n/g, " | "));
await pg.click("[data-aiok]"); await pg.waitForTimeout(400); console.log("goals after confirm:", await goals());
await pg.click("[data-aiundo] >> nth=-1"); await pg.waitForTimeout(400); console.log("goals after undo:", await goals());
await pg.screenshot({ path: SHOTS + "/w-ai.png" });

// Telegram card
await pg.click('[data-ai="set"]'); await pg.waitForTimeout(300);
console.log("tg card:", (await pg.innerText("#tg-card")).replace(/\n/g, " | "));
const [popup] = await Promise.all([pg.waitForEvent("popup").catch(() => null), pg.click('[data-tg="connect"]')]);
await pg.waitForTimeout(300);
console.log("code shown:", (await pg.innerText(".tg-code")).replace(/\n/g, " "), "| popup:", popup ? popup.url() : "none", "| rpc:", await pg.evaluate(() => window.__DB__.rpcCalls));
await pg.screenshot({ path: SHOTS + "/w-tg.png" });
// a link appears (as if the bot paired) and can be disconnected
await pg.evaluate(() => window.__DB__.tables.telegram_links.push({ chat_id: 555, user_id: "user-1", username: "omar", first_name: "Omar", linked_at: new Date().toISOString() }));
await pg.click('[data-tg="refresh"]'); await pg.waitForTimeout(200); console.log("linked:", await pg.isVisible('[data-tg="unlink"]'));
await pg.click('[data-tg="unlink"]'); await pg.waitForTimeout(250); console.log("links after disconnect:", await pg.evaluate(() => window.__DB__.tables.telegram_links.length));
// mobile
await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(200); await pg.screenshot({ path: SHOTS + "/w-mobile.png" });
// second sign-up is refused
await pg.evaluate(() => { sessionStorage.removeItem("mock-session"); }); await pg.click('[data-tg="signout"]'); await pg.waitForTimeout(900);
await pg.fill("#auth-email", "someone@else.com"); await pg.fill("#auth-pass", "another-pass"); await pg.click('button[data-create="1"]'); await pg.waitForTimeout(300);
console.log("second sign-up:", await pg.textContent("#auth-msg"));
console.log("errors:", errs);
await b.close(); server.close();
