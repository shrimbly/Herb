-- Phase 3: Purchase History & Frequency Tracking

-- Purchases (order-level)
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date TEXT,
  order_reference TEXT,
  import_method TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_amount REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchase items (line items within an order)
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  raw_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL,
  total_price REAL,
  match_confidence REAL
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_raw ON purchase_items(raw_name);

-- Purchase frequency (aggregated stats per generic ingredient)
CREATE TABLE IF NOT EXISTS purchase_frequency (
  generic_name TEXT PRIMARY KEY,
  avg_days_between REAL,
  last_purchased TEXT,
  purchase_count INTEGER NOT NULL DEFAULT 0,
  typical_quantity REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
