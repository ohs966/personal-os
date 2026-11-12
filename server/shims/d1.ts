// Server shim: the OS's data on its own Cloudflare D1 database. Used by the Telegram webhook,
// the in-app assistant and the app's API. The browser never talks to D1 directly.
import { db } from "../env.ts";

export const now = () => Date.now();
export const rid = () => { const a = new Uint8Array(20); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };
const parse = (s: unknown, d: unknown = null) => { try { return typeof s === "string" ? JSON.parse(s) : d; } catch { return d; } };

// All records, in the same { coll, id, data } shape the app loads.
export async function loadDocs() {
  const r = await db().prepare("SELECT coll, id, data FROM os_docs").all<{ coll: string; id: string; data: string }>();
  return r.results.map(x => ({ coll: x.coll, id: x.id, data: parse(x.data, {}) as Record<string, unknown> }));
}
export async function getDoc(coll: string, id: string) {
  const r = await db().prepare("SELECT data FROM os_docs WHERE coll = ? AND id = ?").bind(coll, id).first<{ data: string }>();
  return r ? parse(r.data, {}) as Record<string, unknown> : null;
}
export const upsertStmt = (coll: string, id: string, data: unknown, t = now()) =>
  db().prepare("INSERT INTO os_docs (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(coll, id, JSON.stringify(data ?? {}), t);
export const undeleteStmt = (coll: string, id: string) => db().prepare("DELETE FROM os_deleted WHERE coll = ? AND id = ?").bind(coll, id);
export const deleteStmts = (coll: string, id: string, t = now()) => [
  db().prepare("DELETE FROM os_docs WHERE coll = ? AND id = ?").bind(coll, id),
  db().prepare("INSERT INTO os_deleted (coll, id, deleted_at) VALUES (?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(coll, id, t),
];

// The store the shared runOps() writes through.
export function makeStore() {
  return {
    async add(coll: string, data: Record<string, unknown>) { const id = rid(); await db().batch([upsertStmt(coll, id, data), undeleteStmt(coll, id)]); return id; },
    async update(coll: string, id: string, patch: Record<string, unknown>) {
      const cur = await getDoc(coll, id); if (!cur) throw new Error("That record no longer exists.");
      await upsertStmt(coll, id, { ...cur, ...patch }).run();
    },
    async set(coll: string, id: string, data: Record<string, unknown>) { await db().batch([upsertStmt(coll, id, data), undeleteStmt(coll, id)]); },
    async del(coll: string, id: string) { await db().batch(deleteStmts(coll, id)); },
  };
}

export async function getConfig(key: string) { const r = await db().prepare("SELECT value FROM config WHERE key = ?").bind(key).first<{ value: string }>(); return r ? r.value : null; }
export async function setConfig(key: string, value: string) { await db().prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, now()).run(); }

export async function logSpend(row: { source: string; model: string; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; usd: number }) {
  await db().prepare("INSERT INTO ai_spend (at, source, model, input_tokens, output_tokens, cache_read, cache_write, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(now(), row.source, row.model, row.input_tokens, row.output_tokens, row.cache_read, row.cache_write, row.usd).run();
}

// ----- Telegram tables -----
export async function linkOf(chat: number) { return await db().prepare("SELECT chat_id FROM telegram_links WHERE chat_id = ?").bind(chat).first(); }
export async function addLink(chat: number, username: string | null, firstName: string | null) {
  await db().prepare("INSERT INTO telegram_links (chat_id, username, first_name, linked_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, linked_at = excluded.linked_at").bind(chat, username, firstName, now()).run();
}
export async function listLinks() { return (await db().prepare("SELECT chat_id, username, first_name, linked_at FROM telegram_links ORDER BY linked_at").all()).results; }
export async function removeLink(chat: number) { await db().batch([db().prepare("DELETE FROM telegram_links WHERE chat_id = ?").bind(chat), db().prepare("DELETE FROM telegram_state WHERE chat_id = ?").bind(chat)]); }

export async function newPairingCode() {
  const t = now(); await db().prepare("DELETE FROM telegram_pairing").run();   // one live code at a time
  const a = new Uint32Array(1); crypto.getRandomValues(a); const code = String(a[0] % 1000000).padStart(6, "0");
  const expires = t + 15 * 60 * 1000;
  await db().prepare("INSERT INTO telegram_pairing (code, expires_at) VALUES (?, ?)").bind(code, expires).run();
  return { code, expires_at: expires };
}
// Returns true and burns the code if it is valid.
export async function usePairingCode(code: string) {
  const r = await db().prepare("SELECT expires_at FROM telegram_pairing WHERE code = ?").bind(code).first<{ expires_at: number }>();
  if (!r || r.expires_at < now()) return false;
  await db().prepare("DELETE FROM telegram_pairing WHERE code = ?").bind(code).run();
  return true;
}

export type ChatState = { convo: { role: "user" | "assistant"; content: string }[]; pending: null | { ops: { label: string }[]; doneText: string | null; at: number } };
export async function getState(chat: number): Promise<ChatState> {
  const r = await db().prepare("SELECT convo, pending FROM telegram_state WHERE chat_id = ?").bind(chat).first<{ convo: string; pending: string | null }>();
  const convo = parse(r?.convo, []); return { convo: Array.isArray(convo) ? convo : [], pending: parse(r?.pending, null) as ChatState["pending"] };
}
export async function saveState(chat: number, st: ChatState) {
  await db().prepare("INSERT INTO telegram_state (chat_id, convo, pending, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_id) DO UPDATE SET convo = excluded.convo, pending = excluded.pending, updated_at = excluded.updated_at")
    .bind(chat, JSON.stringify(st.convo.slice(-12)), st.pending ? JSON.stringify(st.pending) : null, now()).run();
}
