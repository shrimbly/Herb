import { getDb, closeDb } from '../lib/db.js';

/**
 * Check if the product name is relevant to the generic_name.
 * Prevents bad mappings like "berries" → pomegranate or "tomatoes" → cucumber.
 */
function nameMatchesCategory(productName, genericName) {
  const nameWords = productName.toLowerCase().split(/\s+/);
  const gnWords = genericName.toLowerCase().split(/[\s&,]+/).filter(w => w.length >= 3);

  // Check if any word from generic_name appears in (or overlaps with) product name
  return gnWords.some(gw =>
    nameWords.some(nw => nw.includes(gw) || gw.includes(nw))
  );
}

/**
 * Analyze purchase patterns and suggest brand preferences.
 *
 * Strict criteria to avoid overly-broad preferences:
 * - Product name must relate to the generic_name (word overlap check)
 * - Skip compound category names (containing "&")
 * - Require >70% share and 3+ total buys
 * - No other product with 3+ buys in the group
 *
 * Returns suggestions for user confirmation — does NOT auto-apply.
 */
export function suggestPreferences(db) {
  // Get purchase counts per product per generic_name
  const data = db.prepare(`
    SELECT
      p.generic_name,
      pi.product_id,
      p.name AS product_name,
      p.brand,
      p.price,
      COUNT(*) AS buy_count
    FROM purchase_items pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.product_id IS NOT NULL
      AND p.generic_name IS NOT NULL
    GROUP BY p.generic_name, pi.product_id
    ORDER BY p.generic_name, buy_count DESC
  `).all();

  if (data.length === 0) return [];

  // Group by generic_name
  const groups = new Map();
  for (const row of data) {
    const key = row.generic_name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { genericName: row.generic_name, products: [], totalBuys: 0 });
    }
    const g = groups.get(key);
    g.products.push(row);
    g.totalBuys += row.buy_count;
  }

  // Check existing preferences
  const existingPrefs = new Set(
    db.prepare("SELECT generic_name FROM brand_preferences WHERE context = 'default'").all()
      .map(r => r.generic_name.toLowerCase())
  );

  const suggestions = [];

  for (const [key, group] of groups) {
    // Skip if preference already set
    if (existingPrefs.has(key)) continue;

    // Skip compound category names (e.g., "beef steaks & schnitzel", "canned salmon & other seafood")
    // These are NW catalog categories, not user search terms
    if (group.genericName.includes('&') || group.genericName.includes(',')) continue;

    // Skip overly-long category names (>3 words) — usually NW catalog categories
    if (group.genericName.split(/\s+/).length > 3) continue;

    // Need at least 3 total purchases
    if (group.totalBuys < 3) continue;

    const top = group.products[0];
    const share = top.buy_count / group.totalBuys;

    // Need >70% dominance (stricter than before)
    if (share < 0.7) continue;

    // Validate: product name must relate to the generic_name
    // Prevents "berries" → pomegranate, "tomatoes" → cucumber, etc.
    if (!nameMatchesCategory(top.product_name, group.genericName)) continue;

    // If there's a competitor with 3+ buys, the category is too diverse
    const hasStrongCompetitor = group.products.length > 1 && group.products[1].buy_count >= 3;
    if (hasStrongCompetitor) continue;

    suggestions.push({
      genericName: group.genericName,
      productId: top.product_id,
      productName: top.product_name,
      brand: top.brand,
      price: top.price,
      buyCount: top.buy_count,
      totalBuys: group.totalBuys,
      share: Math.round(share * 100),
      confidence: Math.min(0.85, 0.5 + share * 0.3 + Math.min(top.buy_count / 10, 0.2)),
    });
  }

  return suggestions.sort((a, b) => b.share - a.share);
}

// CLI
if (process.argv[1]?.includes('learn-from-history')) {
  const db = getDb();
  const suggestions = suggestPreferences(db);

  if (suggestions.length === 0) {
    console.log('No preference suggestions. Need more purchase history (3+ buys with >60% same product).');
  } else {
    console.log(`${suggestions.length} preference suggestion(s):\n`);

    for (const s of suggestions) {
      const price = s.price != null ? `$${s.price.toFixed(2)}` : 'N/A';
      console.log(`  ${s.genericName} → ${s.productName} (${s.brand || '-'}) ${price}`);
      console.log(`    Bought ${s.buyCount}/${s.totalBuys} times (${s.share}%), confidence: ${(s.confidence * 100).toFixed(0)}%`);
    }

    console.log('\nTo apply a suggestion:');
    console.log('  node preferences/set-preference.js <generic_name> <product_id>');
  }

  closeDb();
}
