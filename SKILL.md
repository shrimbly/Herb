# Grocery Agent — New World New Lynn

A grocery shopping assistant backed by a SQLite database of the full New World New Lynn product catalog, with full-text and vector search.

## Store

- **Store:** New World New Lynn, Auckland
- **Catalog size:** ~5,000+ products
- **Last updated:** Run `npm run rescrape` to refresh

## Available Tools

### `search_products`

Search the product catalog using hybrid FTS + vector search.

**Usage:** `node search.js <query>`

**Parameters:**
- `query` (string, required) — Natural language search query (e.g. "coconut milk", "cheap chicken breast", "gluten free bread")

**Returns:** Ranked list of matching products with:
- Product name, brand, price
- Category and subcategory
- Stock status, special/sale info
- Match type (FTS, VEC, or BOTH)

**How it works:**
1. Full-text search (FTS5) on product name, brand, generic name, category, subcategory
2. Vector similarity search using OpenAI text-embedding-3-small embeddings
3. Results merged: items found by both methods ranked highest

## Not Yet Implemented (Phase 2+)

- Shopping list management
- Price comparison and tracking
- Meal planning integration
- Automatic reordering suggestions
- Budget tracking
- Recipe-based shopping
- Multi-store support
