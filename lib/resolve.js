import { getPreference } from '../preferences/get-preference.js';
import { ftsSearch, vectorSearch, mergeResults } from './search.js';

const AUTO_RESOLVE_THRESHOLD = 0.5;

/**
 * Resolve a dynamic preference strategy (lowest_price or on_special).
 * Parses candidate product IDs from pref.notes JSON, queries current prices,
 * and returns the best match according to the strategy.
 */
function resolveDynamicPreference(db, pref) {
  let candidates;
  try {
    const parsed = JSON.parse(pref.notes);
    candidates = parsed.candidates;
  } catch {
    return null;
  }
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const placeholders = candidates.map(() => '?').join(',');
  const products = db.prepare(`
    SELECT id, name, brand, price, in_stock, on_special
    FROM products
    WHERE id IN (${placeholders})
  `).all(...candidates);

  if (products.length === 0) return null;

  // Prefer in-stock products
  const inStock = products.filter(p => p.in_stock);
  const pool = inStock.length > 0 ? inStock : products;

  let picked;
  if (pref.strategy === 'on_special') {
    // Prefer on-special, then cheapest
    pool.sort((a, b) => (b.on_special - a.on_special) || (a.price - b.price));
    picked = pool[0];
  } else {
    // lowest_price — sort by price ascending
    pool.sort((a, b) => a.price - b.price);
    picked = pool[0];
  }

  return {
    resolved: true,
    productId: picked.id,
    productName: picked.name,
    brand: picked.brand,
    price: picked.price,
    confidence: pref.confidence,
    source: 'preference',
    strategy: pref.strategy,
  };
}

/**
 * Check if a product name is relevant to what was searched.
 * Prevents broad preferences from returning wrong products.
 * e.g. searching "schnitzel" shouldn't return "Scotch Fillet Steak"
 */
function isProductRelevant(productName, searchTerm) {
  const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const nameLower = productName.toLowerCase();
  // At least one significant search word must appear in the product name
  return searchWords.some(w => nameLower.includes(w));
}

/**
 * Build a map of product_id → purchase_count from purchase history.
 * Cached per db instance to avoid repeated queries.
 */
let _purchaseCountCache = null;
function getPurchaseCounts(db) {
  if (_purchaseCountCache) return _purchaseCountCache;
  const rows = db.prepare(`
    SELECT product_id, COUNT(*) as buy_count
    FROM purchase_items
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  `).all();
  _purchaseCountCache = new Map(rows.map(r => [r.product_id, r.buy_count]));
  return _purchaseCountCache;
}

/**
 * Search purchase history for products the user has bought that match a query.
 * Matches against the product NAME only (not generic_name category) to avoid
 * broad category matches like "schnitzel" hitting "steaks" category.
 * Returns the most-purchased matching product, or null.
 */
function findPurchasedProduct(db, searchTerm) {
  const words = searchTerm.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return null;

  // Build WHERE clause: each word must appear in product name
  const conditions = words.map(() => "LOWER(p.name) LIKE ?").join(' AND ');
  const params = words.map(w => `%${w}%`);

  const result = db.prepare(`
    SELECT p.id, p.name, p.brand, p.price, p.generic_name, COUNT(*) as buy_count
    FROM purchase_items pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.product_id IS NOT NULL AND (${conditions})
    GROUP BY pi.product_id
    ORDER BY buy_count DESC, p.price ASC
    LIMIT 1
  `).get(...params);

  return result || null;
}

/**
 * Resolve a recipe ingredient to a catalog product.
 *
 * Pipeline:
 * 1. Check brand_preferences for explicit match
 * 1b. Check purchase history for previously bought matching products
 * 2. FTS search on product catalog
 * 3. Vector search (enriched with recipe context)
 * 4. Merge, score, and pick best match (boosted by purchase history)
 */
