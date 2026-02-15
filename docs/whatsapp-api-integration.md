# WhatsApp API Integration — Design Analysis

## Context

Herb currently operates as a backend "skill" consumed by the OpenClaw WhatsApp gateway. Three major areas rely on brittle, reverse-engineered browser automation (Playwright):

1. **Product catalog** — scraped from the New World website HTML
2. **Authentication** — automated form-fill login + Bearer token extraction from intercepted requests
3. **Cart submission** — POST to an undocumented `api-prod.newworld.co.nz` endpoint with a scraped token

This document assumes New World provides **official API access** for authentication (OAuth), product feed, and cart management — and evaluates what it would take to build a native WhatsApp app on top of that.

---

## What Would Change

### 1. Kill Playwright (biggest win)

Playwright is currently used for:

| Use case | Current file | Replacement |
|----------|-------------|-------------|
| Scrape product catalog | `scraper/scrape-products.js`, `scrape-categories.js` | NW Product Feed API |
| Login + token extraction | `cart/add-to-cart.js`, `web/cart-submit.js` | NW OAuth2 flow |
| Cart submission | `web/cart-submit.js` | NW Cart API (official) |
| Order history scraping | `history/scrape-orders.js` | NW Order History API (if available) |
| Instagram recipe scraping | `recipes/parse-instagram.js` | Keep as-is (separate concern) |

Removing Playwright from the cart/catalog/auth path eliminates:
- Headless Chrome memory overhead (~200-500MB per session)
- Stealth plugin cat-and-mouse with bot detection
- Login form selector fragility
- Token expiry guesswork
- The entire `scraper/browser.js` helper for these flows

**Playwright stays** only for `parse-instagram.js` (recipe extraction from Instagram) — a completely separate concern.

### 2. Replace Scraper with Product Feed Sync

**Current:** Full HTML scrape of ~13,000 products via Playwright page navigation, taking 30+ minutes with rate limiting.

**With official API:**

```
NW Product Feed API
    ↓ (paginated JSON, delta sync)
new: catalog/sync.js
    ↓
SQLite products table (same schema)
    ↓
normalise-products.js (same)
    ↓
embed-products.js (same)
```

New module: `catalog/sync.js`
- Replaces `scraper/scrape-categories.js` + `scraper/scrape-products.js`
- Calls NW product feed with pagination, stores raw JSON
- Supports delta/incremental sync (only changed products since last sync)
- Maps NW API response fields to existing `products` table columns
- Runs `normalise-products.js` and `embed-products.js` on new/changed products only
- Schedule: cron or on-demand, minutes instead of 30+ minutes

What stays unchanged:
- `normalise-products.js` — still need to extract brand/generic names
- `embed-products.js` — still need vector embeddings for semantic search
- `lib/search.js` — FTS + vector search untouched
- `lib/resolve.js` — ingredient resolution pipeline untouched
- The entire SQLite schema — no changes needed

### 3. Replace Browser Auth with OAuth2

**Current flow** (`cart/add-to-cart.js:41-91`, `web/cart-submit.js:25-93`):
1. Launch Playwright browser
2. Navigate to NW login page
3. Fill email/password fields via DOM selectors
4. Click submit, wait for password field to disappear
5. Navigate to cart page to trigger API requests
6. Intercept network requests to extract Bearer token from `Authorization` header
7. Fall back to scanning localStorage/sessionStorage for JWTs

**With official OAuth:**

New module: `lib/nw-auth.js`
- Standard OAuth2 client credentials or authorization code flow
- Token refresh with expiry tracking
- Store refresh token encrypted in SQLite or `.env`
- Single function: `getAccessToken()` → returns valid Bearer token
- No browser, no DOM, no selectors

This eliminates the duplicated login logic in both `cart/add-to-cart.js` and `web/cart-submit.js`.

### 4. Replace Reverse-Engineered Cart API with Official Cart API

**Current** (`web/cart-submit.js:95-116`):
- POSTs to `https://api-prod.newworld.co.nz/v1/edge/cart` (undocumented)
- Product ID format: manually convert `5007770_ea_000nw` → `5007770-EA-000`
- Sale type: inferred from `_kgm_` in product ID string
- Batch add with individual fallback on failure
- No documented error codes, no rate limit info

**With official API:**
- Proper product IDs from the feed (no format conversion hacking)
- Documented error responses (out of stock, invalid product, quantity limits)
- Known rate limits and retry semantics
- Possibly: read current cart, remove items, update quantities

