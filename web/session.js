import crypto from 'crypto';
import { resolveIngredient } from '../lib/resolve.js';
import { ftsSearch } from '../lib/search.js';
import { getPreference } from '../preferences/get-preference.js';

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Create a checkout session by resolving all items.
 * Each item gets categorized as auto-confirmed or needs-confirmation.
 */
export async function createSession(db, items, source = null) {
  const sessionId = crypto.randomUUID();
  const resolvedItems = [];

  for (const item of items) {
    const name = item.name;
    const qty = item.qty || 1;

    const resolution = await resolveIngredient(db, { genericName: name });
    const pref = getPreference(db, name);

    // Determine if this item can be auto-confirmed
    let autoConfirmed = false;
    let selectedProductId = null;
    let strategyLabel = null;

    if (resolution.resolved) {
      selectedProductId = resolution.productId;

      if (resolution.source === 'preference') {
        const strategy = pref?.strategy || 'fixed';
        if (strategy === 'fixed') {
          autoConfirmed = true;
          strategyLabel = 'Preference';
        } else {
          // Dynamic strategy — user should confirm
          strategyLabel = strategy === 'lowest_price' ? 'Lowest price' : 'On special';
        }
      } else if (resolution.source === 'purchase_history') {
        if (resolution.confidence >= 0.7) {
          autoConfirmed = true;
          strategyLabel = 'Previously bought';
        } else {
          strategyLabel = 'History match';
        }
      } else if (resolution.source === 'search' && resolution.confidence >= 0.7) {
        autoConfirmed = true;
        strategyLabel = 'Best match';
      } else {
        strategyLabel = 'Low confidence';
      }
    }

    // Fetch candidates: use resolution candidates or FTS search
    let candidates = [];
    if (resolution.candidates && resolution.candidates.length > 0) {
      candidates = resolution.candidates;
    } else {
      // For preference-resolved items, get alternatives via FTS
      const ftsResults = ftsSearch(db, name, 10);
      candidates = ftsResults;
    }

    // Also fetch previously purchased products matching this search term
    // so they always appear as options even if search didn't rank them highly
    const searchWords = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    let purchasedProducts = [];
    if (searchWords.length > 0) {
      const conditions = searchWords.map(() => "LOWER(p.name) LIKE ?").join(' AND ');
      const params = searchWords.map(w => `%${w}%`);
      purchasedProducts = db.prepare(`
        SELECT p.id, p.name, p.brand, p.price, p.unit_size, p.image_url,
               p.in_stock, p.on_special, p.generic_name, COUNT(*) as buy_count
        FROM purchase_items pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.product_id IS NOT NULL AND (${conditions})
        GROUP BY pi.product_id
        ORDER BY buy_count DESC
        LIMIT 10
      `).all(...params);
    }

    // Merge purchased products into candidate pool
    const candidateIds = new Set(candidates.map(c => c.id));
    for (const pp of purchasedProducts) {
      if (!candidateIds.has(pp.id)) {
        candidates.push(pp);
        candidateIds.add(pp.id);
      }
    }

    // Fetch full product details for all candidates
    if (selectedProductId) candidateIds.add(selectedProductId);

    const placeholders = [...candidateIds].map(() => '?').join(',');
    const products = placeholders
      ? db.prepare(`
          SELECT id, nw_product_id, name, brand, price, unit_size, image_url,
                 in_stock, on_special, generic_name
          FROM products WHERE id IN (${placeholders})
        `).all(...candidateIds)
      : [];

    const productMap = new Map(products.map(p => [p.id, p]));

    // Check purchase history for badge
    const purchasedIds = new Set();
    if (products.length > 0) {
      const phPlaceholders = products.map(() => '?').join(',');
      const purchased = db.prepare(`
        SELECT DISTINCT product_id FROM purchase_items
        WHERE product_id IN (${phPlaceholders})
      `).all(...products.map(p => p.id));
      for (const row of purchased) purchasedIds.add(row.product_id);
    }

    // Build ordered candidate list
    const orderedCandidates = [];
    const seen = new Set();

    // 1. Previously purchased first
    for (const c of candidates) {
      if (purchasedIds.has(c.id) && productMap.has(c.id) && !seen.has(c.id)) {
        orderedCandidates.push({ ...productMap.get(c.id), previouslyBought: true });
        seen.add(c.id);
      }
    }

    // 2. Currently selected (if not already added)
    if (selectedProductId && productMap.has(selectedProductId) && !seen.has(selectedProductId)) {
      orderedCandidates.push({
        ...productMap.get(selectedProductId),
        previouslyBought: purchasedIds.has(selectedProductId),
      });
      seen.add(selectedProductId);
    }

    // 3. Remaining by search score
    for (const c of candidates) {
      if (!seen.has(c.id) && productMap.has(c.id)) {
        orderedCandidates.push({
          ...productMap.get(c.id),
          previouslyBought: purchasedIds.has(c.id),
        });
        seen.add(c.id);
      }
    }

    resolvedItems.push({
      name,
      qty,
      autoConfirmed,
      selectedProductId,
      strategyLabel,
      confidence: resolution.confidence || 0,
      source: resolution.source,
      candidates: orderedCandidates,
    });
  }

  // Calculate estimated total
  const estimatedTotal = resolvedItems.reduce((sum, item) => {
    if (!item.selectedProductId) return sum;
    const product = item.candidates.find(c => String(c.id) === String(item.selectedProductId));
    return sum + (product?.price || 0) * item.qty;
  }, 0);

  const session = {
    id: sessionId,
    items: resolvedItems,
    status: 'pending', // pending | confirming | submitting | done | error
    estimatedTotal,
    source,
    createdAt: Date.now(),
    events: [],
    eventListeners: new Set(),
  };

  sessions.set(sessionId, session);

  // Log to DB
  try {
    db.prepare(`
      INSERT INTO checkout_log (session_id, source, item_count, status)
      VALUES (?, ?, ?, 'created')
    `).run(sessionId, source, items.length);
  } catch {
    // Table might not exist yet
  }

  return session;
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function selectProduct(sessionId, itemIndex, productId) {
  const session = getSession(sessionId);
  if (!session) return null;
  if (itemIndex < 0 || itemIndex >= session.items.length) return null;

  const item = session.items[itemIndex];
  // Verify productId is in candidates
  const candidate = item.candidates.find(c => String(c.id) === String(productId));
  if (!candidate) return null;

  item.selectedProductId = productId;
  item.autoConfirmed = true; // User explicitly chose

  // Recalculate total
  session.estimatedTotal = session.items.reduce((sum, it) => {
    if (!it.selectedProductId) return sum;
    const p = it.candidates.find(c => String(c.id) === String(it.selectedProductId));
    return sum + (p?.price || 0) * it.qty;
  }, 0);

  return session;
}

export function pushEvent(sessionId, event) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.events.push({ ...event, time: Date.now() });
  for (const listener of session.eventListeners) {
    listener(event);
  }
}

export function addEventListener(sessionId, listener) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.eventListeners.add(listener);
}

export function removeEventListener(sessionId, listener) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.eventListeners.delete(listener);
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
