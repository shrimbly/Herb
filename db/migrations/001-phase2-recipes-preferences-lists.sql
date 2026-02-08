-- Phase 2: Recipes, Brand Preferences, Shopping Lists

-- Brand preferences
CREATE TABLE IF NOT EXISTS brand_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_name TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  preferred_product_id INTEGER REFERENCES products(id),
  confidence REAL NOT NULL DEFAULT 0.9,
  source TEXT NOT NULL DEFAULT 'explicit',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(generic_name, context)
);

CREATE INDEX IF NOT EXISTS idx_brand_pref_generic ON brand_preferences(generic_name);
CREATE INDEX IF NOT EXISTS idx_brand_pref_product ON brand_preferences(preferred_product_id);

-- Recipes
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT,
  source_url TEXT,
  source_author TEXT,
  instructions TEXT,
  servings INTEGER,
  prep_time INTEGER,
  cook_time INTEGER,
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  tags TEXT DEFAULT '[]',
  notes TEXT,
  added_by TEXT,
  last_cooked TEXT,
  times_cooked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recipe ingredients
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  generic_name TEXT NOT NULL,
  quantity TEXT,
  preparation TEXT,
  optional INTEGER NOT NULL DEFAULT 0,
  substitute TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipe_ing_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ing_generic ON recipe_ingredients(generic_name);

-- Recipes FTS
CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
  name,
  tags,
  notes,
  source_author,
  content='recipes',
  content_rowid='id'
);

-- FTS sync triggers for recipes
CREATE TRIGGER IF NOT EXISTS recipes_ai AFTER INSERT ON recipes BEGIN
  INSERT INTO recipes_fts(rowid, name, tags, notes, source_author)
  VALUES (new.id, new.name, new.tags, new.notes, new.source_author);
END;

CREATE TRIGGER IF NOT EXISTS recipes_ad AFTER DELETE ON recipes BEGIN
  INSERT INTO recipes_fts(recipes_fts, rowid, name, tags, notes, source_author)
  VALUES ('delete', old.id, old.name, old.tags, old.notes, old.source_author);
END;

CREATE TRIGGER IF NOT EXISTS recipes_au AFTER UPDATE ON recipes BEGIN
  INSERT INTO recipes_fts(recipes_fts, rowid, name, tags, notes, source_author)
  VALUES ('delete', old.id, old.name, old.tags, old.notes, old.source_author);
  INSERT INTO recipes_fts(rowid, name, tags, notes, source_author)
  VALUES (new.id, new.name, new.tags, new.notes, new.source_author);
END;

-- Shopping lists
CREATE TABLE IF NOT EXISTS shopping_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  requested_by TEXT,
  recipe_ids TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Shopping list items
CREATE TABLE IF NOT EXISTS shopping_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  generic_name TEXT NOT NULL,
  resolved_product_id INTEGER REFERENCES products(id),
  display_name TEXT,
  quantity TEXT,
  category TEXT,
  source TEXT,
  estimated_price REAL,
  checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_list_items_list ON shopping_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_product ON shopping_list_items(resolved_product_id);
CREATE INDEX IF NOT EXISTS idx_list_items_generic ON shopping_list_items(generic_name);