New module: `lib/nw-cart.js`
- `addToCart(token, items)` — official endpoint
- `getCart(token)` — read current cart state
- `removeFromCart(token, productIds)` — if available
- `setStore(token, storeId)` — set active store
- Uses `lib/nw-auth.js` for token management

### 5. Direct WhatsApp Integration (Replace OpenClaw)

This is the most substantial new work. Currently OpenClaw handles all WhatsApp messaging, NLP routing, and conversation state. Going direct means Herb becomes a full WhatsApp Business app.

#### WhatsApp Cloud API Integration

New module: `whatsapp/` directory

```
WhatsApp Cloud API
    ↓ webhook (POST /webhook)
whatsapp/webhook.js — verify + receive messages
    ↓
whatsapp/router.js — intent classification + dispatch
    ↓
whatsapp/handlers/ — one per feature area
    ├── search.js      (product search)
    ├── recipe.js      (recipe CRUD)
    ├── list.js        (shopping list)
    ├── cart.js         (cart management)
    ├── preference.js  (brand preferences)
    └── history.js     (order history)
    ↓
whatsapp/send.js — format + send responses via Cloud API
```

**Webhook handler** (`whatsapp/webhook.js`):
- `GET /webhook` — Meta verification challenge (one-time setup)
- `POST /webhook` — Receive inbound messages (text, image, interactive responses, order events)
- Signature verification using app secret

**Message router** (`whatsapp/router.js`):
- Classify intent using GPT-4o-mini (same model already in use for recipe parsing)
- Or: use keyword/pattern matching for common commands, LLM as fallback
- Maintain conversation context per phone number (Redis or SQLite session table)
- Route to appropriate handler

**Response sender** (`whatsapp/send.js`):
- Text messages (with markdown-like WhatsApp formatting: `*bold*`, `_italic_`)
- Interactive list messages (up to 10 sections, 10 rows each)
- Interactive reply buttons (up to 3 buttons)
- Product messages (link to WhatsApp catalog)
- Template messages (for proactive notifications like "your cart is ready")

#### New env vars:
```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
```

### 6. WhatsApp Native Product Catalog

The WhatsApp Business Platform supports **product catalogs** natively — users can browse products, view images and prices, and add to cart without leaving WhatsApp.

#### Catalog Sync (`whatsapp/catalog-sync.js`):
- Sync products from SQLite → WhatsApp Commerce Manager catalog via the Catalog API
- Map fields: name, price, image_url, description, category → WhatsApp catalog item schema
- Handle the 500-item limit per catalog message (paginate if needed)
- Delta sync: only push changed products
- Schedule: after each NW product feed sync

#### Product Messages:
- When user searches for a product, return results as WhatsApp **Single Product Message** or **Multi Product Message**
- User taps product → sees full detail with image, price, description
- User taps "Add to Cart" → item added to WhatsApp native cart

### 7. WhatsApp Native Cart + Order Flow

With the WhatsApp cart API, the checkout flow becomes:

```
User searches "milk" in WhatsApp
    ↓
Herb returns product results as Multi Product Message
    ↓
User taps "Add to Cart" on Anchor Blue Milk 2L
    ↓
WhatsApp sends cart update webhook to Herb
    ↓
User taps "Send Cart" when ready
    ↓
Herb receives order webhook with cart contents
    ↓
Herb calls NW Cart API to add items to NW online cart
    ↓
Herb sends confirmation message with total + NW checkout link
```

This **replaces** the current web UI checkout page (`web/render.js`, `web/session.js`, `web/routes/checkout.js`) for the WhatsApp use case. The web checkout could stay as a fallback or for non-WhatsApp access.

---

## New Architecture

