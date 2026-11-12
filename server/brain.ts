// The server half of the assistant. Same brain as the app: docs/core.js builds the system prompt,
// the snapshot, the free built-in commands and the confirmable operations.
import * as C from "../docs/core.js";
import { logSpend } from "./shims/d1.ts";
import { env } from "./env.ts";
import { browserOnly } from "./shims/browser.ts";

C.CLOCK.tz = "Africa/Cairo";

const model = () => env("TELEGRAM_CLAUDE_MODEL") || "claude-haiku-5-5";
// USD per million tokens [input, output]. Cache writes cost 1.25x input, cache reads 0.1x.
const PRICE: Record<string, [number, number]> = { "claude-haiku-5-5": [1, 5], "claude-sonnet-5-5": [3, 15], "claude-opus-5-5": [5, 25] };

export class Friendly extends Error {}

type Msg = { role: "user" | "assistant"; content: string };

async function claude(messages: Msg[], source: string): Promise<string> {
  const KEY = env("ANTHROPIC_API_KEY"), MODEL = model();
  if (!KEY) throw new Friendly("The Claude key isn't set yet (ANTHROPIC_API_KEY), so I can only do the built-in commands. Send /help to see them.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1000, temperature: 0.2,
      system: [
        { type: "text", text: C.brainSystem(), cache_control: { type: "ephemeral" } },
        { type: "text", text: C.brainSnapshot() },
      ],
      messages,
    }),
  });
  if (res.status === 429 || res.status === 529) throw new Friendly("Claude is busy, try again in a minute.");
  if (res.status === 401 || res.status === 403) throw new Friendly("The Claude key was refused. Check ANTHROPIC_API_KEY in the Cloudflare dashboard.");
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Friendly("Claude couldn't answer right now (" + (j?.error?.message || res.status) + ").");
  const u = j.usage || {};
  const [pi, po] = PRICE[MODEL] ?? PRICE["claude-haiku-5-5"];
  const usd = ((u.input_tokens || 0) * pi + (u.output_tokens || 0) * po + (u.cache_creation_input_tokens || 0) * pi * 1.25 + (u.cache_read_input_tokens || 0) * pi * 0.1) / 1e6;
  await logSpend({ source, model: MODEL, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
    cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, usd }).catch(e => console.error("spend log", e));
  return (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
}

export type Thought = { reply: string; ops: { op: string; coll: string; id?: string; data?: unknown; label: string }[]; doneText: string | null; via: "free" | "haiku" };

// convo: earlier messages (plain text). Data must already be loaded with C.loadDocs().
export async function think(text: string, convo: Msg[], source: string, opts: { skipFree?: boolean } = {}): Promise<Thought> {
  if (!opts.skipFree) {
    const free = await C.freeBrain(text);
    if (free) return { reply: free.text, ops: free.ops, doneText: free.text, via: "free" };
  }
  const hist: Msg[] = (convo || []).filter(m => m && m.content).slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 3000) }));
  while (hist.length && hist[0].role !== "user") hist.shift();
  const merged: Msg[] = [];
  for (const m of hist) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += "\n" + m.content; else merged.push({ ...m }); }
  const ask = text + (C.isArabic(text) ? "\n\n(Reply in Egyptian Arabic.)" : "");
  if (merged.length && merged[merged.length - 1].role === "user") merged[merged.length - 1].content += "\n" + ask; else merged.push({ role: "user", content: ask });

  let raw = await claude(merged, source);
  let plan = C.parsePlan(raw);
  if (!plan) {
    merged.push({ role: "assistant", content: raw }, { role: "user", content: "That wasn't valid JSON. Answer again with only the JSON object." });
    raw = await claude(merged, source); plan = C.parsePlan(raw);
    if (!plan) return { reply: C.noDash(raw).slice(0, 3500) || "Sorry, I couldn't work that out. Try rephrasing.", ops: [], doneText: null, via: "haiku" };
  }
  if (plan.read.length) {
    const results = plan.read.map((r: Record<string, unknown>) => C.readData(r)).join("\n\n");
    merged.push({ role: "assistant", content: raw }, { role: "user", content: "READ RESULTS:\n" + results + "\n\nNow give the final JSON answer (no more reads)." });
    raw = await claude(merged, source);
    plan = C.parsePlan(raw) ?? { reply: C.noDash(raw), read: [], actions: [] };
  }
  const prep = C.prepareActions(plan.actions);
  let reply = plan.reply || (prep.ops.length ? "Here's what I'll do:" : "Done.");
  if (prep.errors.length) reply += `\n\n(I couldn't prepare part of that: ${prep.errors.join("; ")}.)`;
  const b = browserOnly(prep.browser); if (b) reply += "\n\n" + b;
  return { reply, ops: prep.ops, doneText: null, via: "haiku" };
}
