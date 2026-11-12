// Telegram webhook for the Personal OS assistant.
// Text or voice in, short answer out. Questions answer straight away; changes wait for ✓ Confirm / ✕ Cancel.
// Calling the function with ?setup=1 registers the webhook and saves the bot's @username.
import * as C from "../docs/core.js";
import { loadDocs, makeStore, setConfig, linkOf, addLink, usePairingCode, getState, saveState, type ChatState } from "./shims/d1.ts";
import { think, Friendly } from "./brain.ts";
import { env, type Ctx } from "./env.ts";

const token = () => env("TELEGRAM_BOT_TOKEN");
const api = () => `https://api.telegram.org/bot${token()}`;
const PRIVATE = "🔒 This is a private bot for one Personal OS. To link this chat, open the OS, then Assistant, Settings, and press Connect Telegram.";
const KEYBOARD = { inline_keyboard: [[{ text: "✓ Confirm", callback_data: "ok" }, { text: "✕ Cancel", callback_data: "no" }]] };

// The webhook secret is derived from the bot token, so it changes if the token is ever rotated.
export async function secretToken(t = token()) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("personal-os-telegram:" + t)));
  return Array.from(h.slice(0, 20), b => b.toString(16).padStart(2, "0")).join("");
}

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${api()}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) console.error("telegram", method, j?.description ?? r.status);
  return j;
}

async function send(chat: number, md: string, markup?: unknown) {
  const html = C.toTelegramHtml(md || "…");
  const parts: string[] = [];
  for (let s = html; s.length; ) { let cut = s.length > 3900 ? s.lastIndexOf("\n", 3900) : s.length; if (cut < 1000) cut = Math.min(3900, s.length); parts.push(s.slice(0, cut)); s = s.slice(cut).replace(/^\n+/, ""); }
  for (let i = 0; i < parts.length; i++) {
    const extra = i === parts.length - 1 && markup ? { reply_markup: markup } : {};
    const r = await tg("sendMessage", { chat_id: chat, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true, ...extra });
    if (!r.ok) await tg("sendMessage", { chat_id: chat, text: parts[i].replace(/<[^>]+>/g, ""), ...extra });
  }
}

type State = ChatState;

// ---------- voice notes (Gemini, lite models first, 25 s each) ----------
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];
async function transcribe(fileId: string) {
  const GEMINI = env("GEMINI_API_KEY");
  if (!GEMINI) throw new Friendly("Voice notes need the GEMINI_API_KEY secret. Type your message for now. / اكتبلي الرسالة لحد ما مفتاح Gemini يتضاف.");
  const f = await tg("getFile", { file_id: fileId });
  if (!f.ok) throw new Friendly("I couldn't download that voice note. Try again.");
  const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${token()}/${f.result.file_path}`)).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
  const data = btoa(bin);
  for (const model of GEMINI_MODELS) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": GEMINI },
        body: JSON.stringify({ contents: [{ parts: [
          { text: "Transcribe this voice note exactly as spoken. It may be Egyptian Arabic, English, or a mix. Reply with only the transcript, no notes." },
          { inline_data: { mime_type: "audio/ogg", data } }] }], generationConfig: { temperature: 0 } }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (text) return text;
    } catch (_) { /* try the next model */ } finally { clearTimeout(t); }
  }
  throw new Friendly("I couldn't make out that voice note. Please type it. / مقدرتش أفهم الفويس، اكتبهالي.");
}

// ---------- pairing ----------
async function pair(chat: number, code: string, from: { username?: string; first_name?: string } = {}) {
  if (!(await usePairingCode(code))) return send(chat, "That code is wrong or has expired. In the OS, press **Connect Telegram** again.");
  await addLink(chat, from.username ?? null, from.first_name ?? null);
  await saveState(chat, { convo: [], pending: null });
  return send(chat, `✅ Linked to your Personal OS${from.first_name ? ", " + from.first_name : ""}.\n\nTry **what's for today?**, **spent 200 on lunch**, or send a voice note.`);
}

// ---------- a conversation turn ----------
async function turn(chat: number, q: string) {
  const tick = () => tg("sendChatAction", { chat_id: chat, action: "typing" });
  tick(); const iv = setInterval(tick, 4500);
  try {
    const [st, rows] = await Promise.all([getState(chat), loadDocs()]);
    C.loadDocs(rows);
    if (st.pending) {
      if (C.CONFIRM_RE.test(q)) return await decide(chat, true, st);
      if (C.CANCEL_RE.test(q)) return await decide(chat, false, st);
      st.pending = null;   // a new request replaces an unconfirmed one
    }
    let r;
    try { r = await think(q, st.convo, "telegram"); }
    catch (e) { const msg = e instanceof Friendly ? e.message : "Something went wrong. Try again in a moment."; if (!(e instanceof Friendly)) console.error(e); await send(chat, msg); return; }
    st.convo.push({ role: "user", content: q });
    if (r.ops.length) {
      st.pending = { ops: r.ops, doneText: r.doneText, at: Date.now() };
      const intro = r.via === "free" ? "" : r.reply + "\n\n";
      await send(chat, `${intro}**Confirm?**\n${r.ops.map(o => "- " + o.label).join("\n")}\n\nTap a button, or reply "تمام" / "لا".`, KEYBOARD);
      st.convo.push({ role: "assistant", content: `${r.via === "free" ? "" : r.reply + " "}[Proposed, waiting for confirm: ${r.ops.map(o => o.label).join("; ")}]` });
    } else {
      await send(chat, r.reply);
      st.convo.push({ role: "assistant", content: r.reply });
    }
    await saveState(chat, st);
  } finally { clearInterval(iv); }
}