```
┌──────────────────────────────────────────────┐
│   WhatsApp (Willie / Wife)                   │
│   Native catalog, cart, interactive messages  │
└──────────────┬───────────────────────────────┘
               │ Cloud API webhooks
┌──────────────▼───────────────────────────────┐
│   Herb Server (Hono)                         │
│                                              │
│   whatsapp/webhook.js  ← POST /webhook       │
│   whatsapp/router.js   ← intent dispatch     │
│   whatsapp/send.js     ← response formatting │
│   whatsapp/catalog-sync.js ← catalog push    │
│                                              │
│   Existing modules (unchanged):              │
│   ├── lib/resolve.js    (ingredient resolver)│
│   ├── lib/search.js     (FTS + vector)       │
│   ├── lib/ai.js         (embeddings)         │
│   ├── recipes/*         (recipe management)  │
│   ├── preferences/*     (brand preferences)  │
│   ├── lists/*           (shopping lists)      │
│   ├── history/*         (purchase history)   │
│   └── web/*             (checkout fallback)  │
│                                              │
│   New modules:                               │
│   ├── lib/nw-auth.js    (OAuth2 client)      │
│   ├── lib/nw-cart.js    (official cart API)   │
│   └── catalog/sync.js   (product feed sync)  │
└──────────────┬───────────────────────────────┘
               │ Official APIs
┌──────────────▼───────────────────────────────┐
│   New World APIs (official)                  │
│   ├── OAuth2 token endpoint                  │
│   ├── Product Feed API                       │
│   ├── Cart API                               │
│   └── Order History API (if available)       │
└──────────────────────────────────────────────┘
```

---

## Work Breakdown

### Phase 1: NW Official API Integration (replace Playwright)

| Task | Replaces | Effort |
|------|----------|--------|
| `lib/nw-auth.js` — OAuth2 client with token refresh | Playwright login + token interception in 2 files | Small |
| `lib/nw-cart.js` — official cart add/read/remove | `web/cart-submit.js` Playwright flow, `cart/add-to-cart.js` browser flow | Small |
| `catalog/sync.js` — product feed sync | `scraper/scrape-categories.js` + `scraper/scrape-products.js` | Medium |
| Update `web/cart-submit.js` to use `nw-cart.js` instead of Playwright | — | Small |
| Update `cart/add-to-cart.js` to use `nw-cart.js` | — | Small |
| Update `history/scrape-orders.js` to use API (if available) | Playwright order scraping | Small |
| Remove Playwright from `package.json` for production (keep as devDep for Instagram) | — | Trivial |

**Outcome:** Everything still works through OpenClaw, but the backend is API-driven instead of browser-automated. Faster, more reliable, no bot detection issues.

### Phase 2: WhatsApp Cloud API (direct messaging)

| Task | Notes |
|------|-------|
| `whatsapp/webhook.js` — webhook verification + message ingestion | Standard Cloud API webhook setup |
| `whatsapp/send.js` — message sending (text, interactive, templates) | WhatsApp Cloud API message types |
| `whatsapp/router.js` — intent classification + conversation state | GPT-4o-mini for NLU, SQLite for session state |
| `whatsapp/handlers/*` — one handler per feature | Wire up existing modules (search, recipes, lists, etc.) |
| Conversation session table in SQLite | Track per-user conversation state |
| Message template registration | For proactive messages (order confirmations, restock reminders) |
| Webhook signature verification | Security requirement |

**Outcome:** Herb talks directly to WhatsApp. OpenClaw dependency removed.

### Phase 3: WhatsApp Commerce (native catalog + cart)

| Task | Notes |
|------|-------|
| `whatsapp/catalog-sync.js` — push products to WhatsApp catalog | Map NW products → WhatsApp catalog item schema |
| Product message formatting | Single Product + Multi Product messages |
| Cart webhook handling | Receive cart/order events from WhatsApp |
| Cart → NW Cart bridge | When user "sends cart" in WhatsApp, add to NW online cart |
| Order confirmation messages | Template message with total + checkout link |

**Outcome:** Users browse products, add to cart, and check out natively in WhatsApp.

---

## What Stays the Same

The core "brain" of Herb is untouched:

- **SQLite database** — same schema, same data
- **FTS + vector search** (`lib/search.js`) — same hybrid search
- **Ingredient resolution** (`lib/resolve.js`) — same 5-stage pipeline
- **Recipe management** (`recipes/*`) — all parsing/storage unchanged
- **Brand preferences** (`preferences/*`) — same learning system
- **Shopping lists** (`lists/*`) — same list building + formatting
- **Purchase history** (`history/*`) — same import + matching (source changes from scraping to API)
- **Embeddings** (`lib/ai.js`, `scraper/embed-products.js`) — same OpenAI embeddings
- **Product normalisation** (`scraper/normalise-products.js`) — same brand/generic extraction

This is roughly 70-80% of the codebase. The WhatsApp integration is a new **interface layer**; the NW API migration is a **transport layer swap**. The domain logic is unaffected.

---

