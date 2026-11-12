// Per-request Cloudflare bindings and secrets. Set once at the top of each request by worker.ts.
// Secrets (TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY, TELEGRAM_CLAUDE_MODEL) are added in the
// Cloudflare dashboard, never in code.
export type D1 = {
  prepare(sql: string): { bind(...v: unknown[]): D1Stmt } & D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
};
export type D1Stmt = { all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> };
export type Env = { DB: D1; ASSETS?: { fetch(r: Request): Promise<Response> }; [k: string]: unknown };
export type Ctx = { waitUntil(p: Promise<unknown>): void };

let E: Env | null = null;
export const setEnv = (e: Env) => { E = e; };
export const env = (k: string): string => (E && typeof E[k] === "string" ? (E[k] as string) : "");
export const db = (): D1 => { if (!E || !E.DB) throw new Error("Database binding DB is missing."); return E.DB; };
