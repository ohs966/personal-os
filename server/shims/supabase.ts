// Server shim: the OS talks to its own Supabase project with the service role.
// The browser app uses the signed-in user's session instead; this file is never shipped to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const SUPABASE_URL = URL;
export const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const rid = () => { const a = new Uint8Array(20); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

// All of one user's records, in the same { coll, id, data } shape the app loads.
export async function loadUserDocs(userId: string) {
  const out: { coll: string; id: string; data: Record<string, unknown> }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("os_docs").select("coll,id,data").eq("user_id", userId).range(from, from + 999);
    if (error) throw new Error("Couldn't load your data: " + error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// The store the shared runOps() writes through.
export function makeStore(userId: string) {
  const one = (coll: string, id: string) => sb.from("os_docs").select("data").eq("coll", coll).eq("id", id).eq("user_id", userId).maybeSingle();
  return {
    async add(coll: string, data: Record<string, unknown>) {
      const id = rid();
      const { error } = await sb.from("os_docs").insert({ coll, id, user_id: userId, data });
      if (error) throw new Error(error.message); return id;
    },
    async update(coll: string, id: string, patch: Record<string, unknown>) {
      const { data: row, error } = await one(coll, id);
      if (error) throw new Error(error.message);
      if (!row) throw new Error("That record no longer exists.");
      const { error: e2 } = await sb.from("os_docs").update({ data: { ...(row.data as Record<string, unknown>), ...patch } }).eq("coll", coll).eq("id", id).eq("user_id", userId);
      if (e2) throw new Error(e2.message);
    },
    async set(coll: string, id: string, data: Record<string, unknown>) {
      const { error } = await sb.from("os_docs").upsert({ coll, id, user_id: userId, data }, { onConflict: "coll,id" });
      if (error) throw new Error(error.message);
    },
    async del(coll: string, id: string) {
      const { error } = await sb.from("os_docs").delete().eq("coll", coll).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
  };
}
