# Grocery Agent — New World New Lynn

A grocery shopping assistant backed by a SQLite database of the full New World New Lynn product catalog, with full-text and vector search, recipe management, brand preferences, and shopping list generation.

## Store

- **Store:** New World New Lynn, Auckland
- **Catalog size:** 13,321 products
- **Last updated:** Run `npm run rescrape` to refresh

## Available Tools

### `search_products`

Search the product catalog using hybrid FTS + vector search.

**Usage:** `node search.js <query>`

**Parameters:**
- `query` (string, required) — Natural language search query (e.g. "coconut milk", "cheap chicken breast", "gluten free bread")

**Returns:** Ranked list of matching products with name, brand, price, category, stock status, special/sale info, match type.

---

### `set_preference`

Set a brand preference for a generic ingredient.

**Usage:** `node preferences/set-preference.js <generic_name> <product_id> [context]`

**Parameters:**
- `generic_name` (string, required) — Generic ingredient name (e.g. "bread", "coconut milk")
- `product_id` (integer, required) — Product ID from catalog
- `context` (string, optional) — Context like "baking", "curry" (default: "default")

---

### `get_preference`

Retrieve brand preferences.

**Usage:** `node preferences/get-preference.js [generic_name]`

**Parameters:**
- `generic_name` (string, optional) — If omitted, lists all preferences

---

### `add_recipe`

Add a recipe with ingredients from JSON input.

**Usage:** `echo '{"name":"...","ingredients":[...]}' | node recipes/add-recipe.js`

**Input JSON fields:** name, sourceType, sourceUrl, sourceAuthor, instructions, servings, prepTime, cookTime, rating (1-5), tags, notes, ingredients (array with genericName, quantity, preparation, optional)

---

### `search_recipes`

Search recipes by name, tag, or ingredient.

**Usage:** `node recipes/search-recipes.js <query>`

---

### `parse_text`

Parse raw recipe text into structured recipe using AI.

**Usage:** `echo "recipe text..." | node recipes/parse-text.js [--save]`

---

### `parse_instagram`

Extract and parse recipe from an Instagram URL using Playwright + AI.

**Usage:** `node recipes/parse-instagram.js <url> [--save]`

---

### `parse_screenshot`

Extract recipe from a screenshot/photo using AI vision.

**Usage:** `node recipes/parse-screenshot.js <image-path> [--save]`

**Supports:** .jpg, .jpeg, .png, .gif, .webp

---

### `update_recipe`

Update recipe fields, rate, mark cooked, add/remove ingredients.

**Usage:** `node recipes/update-recipe.js <recipe_id> [--rating N] [--name "..."] [--cooked] [--add-ingredient "name:qty"] [--remove-ingredient ID]`

---

### `link_ingredients`

Resolve all recipe ingredients to catalog products.

**Usage:** `node recipes/link-ingredients.js <recipe_id>`

---

### `build_list`

Generate a shopping list from recipes with ingredient resolution to catalog products.

**Usage:** `node lists/build-list.js --recipe "Recipe Name" [--item "extra item"] [--name "List Name"]`

**Output:** WhatsApp-formatted list with emoji category headers, estimated prices, and unresolved item markers.

---

### `update_list`

Modify a live shopping list.

**Usage:**
- `node lists/update-list.js add <list_id> "<item>" [quantity]`
- `node lists/update-list.js remove <item_id>`
- `node lists/update-list.js swap <item_id> <product_id> [--save-preference]`
- `node lists/update-list.js check <item_id>`
- `node lists/update-list.js complete <list_id>`

---

### `scrape_orders`

Scrape all past orders from the NW website account using Playwright. Opens a browser for manual login, then automatically scrapes order history, imports items, matches to catalog, updates frequency stats, and suggests brand preferences.

**Usage:** `node history/scrape-orders.js`

**Flow:**
1. Opens browser to NW login page — user logs in manually
2. Scrapes order history list
3. Scrapes each order detail page for items
4. Imports into DB (skips already-imported orders by reference)
5. Runs match → frequency → preference pipeline

**Debug:** Saves HTML to `data/debug/order-history.html` and `data/debug/order-detail-*.html` for selector debugging.

---

### `parse_order`

Import purchase history by parsing pasted order text with AI.

**Usage:** `echo "order text..." | node history/parse-order.js`

---

### `match_items`

Match imported purchase items to catalog products.

**Usage:** `node history/match-items.js <purchase_id>`

---

### `update_frequency`

Recalculate purchase frequency stats from all purchase history.

**Usage:** `node history/update-frequency.js`

---

### `learn_preferences`

Analyze purchase patterns and suggest brand preferences.

**Usage:** `node preferences/learn-from-history.js`

Suggests preferences where one product accounts for >60% of purchases with 3+ buys. Returns suggestions for manual confirmation.

### `add_to_cart`

Resolve items from a text list to catalog products and add them to the NW online cart.

**Usage:**
- `node cart/add-to-cart.js "chicken thighs" "broccoli" "2x mince" "milk"`
- `echo '[{"name":"milk","qty":1}]' | node cart/add-to-cart.js`

**Flow:**
1. Resolves each item using preferences then hybrid search
2. Shows resolved products with prices for confirmation
3. Opens browser for login (if needed), extracts auth token
4. Adds products to NW cart via API

**Notes:**
- Items prefixed with quantity work: "2x mince", "3x yoghurt"
- Accepts JSON array on stdin for programmatic use
- Uses brand preferences to pick the right product for generic names
- List parsing (spelling correction, generalisations) is handled by the calling agent (Claude Opus 4.5), not this tool

---

## Database Setup

```bash
npm run db:init       # Create base schema
npm run db:migrate    # Apply all migrations (Phase 2 + 3 tables)
```
