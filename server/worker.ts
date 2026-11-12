// Personal OS Worker: serves the web app (docs/), its API (/api/*) and the Telegram webhook (/telegram).
import { setEnv, type Env, type Ctx } from "./env.ts";
import { serve as telegram } from "./telegram.ts";
import { serve as api } from "./api.ts";

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    setEnv(env);
    const path = new URL(req.url).pathname;
    try {
      if (path === "/telegram") return await telegram(req, ctx);
      if (path.startsWith("/api/")) return await api(req, ctx);
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
  },
};
