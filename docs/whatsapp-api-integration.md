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
- Interactive list messages (up to 10 sections, 10 rows each) — for recipe search results, product lists
- Interactive reply buttons (up to 3 buttons) — "Review Cart", "Yes/No" confirmations
- URL button messages — link out to checkout page with preview text
- Template messages (for proactive notifications like "your cart is ready", "order confirmed")

#### New env vars:
```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
```

### 6. Custom Checkout Web UI (kept, upgraded)

The existing checkout web UI (`web/render.js`, `web/session.js`, `web/routes/checkout.js`) is the **primary** product selection and cart confirmation interface. WhatsApp's native catalog/cart UI is too limited — capped at 10 sections of 10 items, no control over layout, no ability to show multiple alternatives per ingredient with confidence scores.

The current checkout page already provides:
- Product cards with images, prices, and unit pricing
- Radio selection between multiple candidates per ingredient
- Confidence badges and resolution strategy labels
- SSE-driven real-time progress during cart submission
- Estimated total with live updates as selections change

#### What changes in the checkout flow:

**Current flow:**
```
OpenClaw agent calls POST /api/checkout → creates session
    ↓
Agent sends checkout URL to user via WhatsApp
    ↓
User opens link in mobile browser → sees checkout page
    ↓
User reviews/swaps products, taps Confirm
    ↓
Playwright launches, logs in, submits cart (slow, fragile)
```

**New flow:**
```
WhatsApp webhook receives "add milk, bread, eggs to cart"
    ↓
whatsapp/handlers/cart.js calls POST /api/checkout internally
    ↓
Herb sends checkout URL back to user as WhatsApp message
    (with interactive button: "Review Cart" → opens link)
    ↓
User opens link in mobile browser → same checkout page
    ↓
User reviews/swaps products, taps Confirm
    ↓
lib/nw-cart.js calls official NW Cart API (fast, reliable)
    ↓
SSE pushes completion event → page shows "Done"
    ↓
Herb sends WhatsApp confirmation message with total + NW checkout link
```

Key improvements:
- **No Playwright** in the submission path — `web/cart-submit.js` calls `lib/nw-cart.js` directly instead of launching a browser
- **WhatsApp interactive button** to open checkout link (better UX than a raw URL in a text message)
- **Post-submission WhatsApp notification** — user gets a confirmation message even if they've closed the browser tab
- The checkout page itself needs minimal changes — just the backend submission logic swaps from Playwright to the official API

#### Checkout page enhancements to consider:
- Mobile-first polish (already monochrome minimal, but test on iPhone/Android WebView)
- Deep link back to WhatsApp after confirmation (optional)
- Show NW cart total from the official API (currently estimated from local prices)

---

## New Architecture

```
┌──────────────────────────────────────────────┐
│   WhatsApp (Willie / Wife)                   │
│   Text messages + interactive buttons/lists  │
└──────────────┬───────────────────────────────┘
               │ Cloud API webhooks
               │
┌──────────────▼───────────────────────────────┐
│   Herb Server (Hono)                         │
│                                              │
│   whatsapp/webhook.js  ← POST /webhook       │
│   whatsapp/router.js   ← intent dispatch     │
│   whatsapp/send.js     ← response formatting │
│                                              │
│   web/* ← checkout UI (primary cart review)  │
│   ├── routes/checkout.js  (session + API)    │
│   ├── render.js           (HTML generation)  │
│   ├── session.js          (session store)    │
│   └── cart-submit.js      (→ lib/nw-cart.js) │
│                                              │
│   Existing modules (unchanged):              │
│   ├── lib/resolve.js    (ingredient resolver)│
│   ├── lib/search.js     (FTS + vector)       │
│   ├── lib/ai.js         (embeddings)         │
│   ├── recipes/*         (recipe management)  │
│   ├── preferences/*     (brand preferences)  │
│   ├── lists/*           (shopping lists)     │
│   └── history/*         (purchase history)   │
│                                              │
│   New modules:                               │
│   ├── lib/nw-auth.js    (OAuth2 client)      │
│   ├── lib/nw-cart.js    (official cart API)   │
│   └── catalog/sync.js   (product feed sync)  │
└──────┬───────────────────────────┬───────────┘
       │ Official APIs             │ HTTPS link
┌──────▼───────────────────┐  ┌───▼──────────────────┐
│ New World APIs (official)│  │ Mobile Browser        │
│ ├── OAuth2 token endpoint│  │ Checkout page         │
│ ├── Product Feed API     │  │ (product selection,   │
│ ├── Cart API             │  │  confirmation, SSE    │
│ └── Order History API    │  │  progress)            │
└──────────────────────────┘  └───────────────────────┘
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

### Phase 3: Checkout + Notification Polish

| Task | Notes |
|------|-------|
| Refactor `web/cart-submit.js` to use `lib/nw-cart.js` | Replace Playwright submission with direct API call |
| WhatsApp interactive button for checkout link | "Review Cart" button instead of raw URL |
| Post-submission WhatsApp notification | Confirmation message with total + NW checkout link after cart is submitted |
| Message template registration for proactive notifications | Meta requires pre-approved templates for outbound messages |
| Checkout page mobile polish | Test in iPhone/Android WebView opened from WhatsApp |
| Optional: deep link back to WhatsApp from checkout page | "Return to chat" link after confirmation |

**Outcome:** Seamless loop — chat in WhatsApp, review in browser, confirmation back in WhatsApp.

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

### 2. Checkout UI: custom web page (not WhatsApp native cart)

**Decision: Keep the custom checkout web UI as the primary product review/confirmation interface.**

WhatsApp's native commerce features (catalog messages, in-chat cart) are too constrained:
- Max 10 sections × 10 items per Multi Product Message
- No way to show multiple candidate products per ingredient with confidence scores
- No radio selection between alternatives
- No real-time SSE progress during submission
- Limited layout control — can't show unit pricing, special badges, strategy labels

The existing checkout page (`/checkout/:id`) already handles all of this. The WhatsApp integration sends the checkout URL as an interactive button message — user taps it, reviews in their mobile browser, confirms, and gets a WhatsApp notification when it's done.

### 3. Conversation state

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
3. **Checkout polish** (Phase 3): Wire the WhatsApp ↔ checkout web UI loop — interactive buttons to open the checkout page, post-submission notifications back to WhatsApp.

Each phase is independently valuable — Phase 1 can ship without Phase 2 or 3. The custom checkout web UI stays as the primary product review and cart confirmation interface throughout all phases.
