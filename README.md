# Personal OS

Omar's Personal Development OS: the web app, its own backend, and its own Telegram assistant.
Everything runs on Cloudflare's free plan, so it works with the laptop off. Nothing is shared with any other system.

## Layout

| Path | What it is |
| --- | --- |
| `docs/` | The web app (static files): `index.html`, `app.js`, `cfdb.js` (data layer), `core.js` (shared brain) |
| `server/worker.ts` | The Cloudflare Worker: serves `docs/`, the API at `/api/*` and the Telegram webhook at `/telegram` |
| `server/api.ts` | Owner sign-in, data sync, in-app assistant, Telegram card endpoints |
| `server/telegram.ts` | Telegram bot: text and voice, confirm or cancel changes, pairing |
| `server/brain.ts` | Free brain first, then Claude Haiku; every Claude call is logged to `ai_spend` |
| `server/shims/` | D1 store and browser-only fallbacks used by the shared brain |
| `migrations/` | D1 (SQLite) schema |
| `build.mjs` | esbuild: bundles `docs/core.js` + `server/*` into `dist/worker.js` |
| `.github/workflows/deploy.yml` | On every push to `main`: test, build, create the D1 database if needed, migrate, deploy |

## Data

- `os_docs` holds every record as `{coll, id, data}`. `os_deleted` remembers deletions so other devices catch them.
- The app loads everything once, then asks `/api/changes` every 4 seconds while the tab is open, so changes made from Telegram show up on their own.
- Only one owner account can exist. Passwords are hashed with PBKDF2; sessions are HttpOnly cookies; every write needs the `X-POS: 1` header. 8 wrong passwords lock sign-in for 15 minutes.

## Secrets (added by Omar in dashboards, never in code or chat)

- GitHub, repo Settings, Secrets and variables, Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Cloudflare, Workers and Pages, personal-os, Settings, Variables and Secrets: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, optional `TELEGRAM_CLAUDE_MODEL` (default `claude-haiku-5-5`)

## Telegram

1. Create the bot with @BotFather and add `TELEGRAM_BOT_TOKEN` in Cloudflare.
2. Open `https://<worker>/telegram?setup=1` once. It registers the webhook (with a secret header derived from the token) and saves the bot's @username.
3. In the OS: Assistant, Settings, Connect Telegram. That makes a 6-digit code valid for 15 minutes and opens `t.me/<bot>?start=<code>`.

Reads run at once. Changes come back with Confirm / Cancel buttons ("تمام" / "لا" also work). `/new` starts fresh. Voice notes are transcribed by Gemini.

## Tests

```
node build.mjs
NO_SEED=1 node test/worker.test.mjs   # mock D1 (node:sqlite), Telegram, Gemini and Claude
```