## What Gets Removed

| File/Module | Reason |
|-------------|--------|
| `scraper/scrape-categories.js` | Replaced by product feed API |
| `scraper/scrape-products.js` | Replaced by product feed API |
| `scraper/browser.js` (partially) | Only kept for Instagram scraping |
| `scraper/rescrape.js` | Replaced by `catalog/sync.js` |
| Playwright login logic in `cart/add-to-cart.js` | Replaced by `lib/nw-auth.js` |
| Playwright login logic in `web/cart-submit.js` | Replaced by `lib/nw-auth.js` |
| `history/scrape-orders.js` (Playwright flow) | Replaced by API call (if available) |
| `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth` deps | Only `playwright` kept as devDep for Instagram |

---

## Key Design Decisions

### 1. Keep OpenClaw or go direct?

**Recommendation: Go direct.** With the WhatsApp Cloud API, Herb can handle webhooks directly. OpenClaw's value was abstracting the WhatsApp protocol — with official API access, that abstraction is thin. Going direct gives control over:
- Message formatting (interactive lists, product messages, buttons)
- Cart/order webhooks (WhatsApp commerce events)
- Template messages (proactive notifications)
- Conversation state management

The tradeoff: Herb now owns NLU (intent classification). This is solvable with GPT-4o-mini, which is already a dependency.

### 2. Keep the checkout web UI?

**Recommendation: Keep as fallback.** The WhatsApp native catalog/cart is the primary flow, but the web UI (`/checkout/:id`) is useful for:
- Non-WhatsApp access (sharing a checkout link)
- Complex product selection (many alternatives to compare)
- Debugging and admin use

### 3. Product catalog sync strategy

**Two options:**
- **Full mirror**: Sync all ~13,000 NW products to WhatsApp catalog. Allows native product browsing but requires managing a large catalog.
- **On-demand**: Only push products to WhatsApp when they appear in search results or shopping lists. Smaller catalog, less maintenance, but no native browsing.

**Recommendation: On-demand for now.** Sync resolved products (preferences + search results) to WhatsApp catalog as they're used. Full mirror can come later if browsing is a desired UX.

### 4. Conversation state

**Options:**
- SQLite table (consistent with existing data layer)
- Redis (faster, TTL support, but new dependency)
- In-memory Map (current approach for checkout sessions)

**Recommendation: SQLite.** Herb is single-user (two users), low throughput. SQLite is already the data layer. A `conversations` table with JSON state and TTL cleanup is sufficient.

---

## New Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| None required | WhatsApp Cloud API is plain HTTPS — use Node `fetch` | No SDK needed |

The WhatsApp Cloud API is a REST API. No new npm dependencies are strictly required — Node 18+ `fetch` handles all HTTP calls. Optionally, a lightweight WhatsApp SDK could reduce boilerplate, but for two users and a handful of message types, raw HTTP is fine.

---

## Environment / Infrastructure Changes

| Change | Notes |
|--------|-------|
| Public HTTPS endpoint | WhatsApp webhooks require a publicly accessible HTTPS URL |
| Webhook URL registration | Configure in Meta Business Suite |
| WhatsApp Business Account | Required for Cloud API access |
| Message templates approval | Templates need Meta review before use |
| NW API credentials | OAuth client ID/secret from New World |

The server currently runs on `localhost:3000`. For WhatsApp webhooks, it needs to be publicly accessible. Options:
- **ngrok/Cloudflare Tunnel** — for development
- **Deploy to a VPS** — for production (small Node.js app, minimal resources without Playwright)
- **Serverless** — possible but SQLite on disk complicates this

Without Playwright, the server footprint drops dramatically. No headless Chrome means it can run on a $5/month VPS or even a Raspberry Pi.

---

## Summary

The official NW APIs transform Herb from a "scrape-and-automate" system into a clean API-to-API bridge. The core intelligence (search, resolution, preferences, recipes) is untouched. The work breaks into three layers:

1. **Transport swap** (Phase 1): Replace Playwright with NW official APIs. This alone makes the existing system dramatically more reliable.
2. **Interface layer** (Phase 2): Add WhatsApp Cloud API webhook handling to talk directly to WhatsApp instead of through OpenClaw.
3. **Commerce layer** (Phase 3): Use WhatsApp native catalog and cart for a seamless in-chat shopping experience.

Each phase is independently valuable — Phase 1 can ship without Phase 2 or 3.
