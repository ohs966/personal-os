// In-app assistant endpoint. The OS calls this when its free built-in brain doesn't understand a message.
// Same brain as Telegram; it only proposes changes, the app shows them for Omar to confirm.
import * as C from "../docs/core.js";
import { sb, loadUserDocs } from "./shims/supabase.ts";
import { think, Friendly } from "./brain.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

export async function serve(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await sb.auth.getUser(jwt);
  const user = auth?.user; if (!user) return json({ error: "Please sign in again." }, 401);
  let body: { text?: string; convo?: { role: "user" | "assistant"; content: string }[] };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const text = String(body.text || "").trim().slice(0, 4000); if (!text) return json({ error: "Empty message" }, 400);
  try {
    C.loadDocs(await loadUserDocs(user.id));
    const r = await think(user.id, text, Array.isArray(body.convo) ? body.convo : [], "app", { skipFree: true });
    return json({ reply: r.reply, ops: r.ops, via: r.via });
  } catch (e) {
    if (e instanceof Friendly) return json({ reply: e.message, ops: [], via: "haiku" });
    console.error(e); return json({ error: "Something went wrong. Try again." }, 500);
  }
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function" && !(globalThis as any).__POS_TEST__) Deno.serve(serve);
