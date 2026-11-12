-- Personal OS on Cloudflare D1. Everything here belongs to this OS only.

-- Every record of the OS (tasks, goals, plans, businesses, payouts, money, ...) is one row.
CREATE TABLE IF NOT EXISTS os_docs (
  coll       TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',      -- JSON
  updated_at INTEGER NOT NULL,                -- ms since epoch; drives the app's live refresh
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS os_docs_updated ON os_docs (updated_at);

-- Deletions are remembered briefly so other open devices can catch up.
CREATE TABLE IF NOT EXISTS os_deleted (
  coll       TEXT NOT NULL,
  id         TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS os_deleted_at ON os_deleted (deleted_at);

-- The single owner. Only one row can ever exist (id = 1), so nobody else can sign up.
CREATE TABLE IF NOT EXISTS owner (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  email      TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Sign-in sessions (only a hash of the token is stored).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  agent      TEXT
);

-- Server settings: bot username, failed-login counters.
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Telegram
CREATE TABLE IF NOT EXISTS telegram_links (
  chat_id    INTEGER PRIMARY KEY,
  username   TEXT,
  first_name TEXT,
  linked_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_pairing (
  code       TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_state (
  chat_id    INTEGER PRIMARY KEY,
  convo      TEXT NOT NULL DEFAULT '[]',     -- last 12 messages (JSON)
  pending    TEXT,                           -- plan waiting for Confirm / Cancel (JSON)
  updated_at INTEGER NOT NULL
);

-- Every Claude call, with its cost.
CREATE TABLE IF NOT EXISTS ai_spend (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  source        TEXT NOT NULL,               -- 'telegram' or 'app'
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  usd           REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_spend_at ON ai_spend (at);
