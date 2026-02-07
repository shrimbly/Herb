# Grocery Agent — Product Requirements Document

## Product Summary

A Node.js application that manages a family's grocery shopping through an OpenClaw skill interface. It maintains a recipe library, learns brand preferences, scrapes and indexes a local New World (NZ) store's full product catalog, and generates smart shopping lists that resolve generic ingredients to specific preferred products.

The application is the backend brain — it provides tools, scripts, and a SQLite database that an OpenClaw agent uses to respond to WhatsApp messages from two users (Willie and his wife).

---

## System Architecture

```
WhatsApp (Willie / Wife)
    ↓
OpenClaw Gateway + Agent (handles NLP, conversation, routing)
    ↓
Grocery Agent Skill
    ├── SKILL.md (agent instructions + tool definitions)
    ├── SQLite + sqlite-vss (all data + vector search)
    └── Scripts (scraper, parsers, resolvers, list builder)
```

The application does NOT handle:
- WhatsApp messaging (OpenClaw does this)
- Natural language understanding (the LLM agent does this)
- Conversation state (OpenClaw sessions handle this)

The application DOES handle:
- All data persistence (SQLite)
- Product catalog scraping and indexing
- Vector embedding generation and semantic search
- Recipe parsing and storage
- Ingredient-to-product resolution
- Shopping list generation and formatting
- Purchase history parsing and preference learning

---

## Data Model

### SQLite Database: `grocery.db`

All tables live in a single SQLite file with two extensions:
- **FTS5** — full-text search on recipes and products
- **sqlite-vss** — vector similarity search on product embeddings

#### products

The complete product catalog from a single New World store.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT NOT NULL | Full product name: "Vogels Original Mixed Grain Toast Bread 720g" |
| brand | TEXT | Extracted brand: "Vogels" |
| generic_name | TEXT | Normalised generic ingredient: "bread" |
| nw_product_id | TEXT UNIQUE | New World internal product ID |
| nw_url | TEXT | Product page URL |
| store_id | TEXT NOT NULL | Store identifier |
| category | TEXT | Top-level NW category |
| subcategory | TEXT | Mid-level category |
| sub_subcategory | TEXT | Fine-grained category |
| price | REAL | Current price |
| unit_size | TEXT | "720g", "2L" |
| unit_price | TEXT | "$0.83/100g" |
| description | TEXT | Product description |
| image_url | TEXT | Product image |
| in_stock | BOOLEAN | Default TRUE |
| on_special | BOOLEAN | Default FALSE |
| special_price | REAL | Sale price if on special |
| first_seen | DATE | When first scraped |
| last_seen | DATE | Updated each re-scrape |
| last_price_change | DATE | |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### products_fts (FTS5 virtual table)

Full-text index over: name, brand, generic_name, category, subcategory.

#### products_vss (sqlite-vss virtual table)

Vector embeddings for semantic search. Dimension depends on embedding model (384 for MiniLM, 1536 for OpenAI, etc).

#### categories

The New World store's category hierarchy, used to drive the scraper and group shopping list items.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| name | TEXT NOT NULL | Category name |
| parent_id | INTEGER FK → categories | Null for top-level |
| nw_url | TEXT | Category page URL |
| depth | INTEGER | 0=top, 1=mid, 2=leaf |
| product_count | INTEGER | Products in this category |
| last_scraped | DATETIME | |

#### brand_preferences

Maps generic ingredients to preferred products, with optional context.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| generic_name | TEXT NOT NULL | "bread", "butter" |
| context | TEXT | "default", "cooking", "toast", "baking" |
| preferred_product_id | INTEGER FK → products | |
| confidence | REAL | 0-1, grows with use |
| source | TEXT | "explicit", "purchase_history", "correction" |
| notes | TEXT | |
| created_at | DATETIME | |
| updated_at | DATETIME | |

Unique constraint on (generic_name, context).

#### recipes

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| name | TEXT NOT NULL | "Thai Green Curry" |
| source_type | TEXT | "instagram", "manual", "screenshot", "forwarded" |
| source_url | TEXT | |
| source_author | TEXT | "@cookingwithsomeone" |
| instructions | TEXT | JSON array of steps |
| servings | INTEGER | |
| prep_time_mins | INTEGER | |
| cook_time_mins | INTEGER | |
| rating | INTEGER | 1-5 |
| tags | TEXT | JSON array: ["weeknight", "quick"] |
| notes | TEXT | |
| added_by | TEXT | |
| last_cooked | DATE | |
| times_cooked | INTEGER | Default 0 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### recipes_fts (FTS5 virtual table)