export async function resolveIngredient(db, { genericName, context = 'default', recipeContext = null }) {
  // 1. Check preferences — but verify the product is relevant to the search term.
  // This prevents broad category preferences (e.g. "steaks" → scotch fillet) from
  // overriding when the user searches for something specific (e.g. "schnitzel").
  const pref = getPreference(db, genericName, context);
  if (pref && pref.confidence >= AUTO_RESOLVE_THRESHOLD) {
    if (isProductRelevant(pref.product_name, genericName)) {
      if (!pref.strategy || pref.strategy === 'fixed') {
        return {
          resolved: true,
          productId: pref.preferred_product_id,
          productName: pref.product_name,
          brand: pref.brand,
          price: pref.price,
          confidence: pref.confidence,
          source: 'preference',
        };
      } else {
        // Dynamic strategy — find best from candidates
        const dynamic = resolveDynamicPreference(db, pref);
        if (dynamic) return dynamic;
        // Fall back to the stored product if dynamic resolution fails
        return {
          resolved: true,
          productId: pref.preferred_product_id,
          productName: pref.product_name,
          brand: pref.brand,
          price: pref.price,
          confidence: pref.confidence,
          source: 'preference',
        };
      }
    }
    // Preference found but product name doesn't match search — skip it
  }

  // 1b. Check purchase history — if the user has bought a product matching this term,
  // use it directly. Confidence scales with how often they bought it.
  const purchased = findPurchasedProduct(db, genericName);
  if (purchased) {
    const confidence = Math.min(0.9, 0.6 + purchased.buy_count * 0.04);
    return {
      resolved: true,
      productId: purchased.id,
      productName: purchased.name,
      brand: purchased.brand,
      price: purchased.price,
      confidence,
      source: 'purchase_history',
    };
  }

  // 2. FTS search
  const ftsResults = ftsSearch(db, genericName, 10);

  // 3. Vector search — enrich query with recipe context for better semantics
  const searchQuery = recipeContext
    ? `${genericName} for ${recipeContext}`
    : genericName;

  let vecResults = [];
  try {
    vecResults = await vectorSearch(db, searchQuery, 10);
  } catch {
    // Vector search unavailable
  }

  // 4. Merge and score
  const merged = mergeResults(ftsResults, vecResults);

  if (merged.length === 0) {
    return {
      resolved: false,
      candidates: [],
      source: 'none',
    };
  }

  // Get purchase history counts for scoring boost
  const purchaseCounts = getPurchaseCounts(db);

  // Score candidates
  const nameRelevant = (product) => isProductRelevant(product.name, genericName);

  const scored = merged.map(r => {
    let score = 0;
    const relevant = nameRelevant(r);

    // Boost for exact generic_name match
    if (r.generic_name && r.generic_name.toLowerCase() === genericName.toLowerCase()) {
      score += 0.4;
    } else if (r.generic_name && r.generic_name.toLowerCase().includes(genericName.toLowerCase())) {
      // Only give category-inclusion boost if the product name is also relevant.
      // Prevents "schnitzel" from boosting "Scotch Fillet Steak" via category
      // "beef steaks & schnitzel".
      score += relevant ? 0.2 : 0;
    }

    // Boost for BOTH match type
    if (r.matchType === 'BOTH') score += 0.3;
    else if (r.matchType === 'FTS') score += 0.15;
    else score += 0.1;

    // Penalize out of stock
    if (!r.in_stock) score -= 0.2;

    // Boost for being on special
    if (r.on_special) score += 0.05;

    // Vector distance bonus (closer = better, distance is 0-2 for cosine)
    if (r.vecDistance != null) {
      score += Math.max(0, 0.2 - r.vecDistance * 0.1);
    }

    // Purchase history boost — only if the product name is relevant to the search.
    // Prevents frequently-bought products from hijacking unrelated searches
    // (e.g. scotch fillet boosted for "schnitzel" search).
    const buyCount = purchaseCounts.get(r.id) || 0;
    if (buyCount > 0 && relevant) {
      score += Math.min(0.3, 0.1 + buyCount * 0.04);
    }

    return { ...r, score: Math.min(1, Math.max(0, score)) };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best.score >= AUTO_RESOLVE_THRESHOLD) {
    return {
      resolved: true,
      productId: best.id,
      productName: best.name,
      brand: best.brand,
      price: best.price,
      confidence: best.score,
      source: 'search',
      candidates: scored.slice(0, 5),
    };
  }

  return {
    resolved: false,
    candidates: scored.slice(0, 5),
    source: 'search',
  };
}

/**
 * Resolve a batch of ingredients.
 */
export async function resolveIngredients(db, ingredients, recipeContext = null) {
  const results = [];
  for (const ing of ingredients) {
    const result = await resolveIngredient(db, {
      genericName: ing.genericName || ing.generic_name || ing.name,
      recipeContext,
    });
    results.push({
      ingredient: ing,
      resolution: result,
    });
  }
  return results;
}
