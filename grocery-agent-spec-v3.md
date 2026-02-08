# Grocery Agent — OpenClaw Skill Spec (v3)

**Project:** Personal grocery & meal management agent for Willie & wife
**Platform:** OpenClaw skill, accessed via WhatsApp
**Grocery Store:** New World (NZ), online ordering via newworld.co.nz
**Database:** SQLite + sqlite-vss (vector search extension)
**Store:** Single store — Willie's local New World (store-specific pricing & availability)

---

## Table of Contents

1. [Overview](#overview)
2. [Project Plan](#project-plan)
3. [Infrastructure & Configuration](#infrastructure--configuration)
4. [Core Features](#core-features)
5. [Database Architecture](#database-architecture)
6. [Product Catalog Scraper](#product-catalog-scraper)
7. [Ingredient Resolution Pipeline](#ingredient-resolution-pipeline)
8. [Skill File Structure](#skill-file-structure)
9. [WhatsApp Interaction Examples](#whatsapp-interaction-examples)
10. [Open Questions](#open-questions)

---

## Overview

A WhatsApp-based grocery assistant that knows your family's preferred brands, manages a recipe library (primarily sourced from Instagram), and generates smart shopping lists that auto-resolve generic ingredients to specific New World products from your local store's catalog.

Both Willie and his wife can message the agent. The agent maintains a shared family data store backed by SQLite with vector search for intelligent product matching.

---

## Project Plan

The project has five workstreams that build on each other. The order matters — the catalog is the foundation everything else relies on.

### Workstream 1: Infrastructure Setup
*Get OpenClaw ready and the skill scaffold in place*

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1.1 OpenClaw operational | Ensure OpenClaw gateway is running in WSL2, WhatsApp channel paired and stable | Existing OpenClaw setup |
| 1.2 WhatsApp multi-user | Pair Willie's wife via OpenClaw pairing, confirm both users can message the agent | 1.1 |
| 1.3 Skill scaffold | Create `grocery-agent/` skill folder with SKILL.md, init SQLite database | 1.1 |
| 1.4 SQLite + sqlite-vss | Install sqlite-vss extension, verify vector search works in the skill environment | 1.3 |
| 1.5 Embedding model setup | Choose and configure embedding model for product vectors (local or API) | 1.4 |
| 1.6 Tailscale remote access | Ensure agent is reachable via WhatsApp from anywhere (from prior OpenClaw setup) | 1.1 |

### Workstream 2: Product Catalog
*Scrape your local New World store's full product catalog into the database*

| Task | Description | Dependencies |
|------|-------------|--------------|
| 2.1 Store selection | Identify your local New World store and its online store URL/ID | — |
| 2.2 Category tree extraction | Scrape the full category hierarchy (top-level → subcategory → sub-subcategory) | 2.1 |
| 2.3 Product scraper | Build Playwright/Puppeteer scraper to walk categories and extract all products | 2.2 |
| 2.4 Data normalisation | Clean product names, extract brand/unit/size, deduplicate | 2.3 |
| 2.5 Vector embedding | Generate embeddings for all products, store in sqlite-vss | 2.4, 1.5 |
| 2.6 Cron re-scrape | Set up OpenClaw cron job to re-scrape weekly (prices change, new products appear) | 2.3 |
| 2.7 Scraper validation | Verify coverage — spot-check categories, ensure no missing sections | 2.3 |

### Workstream 3: Recipe Management
*Add, search, and manage the family recipe library*

| Task | Description | Dependencies |
|------|-------------|--------------|
| 3.1 Manual recipe entry | Add recipes via WhatsApp (name, ingredients, steps, tags) | 1.3 |
| 3.2 Instagram URL extraction | Send an Instagram Reel/post URL → agent extracts recipe from caption/page | 1.3 |
| 3.3 Screenshot/image recipes | Send a photo of a recipe → OCR + AI parsing into structured format | 1.3 |
| 3.4 Recipe search | Search by name, ingredient, tag, or freetext via FTS5 | 3.1 |
| 3.5 Recipe editing | Update ingredients, notes, ratings, tags on existing recipes | 3.1 |
| 3.6 Ingredient linking | Link recipe ingredients to the product catalog via the resolution pipeline | 3.1, 2.5 |

### Workstream 4: Preferences & Purchase History
*Learn and track the family's brand preferences*

| Task | Description | Dependencies |
|------|-------------|--------------|
| 4.1 Explicit preferences | "We buy Vogel's bread" → saved to brand_preferences table | 1.3 |
| 4.2 Context-aware preferences | "Unsalted for cooking, salted for toast" → multiple preference entries per generic item | 4.1 |
| 4.3 Purchase history import | Paste order text from New World → agent parses items, quantities, prices | 1.3 |
| 4.4 Product matching from history | Fuzzy-match + vector-match imported items against product catalog | 4.3, 2.5 |
| 4.5 Auto-detect preferences | After N purchases, auto-suggest brand preferences based on frequency | 4.4 |
| 4.6 Purchase frequency tracking | Calculate avg days between purchases per product for restock suggestions | 4.4 |

### Workstream 5: Smart Shopping Lists
*Generate, refine, and use intelligent shopping lists*

| Task | Description | Dependencies |
|------|-------------|--------------|
| 5.1 List from recipes | "Make a list for curry and tacos" → aggregate ingredients from recipe library | 3.1, 1.3 |
| 5.2 Ingredient resolution | Resolve generic ingredients → preferred products → NW catalog items | 5.1, 2.5, 4.1 |
| 5.3 Quantity aggregation | Combine duplicate ingredients across multiple recipes | 5.1 |
| 5.4 Staple restock suggestions | "Milk last bought 5 days ago, avg interval 5 days" → suggest adding to list | 4.6 |
| 5.5 Category grouping | Group list by store aisle (Produce, Meat, Dairy, Pantry, Frozen, Household) | 5.2 |
| 5.6 WhatsApp formatting | Clean, emoji-grouped output optimised for WhatsApp readability | 5.5 |
| 5.7 Manual item additions | "Also add dishwashing liquid" → resolves to preferred brand + adds to list | 5.2 |
| 5.8 List adjustments | "Swap the salmon for chicken" / "Remove the avocados" → update live list | 5.1 |

### Future Workstreams (post-v1)

| Workstream | Features |
|------------|----------|
| 6. Meal Planning | Weekly dinner planning, rotation to avoid repeats, seasonal suggestions |
| 7. Budget & Insights | Spending tracking, price trend alerts, budget-friendly alternatives |
| 8. New World Cart Integration | Browser automation to add shopping list items directly to NW online cart |

### Build Order (Recommended)

```
Phase 1 — Foundation (Week 1-2)
├── 1.1-1.6  Infrastructure setup
├── 2.1-2.7  Product catalog scraper
└── Milestone: Full local NW catalog in SQLite with vector search

Phase 2 — Core Features (Week 2-3)
├── 3.1-3.4  Recipe management (manual + Instagram)
├── 4.1-4.2  Explicit brand preferences
├── 5.1-5.6  Shopping list generation
└── Milestone: Can add recipes, set preferences, generate smart lists

Phase 3 — Learning (Week 3-4)
├── 3.5-3.6  Recipe editing + ingredient linking
├── 4.3-4.6  Purchase history + auto-preferences
├── 5.7-5.8  List adjustments
├── 3.3      Screenshot recipe import
└── Milestone: Agent learns from purchase history, handles edge cases
```

---

## Infrastructure & Configuration

### OpenClaw Requirements

| Component | Details |
|-----------|---------|
| **OpenClaw Gateway** | Running in WSL2 on home machine, systemd service |
| **WhatsApp Channel** | Paired, both Willie and wife approved via pairing codes |
| **Tailscale** | Gateway exposed via `tailscale serve` for remote access |
| **AI Model** | Anthropic Claude via API (handles natural language parsing, recipe extraction, list generation) |
| **Browser Skill** | Playwright/Puppeteer available for catalog scraping and Instagram extraction |
| **Cron** | OpenClaw cron for weekly catalog re-scrape |
| **Node.js** | Required for skill scripts (sqlite3, sqlite-vss bindings) |

### System Dependencies

```bash
# In WSL2
npm install better-sqlite3          # SQLite driver
npm install better-sqlite3-vss      # Vector search extension (or sqlite-vss native)
npm install playwright              # Browser automation for scraping
npm install sharp                   # Image processing (screenshot OCR prep)
```

### Embedding Model Options

For generating product embeddings (one-time during scrape + incremental on new products):

| Option | Pros | Cons |
|--------|------|------|
| **Anthropic Voyager** (API) | High quality, already have API key | Cost per embedding call, requires network |
| **OpenAI text-embedding-3-small** (API) | Cheap ($0.02/1M tokens), good quality | Separate API key needed |
| **all-MiniLM-L6-v2** (local via ONNX) | Free, fast, no network needed | Lower quality, ~50MB model download |
| **nomic-embed-text** (local via Ollama) | Free, good quality, runs on Ollama | Heavier, needs Ollama running |

**Recommendation:** Start with an API embedding model (Anthropic or OpenAI) for simplicity. ~10,000 products × ~20 tokens each = ~200K tokens total — costs pennies. Switch to local later if you want zero API dependency.

---

## Core Features

### 1. Recipe Library

Store meals the family likes, each with:
- **Name** — e.g. "Thai Green Curry"
- **Source** — Instagram URL, manual entry, screenshot, forwarded message
- **Ingredients** — list with quantities, linked to product catalog via resolution pipeline
- **Instructions** — cooking steps (extracted or manual)
- **Tags** — e.g. "weeknight", "date night", "kid-friendly", "quick"
- **Rating** — 1-5
- **Last cooked** — auto-tracked when added to a shopping list
- **Notes** — freeform, e.g. "double the garlic"

**Adding recipes:**
- Send an Instagram Reel/post URL → agent extracts recipe from caption/page HTML
- Send a photo/screenshot of a recipe → OCR + AI parsing
- Type it out manually → agent structures it
- Forward a message from another chat → agent parses it

### 2. Product Catalog & Brand Preferences

A complete database of every product available at your local New World store, scraped and kept current. Plus a preference layer that maps generic ingredients to your specific preferred products.

The preference system supports context:
- "butter" (default) → Lewis Road Unsalted
- "butter" (toast) → Lewis Road Salted
- "butter" (baking) → Mainland Unsalted 500g (cheaper for bulk use)

Preferences are learned from:
- **Explicit instructions** — "We always buy Vogel's bread"
- **Purchase history** — most frequently bought variant auto-detected
- **Shopping list corrections** — "No, swap that for the Anchor one"

### 3. Purchase History Integration

Import via copy-paste from New World My Orders page. Agent parses the raw text, matches items to the product catalog using vector search + fuzzy matching, and builds up preference and frequency data over time.

### 4. Smart Shopping Lists

Takes recipes + manual items → resolves all ingredients to specific NW products → groups by aisle → formats for WhatsApp. Suggests staple restocks based on purchase frequency.

---

## Database Architecture

### Why SQLite + sqlite-vss

- **SQLite:** Single file, zero infrastructure, FTS5 for recipe search, relational queries for preferences and history
- **sqlite-vss:** Vector search extension that adds a virtual table for cosine similarity search — stays in the same DB file, no separate server
- Together they give us: exact match (SQL), fuzzy text match (FTS5), and semantic match (vector search) all in one file

### Schema

```sql
-- ============================================================
-- PRODUCT CATALOG (scraped from New World)
-- ============================================================

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Identity
    name TEXT NOT NULL,                  -- Full product name: "Vogels Original Mixed Grain Toast Bread 720g"
    brand TEXT,                          -- Extracted brand: "Vogels"
    generic_name TEXT,                   -- Normalised generic: "bread", "milk", "chicken thighs"
    
    -- New World specific
    nw_product_id TEXT UNIQUE,           -- New World's internal product ID
    nw_url TEXT,                         -- Product page URL
    store_id TEXT NOT NULL,              -- Which NW store this was scraped from
    
    -- Classification
    category TEXT,                       -- Top-level: "Bakery", "Fridge, Deli & Eggs"
    subcategory TEXT,                    -- Mid-level: "Toast Bread", "Fresh Milk"
    sub_subcategory TEXT,                -- Fine-grained: "Grain & Seed Bread"
    
    -- Details
    price REAL,                          -- Current price
    unit_size TEXT,                      -- "720g", "2L", "500g"
    unit_price TEXT,                     -- Price per unit: "$0.83/100g"
    description TEXT,                    -- Full product description if available
    image_url TEXT,                      -- Product image URL
    in_stock BOOLEAN DEFAULT TRUE,
    on_special BOOLEAN DEFAULT FALSE,
    special_price REAL,                  -- Sale price if on special
    
    -- Metadata
    first_seen DATE DEFAULT CURRENT_DATE,
    last_seen DATE DEFAULT CURRENT_DATE, -- Updated on each re-scrape
    last_price_change DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search on product names
CREATE VIRTUAL TABLE products_fts USING fts5(
    name, brand, generic_name, category, subcategory,
    content=products,
    content_rowid=id
);

-- Vector search for semantic matching
-- sqlite-vss virtual table (embeddings stored here)
CREATE VIRTUAL TABLE products_vss USING vss0(
    embedding(384)    -- Dimension depends on embedding model (384 for MiniLM, 1536 for OpenAI)
);

-- ============================================================
-- BRAND PREFERENCES
-- ============================================================

CREATE TABLE brand_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generic_name TEXT NOT NULL,          -- "bread", "butter", "salmon"
    context TEXT DEFAULT 'default',      -- "default", "cooking", "toast", "baking"
    preferred_product_id INTEGER REFERENCES products(id),
    confidence REAL DEFAULT 0.5,         -- 0-1, increases with purchases/confirmations
    source TEXT NOT NULL,                -- "explicit", "purchase_history", "correction"
    notes TEXT,                          -- "Willie switched from Mainland Jan 2026"
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(generic_name, context)
);

-- ============================================================
-- RECIPES
-- ============================================================

CREATE TABLE recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_type TEXT,                    -- "instagram", "manual", "screenshot", "forwarded"
    source_url TEXT,
    source_author TEXT,                  -- "@cookingwithsomeone"
    instructions TEXT,                   -- JSON array of steps
    servings INTEGER,
    prep_time_mins INTEGER,
    cook_time_mins INTEGER,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    tags TEXT,                           -- JSON array: ["weeknight", "quick", "date night"]
    notes TEXT,
    added_by TEXT,                       -- "Willie" or wife's name
    last_cooked DATE,
    times_cooked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    generic_name TEXT NOT NULL,          -- "chicken thighs" — used for product resolution
    quantity TEXT,                       -- "500g", "3 tbsp", "2 cloves"
    preparation TEXT,                    -- "diced", "minced", "sliced"
    optional BOOLEAN DEFAULT FALSE,
    substitute TEXT,                     -- "or use tofu"
    sort_order INTEGER DEFAULT 0
);

-- Full-text search for recipes
CREATE VIRTUAL TABLE recipes_fts USING fts5(
    name, tags, notes, source_author,
    content=recipes,
    content_rowid=id
);

-- ============================================================
-- PURCHASE HISTORY
-- ============================================================

CREATE TABLE purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_date DATE NOT NULL,
    order_reference TEXT,
    import_method TEXT,                  -- "copy_paste", "screenshot", "browser"
    item_count INTEGER,
    total_amount REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),   -- linked after matching
    raw_name TEXT NOT NULL,              -- Exactly as it appeared in the order
    quantity INTEGER DEFAULT 1,
    unit_price REAL,
    total_price REAL,
    match_confidence REAL               -- How confident the product match was
);

-- ============================================================
-- SHOPPING LISTS
-- ============================================================

CREATE TABLE shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    status TEXT DEFAULT 'draft',         -- "draft", "active", "completed"
    requested_by TEXT,
    recipe_ids TEXT,                     -- JSON array of recipe IDs used
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    generic_name TEXT NOT NULL,
    resolved_product_id INTEGER REFERENCES products(id),
    display_name TEXT NOT NULL,          -- "Vogel's Mixed Grain Bread 720g"
    quantity TEXT,
    category TEXT,                       -- For aisle grouping
    source TEXT,                         -- "recipe:Thai Green Curry", "staple", "manual"
    estimated_price REAL,
    checked BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- PURCHASE FREQUENCY (materialized view, updated after imports)
-- ============================================================

CREATE TABLE purchase_frequency (
    generic_name TEXT PRIMARY KEY,
    avg_days_between REAL,
    last_purchased DATE,
    purchase_count INTEGER,
    typical_quantity INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- CATEGORY TREE (scraped from New World, used for aisle grouping)
-- ============================================================

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id),
    nw_url TEXT,                         -- Category page URL for scraping
    depth INTEGER DEFAULT 0,            -- 0=top, 1=mid, 2=fine
    product_count INTEGER DEFAULT 0,
    last_scraped DATETIME
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_products_generic ON products(generic_name);
CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_nw_id ON products(nw_product_id);
CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_preferences_generic ON brand_preferences(generic_name);
CREATE INDEX idx_recipe_ingredients_generic ON recipe_ingredients(generic_name);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);
CREATE INDEX idx_purchase_items_raw ON purchase_items(raw_name);
CREATE INDEX idx_shopping_list_items_list ON shopping_list_items(list_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);
```

---

## Product Catalog Scraper

### Overview

The scraper walks your local New World store's online catalog, extracts every product, and stores it in SQLite with vector embeddings for semantic search.

### How New World's Site Works

- Products and prices are **store-specific** — you must select a store first
- The site uses a category hierarchy: Top Category → Subcategory → Sub-subcategory
- Product listings are paginated within each category
- The site is JavaScript-rendered — requires a real browser (Playwright), not just HTTP requests
- Each product has: name, brand (sometimes embedded in name), price, unit size, unit price, image, availability

### Scraper Architecture

```
1. Set store cookie/selection
   └── Navigate to store-specific URL or set store via site UI

2. Extract category tree
   └── Walk the navigation menu / category listing pages
   └── Store in `categories` table with parent-child relationships
   └── Output: ~100-200 categories across 3 levels

3. For each leaf category:
   ├── Load category page
   ├── Paginate through all products (20-24 per page typical)
   ├── Extract per product:
   │   ├── Product name (full)
   │   ├── Brand (parse from name or separate field)
   │   ├── Price + unit price
   │   ├── Unit size (720g, 2L, etc.)
   │   ├── Product ID / URL
   │   ├── Image URL
   │   ├── In stock / on special flags
   │   └── Category path (from parent traversal)
   └── Rate limit: polite delays between requests (2-5s)

4. Post-processing
   ├── Normalise brand names (inconsistent casing, abbreviations)
   ├── Extract generic_name from product name ("Vogels Original Mixed Grain Toast Bread 720g" → "bread")
   ├── Deduplicate (same product appearing in multiple categories)
   └── Generate vector embeddings for all products

5. Store in SQLite
   ├── products table (structured data)
   ├── products_fts (full-text index)
   └── products_vss (vector embeddings)
```

### Generic Name Extraction

This is a key step — we need to map "Anchor Blue Milk 2L" → generic_name: "milk". Approaches:

1. **Category-based** — the subcategory often tells us (e.g. "Fresh Milk" → "milk")
2. **AI extraction** — batch process product names through Claude to extract generic ingredient names
3. **Rule-based** — strip brand, strip unit size, what's left is roughly the generic name
4. **Hybrid** — use category as primary signal, AI for ambiguous cases

### Re-scrape Strategy

- **Weekly full re-scrape** — catches new products, discontinued products, price changes
- **Track price changes** — update `last_price_change` for price trend awareness
- **Mark disappeared products** — set `in_stock = FALSE` rather than deleting (preserves preference links)
- **Incremental embeddings** — only embed new/changed products, skip unchanged ones
- **OpenClaw cron** — `openclaw cron add --schedule "0 3 * * MON" --skill grocery-agent --task rescrape`

### Expected Scale

| Metric | Estimate |
|--------|----------|
| Total products per store | 8,000 - 15,000 |
| Categories (all levels) | 100 - 200 |
| Pages to scrape | 400 - 700 |
| Scrape duration | 30 - 60 mins (with polite delays) |
| SQLite DB size (with vectors) | ~50 - 100 MB |
| Embedding time (API) | 2 - 5 mins |
| Embedding cost (API, one-time) | < $0.10 |

---

## Ingredient Resolution Pipeline

This is the core intelligence — turning "chicken thighs" from a recipe into "Tegel Free Range Chicken Thighs 500g" from the catalog.

### Resolution Order

```
Input: generic ingredient name (e.g. "coconut milk")
  │
  ├─ Step 1: EXACT PREFERENCE MATCH
  │   Query brand_preferences WHERE generic_name = 'coconut milk'
  │   AND context matches (recipe context or 'default')
  │   → If found with high confidence: USE THIS PRODUCT ✓
  │
  ├─ Step 2: FTS5 TEXT SEARCH
  │   Query products_fts MATCH 'coconut milk'
  │   → Returns ranked text matches from product catalog
  │   → Filter by category if context helps (e.g. "Pantry" not "Health & Body")
  │
  ├─ Step 3: VECTOR SIMILARITY SEARCH
  │   Embed "coconut milk" → query products_vss for nearest neighbors
  │   → Returns semantically similar products even if words don't match
  │   → Handles synonyms, regional terms, partial descriptions
  │
  ├─ Step 4: MERGE & RANK
  │   Combine results from steps 2 + 3
  │   Score by: text relevance + vector similarity + purchase history + price
  │   → Top result used if confidence > threshold
  │   → If ambiguous, present top 3 to user for selection
  │
  └─ Step 5: LEARN
      If user selects/confirms a product:
      → Create/update brand_preferences entry
      → Increase confidence for future auto-resolution
```

### Context-Aware Resolution

The agent considers recipe context when resolving:
- "cream" in a pasta recipe → fresh cream, not ice cream
- "oil" in a stir-fry → cooking oil, not olive oil (unless preference says otherwise)
- "stock" in a soup → liquid stock or stock cubes (check preference)

This context is passed to the vector search as part of the query embedding, improving relevance.

---

## Skill File Structure

```
~/.openclaw/skills/grocery-agent/
├── SKILL.md                      # Skill definition + agent instructions
├── data/
│   ├── grocery.db                # SQLite database (all data + vectors)
│   └── grocery.db.bak            # Auto-backup before migrations
├── scripts/
│   ├── init-db.js                # Create tables, indexes, FTS, VSS
│   ├── scrape-catalog.js         # Full catalog scraper (Playwright)
│   ├── scrape-categories.js      # Category tree extraction
│   ├── embed-products.js         # Generate + store product embeddings
│   ├── parse-recipe.js           # Extract recipe from Instagram URL / image
│   ├── parse-history.js          # Parse copy-pasted order history text
│   ├── resolve-ingredients.js    # Ingredient → product resolution pipeline
│   ├── build-list.js             # Generate smart shopping list
│   ├── format-whatsapp.js        # WhatsApp message formatting utilities
│   └── migrate.js                # Schema migrations
├── references/
│   ├── nw-categories.json        # Cached category tree (for reference)
│   └── generic-names.json        # Manual mappings for tricky generic names
└── backups/                      # Periodic DB snapshots
```

---

## WhatsApp Interaction Examples

### Adding a recipe
```
Willie: [sends Instagram Reel URL]
Agent:  Got it! Looks like a Honey Garlic Salmon recipe from @foodieflava.
        
        Ingredients I found:
        - 4 salmon fillets
        - 3 tbsp honey
        - 2 tbsp soy sauce
        - 4 cloves garlic
        - 1 tbsp sesame oil
        - Rice for serving

        Want me to save this? Any tags? (weeknight, date night, etc.)

Willie: Save it, tag weeknight. We'd use Sealord salmon.
Agent:  Saved! I found these Sealord salmon options at New World:
        1. Sealord Salmon Fillets Skin On 300g — $12.99
        2. Sealord Salmon Portions Boneless 360g — $15.49
        3. Sealord Hoki Fillets 480g — (not salmon)
        
        Which one for this recipe?
Willie: The 300g one
Agent:  Done. Sealord Salmon Fillets Skin On 300g saved as your preferred salmon.
```

### Building a shopping list
```
Wife:   Can you make a list for this week? We want to do the honey salmon,
        thai curry, and tacos
Agent:  Here's your shopping list for 3 meals:

        🥬 PRODUCE
        - Garlic (1 bulb) — need for salmon + curry
        - Thai basil — $3.49
        - Limes x3 — $0.90 ea
        - Avocados x2 — $2.50 ea
        - Tomatoes x3
        - Superb Herb Cos Lettuce — $3.99
        - Fresh coriander — $2.99

        🥩 MEAT & SEAFOOD
        - Sealord Salmon Fillets Skin On 300g x2 — $12.99 ea
        - Tegel Free Range Chicken Thighs 500g — $9.99
        - Premium NZ Beef Mince 500g — $8.99

        🧊 FRIDGE
        - Kara UHT Coconut Cream 400ml x2 — $2.49 ea
        - Meadow Fresh Sour Cream 250g — $3.29

        🏪 PANTRY
        - Old El Paso Taco Kit — $6.99
        - Kikkoman Soy Sauce (check if you're low)
        - Sesame oil

        ☕ STAPLES (due for restock)
        - Anchor Blue Top Milk 2L — $3.89 (last bought 5 days ago)
        - Vogel's Mixed Grain Bread 720g — $5.49 (last bought 6 days ago)

        Estimated total: ~$95

        Want me to adjust anything?
```

### Teaching preferences
```
Willie: We don't buy that butter anymore, switch to Lewis Road
Agent:  Updated! I'll use Lewis Road Creamery butter from now on.
        I can see a few options at your New World:
        1. Lewis Road Creamery Butter Unsalted 250g — $5.99
        2. Lewis Road Creamery Butter Salted 250g — $5.99
        3. Lewis Road Creamery Butter Garlic & Herb 250g — $6.49
        
        Which ones do you use?
Willie: Unsalted for cooking, salted for toast
Agent:  Saved:
        ✓ Cooking → Lewis Road Unsalted 250g
        ✓ Table/toast → Lewis Road Salted 250g
```

### Importing purchase history
```
Willie: [pastes text from New World order page]
Agent:  Parsed your order from Feb 1st — 23 items, $187.40 total.

        Matched 21 of 23 items to catalog. 2 need confirmation:
        - "Free Range Eggs 12pk" — is this Farmer Brown or Woodland?
        - "Sourdough Loaf" — is this the Bakers Maison one?

        New preferences detected (repeat purchases):
        🔄 Peanut butter → Pic's Smooth 380g (3 of last 4 orders)
        🔄 Dish liquid → Ecostore Lemon 500ml (2 of last 3 orders)

        Confirm these?
```

### Searching recipes
```
Wife:   What quick dinners do we have saved?
Agent:  Recipes tagged "quick" or "weeknight":

        1. 🐟 Honey Garlic Salmon (⭐5) — last cooked Jan 28
        2. 🍛 Thai Green Curry (⭐4) — last cooked Jan 15
        3. 🌮 Beef Tacos (⭐5) — last cooked Feb 1
        4. 🍝 Garlic Butter Pasta (⭐4) — last cooked Dec 20
        5. 🍚 Teriyaki Chicken Bowl (⭐3) — never cooked yet!

        Want a shopping list for any of these?
```

---

## Open Questions

1. **Which New World store?** — Need the specific store name/location to configure the scraper. Prices and availability differ per store.

2. **Embedding model preference?** — API (simple, cheap) vs local (free, private). Recommend starting with API.

3. **Wife's name** — For `added_by` / `requested_by` tracking. Or just use "Willie" and "Wife" / phone number.

4. **Recipe categories** — Beyond tags, do you want explicit meal type fields (breakfast, lunch, dinner, snack)?

5. **Voice notes** — Do you and your wife use WhatsApp voice notes for grocery requests? OpenClaw handles transcription, just want to make sure parsing handles natural speech patterns.

6. **Dietary requirements** — Any allergies or dietary preferences to flag/filter automatically?

7. **Budget sensitivity** — Should the agent ever suggest cheaper alternatives? ("Lewis Road butter is $5.99, Mainland is $3.49 — want to swap?")

8. **Backup strategy** — Auto-backup the DB before each re-scrape? OpenClaw cron for nightly backups?