async function decide(chat: number, yes: boolean, st?: State) {
  st = st ?? await getState(chat);
  if (!st.pending) return send(chat, "There's nothing waiting for confirmation.");
  const p = st.pending; st.pending = null;
  if (!yes) { st.convo.push({ role: "assistant", content: "[Cancelled. Nothing was changed.]" }); await saveState(chat, st); return send(chat, "✕ Cancelled. Nothing was changed."); }
  if (Date.now() - p.at > 6 * 3600 * 1000) { await saveState(chat, st); return send(chat, "That was a while ago, so I didn't apply it. Ask me again."); }
  try {
    const done = await C.runOps(makeStore(), p.ops as never);
    st.convo.push({ role: "assistant", content: `[Confirmed and saved: ${done.join("; ")}]` });
    await saveState(chat, st);
    return send(chat, "✓ " + (p.doneText || `Done:\n${done.map((d: string) => "- " + d).join("\n")}`));
  } catch (e) {
    await saveState(chat, st);
    return send(chat, "Something failed while saving: " + (e instanceof Error ? e.message : String(e)) + ". Check the OS before trying again.");
  }
}

// ---------- update router ----------
type Update = { message?: Record<string, any>; callback_query?: Record<string, any> };
export async function handle(u: Update) {
  if (u.callback_query) {
    const cq = u.callback_query, chat = cq.message?.chat?.id;
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (!chat) return;
    if (!(await linkOf(chat))) return send(chat, PRIVATE);
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    return decide(chat, cq.data === "ok");
  }
  const m = u.message; if (!m || !m.chat) return;
  const chat: number = m.chat.id;
  if (m.chat.type !== "private") return;
  const text = String(m.text ?? m.caption ?? "").trim();
  if (text.startsWith("/start")) {
    const code = (text.split(/\s+/)[1] || "").replace(/\D/g, "");
    if (code) return pair(chat, code, m.from);
    return send(chat, (await linkOf(chat)) ? "You're connected. Ask me anything, like **what's for today?**" : PRIVATE);
  }
  const link = await linkOf(chat);
  if (!link) return send(chat, PRIVATE);
  if (text === "/new") { await saveState(chat, { convo: [], pending: null }); return send(chat, "🆕 Fresh start. What can I do for you?"); }
  if (text === "/help") return send(chat, C.HELP.replace("For anything else I use Haiku, unless you set me to Free only.", "For anything else I ask Claude Haiku. Voice notes work too, and /new starts a fresh chat."));
  let q = text;
  const voice = m.voice || m.audio;
  if (!q && voice) {
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    try { q = await transcribe(voice.file_id); } catch (e) { return send(chat, e instanceof Friendly ? e.message : "I couldn't process that voice note."); }
    await send(chat, "🎙 " + q);
  }
  if (!q) return send(chat, "Send me a text or a voice note.");
  return turn(chat, q);
}

async function setup(origin: string) {
  if (!token()) return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN isn't set yet. Add it in the Cloudflare dashboard, then open this link again." }, { status: 400 });
  const me = await tg("getMe", {});
  if (!me.ok) return Response.json({ ok: false, error: "Telegram refused the bot token. Check TELEGRAM_BOT_TOKEN." }, { status: 400 });
  await setConfig("bot_username", me.result.username);
  const url = `${origin}/telegram`;
  const wh = await tg("setWebhook", { url, secret_token: await secretToken(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await tg("setMyCommands", { commands: [{ command: "new", description: "Start a fresh chat" }, { command: "help", description: "What I can do" }] });
  return Response.json({ ok: !!wh.ok, bot: "@" + me.result.username, webhook: url, note: wh.ok ? "All set. Now press Connect Telegram in the OS." : wh.description });
}

export async function serve(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("setup") === "1") return setup(url.origin);
  if (req.method !== "POST") return new Response("Personal OS Telegram bot is running.");
  if (!token() || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== await secretToken()) return new Response("forbidden", { status: 401 });
  let update: Update; try { update = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  // Answer Telegram at once; the work continues in the background.
  ctx.waitUntil(handle(update).catch(e => console.error("telegram handler", e)));
  return new Response("ok");
}