Full-text index over: name, tags, notes, source_author.

#### recipe_ingredients

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| recipe_id | INTEGER FK → recipes | CASCADE delete |
| generic_name | TEXT NOT NULL | "chicken thighs" — used for product resolution |
| quantity | TEXT | "500g", "3 tbsp" |
| preparation | TEXT | "diced", "minced" |
| optional | BOOLEAN | Default FALSE |
| substitute | TEXT | "or use tofu" |
| sort_order | INTEGER | |

#### purchases

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| order_date | DATE NOT NULL | |
| order_reference | TEXT | NW order number |
| import_method | TEXT | "copy_paste", "screenshot" |
| item_count | INTEGER | |
| total_amount | REAL | |
| created_at | DATETIME | |

#### purchase_items

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| purchase_id | INTEGER FK → purchases | CASCADE delete |
| product_id | INTEGER FK → products | Linked after matching |
| raw_name | TEXT NOT NULL | Exactly as pasted |
| quantity | INTEGER | Default 1 |
| unit_price | REAL | |
| total_price | REAL | |
| match_confidence | REAL | |

#### shopping_lists

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| name | TEXT | "Week of Feb 10" |
| status | TEXT | "draft", "active", "completed" |
| requested_by | TEXT | |
| recipe_ids | TEXT | JSON array |
| notes | TEXT | |
| created_at | DATETIME | |
| completed_at | DATETIME | |

#### shopping_list_items

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| list_id | INTEGER FK → shopping_lists | CASCADE delete |
| generic_name | TEXT NOT NULL | |
| resolved_product_id | INTEGER FK → products | |
| display_name | TEXT NOT NULL | |
| quantity | TEXT | |
| category | TEXT | For aisle grouping |
| source | TEXT | "recipe:Thai Green Curry", "staple", "manual" |
| estimated_price | REAL | |
| checked | BOOLEAN | Default FALSE |
| sort_order | INTEGER | |

#### purchase_frequency

Materialized/cached table, recalculated after purchase imports.

| Column | Type | Description |
|--------|------|-------------|
| generic_name | TEXT PK | |
| avg_days_between | REAL | |
| last_purchased | DATE | |
| purchase_count | INTEGER | |
| typical_quantity | INTEGER | Default 1 |
| updated_at | DATETIME | |

---

## Modules

### 1. Database (`db/`)

- `init.js` — Create all tables, indexes, FTS virtual tables, VSS virtual table. Idempotent (safe to run repeatedly).
- `migrate.js` — Schema migrations for future changes. Version-tracked.
- `backup.js` — Copy `grocery.db` to timestamped backup file before destructive operations.

### 2. Catalog Scraper (`scraper/`)

Scrapes the full product catalog from a single New World store.

#### `scrape-categories.js`

- Input: Store URL or store ID
- Process: Navigate to the store's online shopping page, extract the full category tree from the navigation menu
- Output: Populated `categories` table with parent-child hierarchy
- Notes: Needs Playwright for JS-rendered content

#### `scrape-products.js`

- Input: Category tree from database
- Process: For each leaf category, paginate through all products and extract structured data
- Output: Populated `products` table
- Extraction per product: name, price, unit_size, unit_price, image_url, product ID, in_stock, on_special, special_price
- Rate limiting: 2-5 second delays between page loads
- Error handling: Retry failed pages, log skipped products, continue on individual failures
- Idempotent: Re-running updates existing products (matched by nw_product_id), inserts new ones, marks missing ones as out of stock

#### `normalise-products.js`

- Input: Raw product data in `products` table
- Process:
  - Extract brand name from product name (heuristic: first word(s) before the product type)
  - Generate `generic_name` — map "Anchor Blue Milk 2L" → "milk"
  - Strategy: Use subcategory as primary signal (e.g. subcategory "Fresh Milk" → generic "milk"), AI batch for ambiguous cases, manual overrides via `references/generic-names.json`
  - Normalise inconsistent casing, abbreviations
  - Deduplicate products appearing in multiple categories
- Output: Updated `products` rows with `brand` and `generic_name` populated

#### `embed-products.js`

- Input: Products in database
- Process: Generate vector embeddings for each product. Embedding text = `"{name} {brand} {category} {subcategory}"`
- Output: Populated `products_vss` virtual table
- Incremental: Only embed products where embedding is missing or product name has changed
- Configurable: Embedding model (API or local) set via environment variable or config

#### `rescrape.js`

