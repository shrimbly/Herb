import { getDb, closeDb } from '../lib/db.js';

function initSchema() {
  const db = getDb();

  db.transaction(() => {
    // Categories table
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        parent_id INTEGER REFERENCES categories(id),
        nw_url TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        product_count INTEGER DEFAULT 0,
        last_scraped TEXT
      )
    `);

    // Products table
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL DEFAULT '',
        nw_product_id TEXT UNIQUE,
        name TEXT NOT NULL,
        brand TEXT,
        generic_name TEXT,
        category TEXT,
        subcategory TEXT,
        price REAL,
        unit_price TEXT,
        unit_size TEXT,
        image_url TEXT,
        in_stock INTEGER NOT NULL DEFAULT 1,
        on_special INTEGER NOT NULL DEFAULT 0,
        special_price REAL,
        last_price REAL,
        last_price_change TEXT,
        last_scraped TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // FTS5 virtual table
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
        name,
        brand,
        generic_name,
        category,
        subcategory,
        content='products',
        content_rowid='id'
      )
    `);

    // FTS sync triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
        INSERT INTO products_fts(rowid, name, brand, generic_name, category, subcategory)
        VALUES (new.id, new.name, new.brand, new.generic_name, new.category, new.subcategory);
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, name, brand, generic_name, category, subcategory)
        VALUES ('delete', old.id, old.name, old.brand, old.generic_name, old.category, old.subcategory);
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, name, brand, generic_name, category, subcategory)
        VALUES ('delete', old.id, old.name, old.brand, old.generic_name, old.category, old.subcategory);
        INSERT INTO products_fts(rowid, name, brand, generic_name, category, subcategory)
        VALUES (new.id, new.name, new.brand, new.generic_name, new.category, new.subcategory);
      END
    `);

    // Vector table for embeddings
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_products USING vec0(
        product_id INTEGER PRIMARY KEY,
        embedding float[1536]
      )
    `);

    // Indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_generic_name ON products(generic_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_depth ON categories(depth)`);
  })();

  console.log('Database schema initialized successfully.');

  // Quick verification
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  console.log('Tables:', tables.map(t => t.name).join(', '));

  const vtables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%virtual%' OR name LIKE '%fts%' OR name LIKE 'vec_%' ORDER BY name"
  ).all();
  console.log('Virtual tables:', vtables.map(t => t.name).join(', '));

  closeDb();
}

initSchema();
