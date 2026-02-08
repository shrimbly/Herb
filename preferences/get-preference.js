import { getDb, closeDb } from '../lib/db.js';

export function getPreference(db, genericName, context = 'default') {
  const normalized = genericName.toLowerCase().trim();

  // Try exact context first (case-insensitive), then fall back to 'default'
  const pref = db.prepare(`
    SELECT bp.*, p.name AS product_name, p.brand, p.price
    FROM brand_preferences bp
    JOIN products p ON p.id = bp.preferred_product_id
    WHERE LOWER(bp.generic_name) = ? AND bp.context = ?
  `).get(normalized, context);

  if (pref) return pref;

  if (context !== 'default') {
    return db.prepare(`
      SELECT bp.*, p.name AS product_name, p.brand, p.price
      FROM brand_preferences bp
      JOIN products p ON p.id = bp.preferred_product_id
      WHERE LOWER(bp.generic_name) = ? AND bp.context = 'default'
    `).get(normalized) || null;
  }

  return null;
}

export function getAllPreferences(db, genericName) {
  return db.prepare(`
    SELECT bp.*, p.name AS product_name, p.brand, p.price
    FROM brand_preferences bp
    JOIN products p ON p.id = bp.preferred_product_id
    WHERE bp.generic_name = ?
    ORDER BY bp.context
  `).all(genericName);
}

export function listPreferences(db) {
  return db.prepare(`
    SELECT bp.*, p.name AS product_name, p.brand, p.price
    FROM brand_preferences bp
    JOIN products p ON p.id = bp.preferred_product_id
    ORDER BY bp.generic_name, bp.context
  `).all();
}

// CLI
if (process.argv[1]?.includes('get-preference')) {
  const genericName = process.argv.slice(2).join(' ').trim();

  const db = getDb();

  if (!genericName) {
    // List all preferences
    const prefs = listPreferences(db);
    if (prefs.length === 0) {
      console.log('No preferences set.');
    } else {
      console.log(`${prefs.length} preference(s):\n`);
      for (const p of prefs) {
        const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
        const strat = p.strategy && p.strategy !== 'fixed' ? ` [${p.strategy}]` : '';
        console.log(`  ${p.generic_name} [${p.context}] → ${p.product_name} (${p.brand || '-'}) ${price}  (${p.source}, conf: ${p.confidence})${strat}`);
      }
    }
  } else {
    const prefs = getAllPreferences(db, genericName);
    if (prefs.length === 0) {
      console.log(`No preferences for "${genericName}".`);
    } else {
      console.log(`Preferences for "${genericName}":\n`);
      for (const p of prefs) {
        const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
        const strat = p.strategy && p.strategy !== 'fixed' ? ` [${p.strategy}]` : '';
        console.log(`  [${p.context}] → ${p.product_name} (${p.brand || '-'}) ${price}  (${p.source}, conf: ${p.confidence})${strat}`);
      }
    }
  }

  closeDb();
}