- Orchestrates a full re-scrape: backup DB → scrape categories → scrape products → normalise → embed new products
- Tracks `last_seen` dates to detect removed products
- Logs price changes in `last_price_change`

### 3. Recipe Management (`recipes/`)

#### `add-recipe.js`

- Input: Recipe data object (name, ingredients, instructions, tags, source, added_by)
- Process: Insert into `recipes` + `recipe_ingredients`, update FTS index
- Output: Recipe ID
- Validation: Name required, at least one ingredient

#### `parse-instagram.js`

- Input: Instagram URL (Reel or Post)
- Process: Fetch page via Playwright, extract caption text, use AI to parse into structured recipe (ingredients list + instructions)
- Output: Structured recipe object ready for `add-recipe.js`
- Fallback: If extraction fails, return error with message suggesting screenshot upload

#### `parse-screenshot.js`

- Input: Image file path (from WhatsApp media)
- Process: OCR the image (via Tesseract or AI vision), parse text into structured recipe
- Output: Structured recipe object

#### `parse-text.js`

- Input: Raw text (pasted recipe, forwarded message, or transcribed voice note)
- Process: AI parsing into structured recipe format
- Output: Structured recipe object

#### `search-recipes.js`

- Input: Query string
- Process: FTS5 search on recipes_fts, optionally filter by tags
- Output: Array of matching recipes with ingredients

#### `update-recipe.js`

- Input: Recipe ID + fields to update
- Process: Update recipe and/or ingredients, refresh FTS index
- Output: Updated recipe

### 4. Preferences (`preferences/`)

#### `set-preference.js`

- Input: generic_name, product_id, context (default: "default"), source
- Process: Upsert into `brand_preferences`
- Output: Preference record

#### `get-preference.js`

- Input: generic_name, context (optional)
- Process: Look up preference, fall back from specific context → "default"
- Output: Preferred product record or null

#### `learn-from-history.js`

- Input: None (reads from purchase_items)
- Process: For each generic ingredient, count product frequency across all purchases. If one product is bought >60% of the time with 3+ purchases, suggest as preference.
- Output: Array of suggested preferences (not auto-applied — returned for user confirmation)

### 5. Purchase History (`history/`)

#### `parse-order.js`

- Input: Raw text (copy-pasted from New World order page)
- Process: AI parsing to extract individual line items (product name, quantity, price). Creates `purchase` + `purchase_items` records.
- Output: Purchase record with parsed items

#### `match-items.js`

- Input: Purchase ID with unmatched items
- Process: For each `purchase_item`, attempt to match `raw_name` against `products` table using:
  1. Exact name match
  2. FTS5 text search
  3. Vector similarity search
- Output: Updated purchase_items with `product_id` and `match_confidence` populated
- Items below confidence threshold flagged for user confirmation

#### `update-frequency.js`

- Input: None (reads from purchase history)
- Process: Recalculate `purchase_frequency` table — average days between purchases per generic ingredient
- Output: Updated frequency table

### 6. Shopping Lists (`lists/`)

#### `build-list.js`

- Input: Object with optional fields:
  - `recipe_ids: number[]` — recipes to shop for
  - `manual_items: string[]` — additional items ("bread", "dishwashing liquid")
  - `include_staples: boolean` — add items due for restock (default: true)
  - `requested_by: string`
- Process:
  1. Gather all ingredients from specified recipes
  2. Add manual items
  3. Aggregate quantities for duplicate ingredients across recipes
  4. Resolve each ingredient through the resolution pipeline (see below)
  5. Check purchase frequency for staple restock suggestions
  6. Group by store category/aisle
  7. Calculate estimated total price
  8. Create `shopping_list` + `shopping_list_items` records
- Output: Shopping list object with grouped, resolved items

#### `resolve-ingredient.js`

The core resolution pipeline. Called per ingredient.

- Input: generic_name, context hints (recipe name, category)
- Process:
  1. **Exact preference** — query `brand_preferences` for this generic_name + context
  2. **FTS5 search** — query `products_fts` for text matches
  3. **Vector search** — embed the ingredient query, search `products_vss` for nearest neighbors
  4. **Merge & rank** — combine results, score by: preference confidence + text relevance + vector similarity + purchase recency
  5. **Decide** — if top result confidence > 0.8, auto-resolve. Otherwise return top 3 candidates for user selection.
- Output: `{ resolved: boolean, product: Product | null, candidates: Product[], confidence: number }`

#### `format-list.js`

