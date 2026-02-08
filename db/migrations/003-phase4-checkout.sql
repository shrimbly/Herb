-- Phase 4: Checkout audit log

CREATE TABLE IF NOT EXISTS checkout_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  source TEXT,
  item_count INTEGER NOT NULL,
  confirmed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'created',
  total_amount REAL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
