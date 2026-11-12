# Personal OS

Omar's Personal Development OS: daily tasks, life goals and plans, businesses (payouts, clients and products, milestones, maintenance), personal money, insights, and an assistant you can also text on Telegram.

Everything here belongs to this OS only: its own Supabase project, its own tables, its own Edge Functions and its own Telegram bot.

## Layout

| Path | What it is |
| --- | --- |
| `docs/index.html`, `docs/app.js` | The web app (served by GitHub Pages). |
| `docs/core.js` | Shared logic and the assistant's brain: data helpers, the snapshot, the system prompt, the free built-in commands and the confirmable actions. Used by the web app **and** bundled into the Edge Functions. |
| `docs/supa.js` | The app's data layer on Supabase (`os_docs` table, live updates). |
| `docs/config.js` | The project URL and publishable key (safe to be public; RLS protects the data). |
| `server/telegram.ts` | Telegram webhook: pairing, text and voice in, confirm/cancel, chat memory. |
| `server/assistant.ts` | The in-app endpoint the web assistant calls when the free brain doesn't understand. |
| `server/brain.ts` | Server half of the brain: Claude Haiku call with a cached system prompt, read round, spend log. |
| `server/shims/` | Server versions of browser-only parts (service-role Supabase client, "do this inside the OS"). |
| `supabase/functions/*/index.ts` | **Generated** by `node build.mjs` (esbuild). Don't edit by hand. |
| `supabase/migrations/` | Database: `os_docs`, `os_config`, `telegram_links`, `telegram_pairing`, `telegram_state`, `ai_spend`, the pairing RPC, the single-owner lock. |
| `test/` | Mock tests: `node test/core.test.mjs`, `node test/telegram.test.mjs`, `node test/web.test.mjs`. |

## How the assistant thinks

1. **Free built-in brain** (`freeBrain` in `core.js`): everyday commands, instant, no AI, no cost.
2. **Claude Haiku** for everything else: one JSON plan `{ reply, read, actions }`. Reads run automatically; actions are shown with Confirm / Cancel before anything is saved.

## Secrets (Supabase dashboard, Edge Functions, Secrets)

- `TELEGRAM_BOT_TOKEN`: from @BotFather, a bot just for this OS
- `ANTHROPIC_API_KEY`: the Claude key
- `GEMINI_API_KEY`: for voice notes
- `TELEGRAM_CLAUDE_MODEL` (optional): defaults to `claude-haiku-5-5`

## Rebuild the functions

```
node build.mjs
```