- Input: Shopping list object
- Process: Format for WhatsApp — emoji category headers, product names with prices, recipe attribution, estimated total
- Output: Formatted string

#### `update-list.js`

- Input: List ID + modification (add item, remove item, swap product, check off)
- Process: Update shopping_list_items
- Output: Updated list

### 7. Formatting (`format/`)

#### `whatsapp.js`

Utility functions for WhatsApp message formatting:
- `formatShoppingList(list)` — full grouped list with emoji headers
- `formatRecipeCard(recipe)` — recipe summary for display
- `formatRecipeList(recipes)` — numbered list of recipes
- `formatProductOptions(products)` — numbered product choices for user selection
- `formatOrderSummary(purchase)` — parsed order summary with match status
- `formatPreferenceUpdate(preference)` — confirmation of preference changes

---

## SKILL.md Agent Instructions

The SKILL.md file tells the OpenClaw agent how to use the application. It should include:

### Tool Definitions

Each script maps to a tool the agent can invoke. The SKILL.md should define:

- **add_recipe** — when user sends a recipe URL, screenshot, or typed recipe
- **search_recipes** — when user asks "what recipes do we have" / "find me a chicken recipe"
- **build_shopping_list** — when user asks to make a shopping list for specific meals or items
- **update_shopping_list** — when user wants to modify an existing list
- **set_preference** — when user explicitly states a brand preference
- **import_order** — when user pastes order history text
- **search_products** — when user asks about specific products or prices at their store
- **get_recipe** — when user asks for a specific recipe's details/instructions

### Agent Behaviour Instructions

- Always confirm before saving recipes — show extracted data, ask for tags
- When resolving ingredients with low confidence, show options and ask
- When importing orders, show matched items and flag uncertain matches
- Format all shopping lists with emoji category headers
- Track who sent the message (Willie vs wife) for `added_by` / `requested_by`
- When a user corrects a product choice, save it as a preference for next time
- Be proactive about noticing preference patterns ("You've bought Pic's 3 times now — want me to make it your default peanut butter?")

---

## Configuration

The application needs the following configuration, stored in a `config.json` or environment variables:

```json
{
  "store": {
    "id": "",
    "name": "",
    "url": ""
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "api_key_env": "OPENAI_API_KEY"
  },
  "scraper": {
    "delay_ms": 3000,
    "max_retries": 3,
    "user_agent": "Mozilla/5.0 ..."
  },
  "preferences": {
    "auto_suggest_threshold": 0.6,
    "min_purchases_for_suggestion": 3,
    "resolution_auto_confidence": 0.8
  }
}
```

---

## File Structure

```
grocery-agent/
├── SKILL.md
├── config.json
├── package.json
├── data/
│   └── grocery.db
├── db/
│   ├── init.js
│   ├── migrate.js
│   └── backup.js
├── scraper/
│   ├── scrape-categories.js
│   ├── scrape-products.js
│   ├── normalise-products.js
│   ├── embed-products.js
│   └── rescrape.js
├── recipes/
│   ├── add-recipe.js
│   ├── parse-instagram.js
│   ├── parse-screenshot.js
│   ├── parse-text.js
│   ├── search-recipes.js
│   └── update-recipe.js
├── preferences/
│   ├── set-preference.js
│   ├── get-preference.js
│   └── learn-from-history.js
├── history/
│   ├── parse-order.js
│   ├── match-items.js
│   └── update-frequency.js
├── lists/
│   ├── build-list.js
│   ├── resolve-ingredient.js
│   ├── format-list.js
│   └── update-list.js
├── format/
│   └── whatsapp.js
└── references/
    └── generic-names.json
```

---

## Build Phases

### Phase 1: Foundation
- Database schema + init script
- Product catalog scraper (categories → products → normalisation → embeddings)
- Config setup
- Basic SKILL.md scaffold

**Exit criteria:** Full product catalog in SQLite with working vector search. Can query "find me coconut milk" and get ranked product results.

### Phase 2: Core Features
- Recipe management (manual entry + Instagram extraction)
- Explicit brand preferences
- Ingredient resolution pipeline
- Shopping list generation + WhatsApp formatting

**Exit criteria:** Can add a recipe, set brand preferences, and generate a resolved shopping list from recipes.

### Phase 3: Learning
- Purchase history import + parsing
- Auto product matching from history
- Preference learning from purchase patterns
- Purchase frequency + staple restock suggestions
- Screenshot recipe import

**Exit criteria:** Can import a pasted order, agent learns brand preferences from history, shopping lists include staple restock suggestions.
