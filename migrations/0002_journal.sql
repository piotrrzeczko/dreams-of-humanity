-- Shared test journal (also created on demand by the worker).
CREATE TABLE IF NOT EXISTS journal_items (journal_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (journal_id, kind, id));
CREATE TABLE IF NOT EXISTS journal_profile (journal_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
