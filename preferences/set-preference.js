import { getDb, closeDb } from '../lib/db.js';

export function setPreference(db, { genericName, productId, context = 'default', source = 'explicit', confidence = 0.9, notes = null, strategy = 'fixed' }) {
  // Ensure strategy column exists (added in wizard update)
  try { db.exec("ALTER TABLE brand_preferences ADD COLUMN strategy TEXT DEFAULT 'fixed'"); } catch {}

  return db.prepare(`
    INSERT INTO brand_preferences (generic_name, context, preferred_product_id, confidence, source, notes, strategy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generic_name, context) DO UPDATE SET
      preferred_product_id = excluded.preferred_product_id,
      confidence = excluded.confidence,
      source = excluded.source,
      notes = excluded.notes,
      strategy = excluded.strategy,
      updated_at = datetime('now')
  `).run(genericName, context, productId, confidence, source, notes, strategy);
}

// CLI
if (process.argv[1]?.includes('set-preference')) {
  const [genericName, productId, context] = process.argv.slice(2);

  if (!genericName || !productId) {
    console.log('Usage: node preferences/set-preference.js <generic_name> <product_id> [context]');
    console.log('Example: node preferences/set-preference.js bread 1234');
    process.exit(1);
  }

  const db = getDb();
  const product = db.prepare('SELECT id, name, brand FROM products WHERE id = ?').get(Number(productId));

  if (!product) {
    console.error(`Product ${productId} not found.`);
    closeDb();
    process.exit(1);
  }

  setPreference(db, {
    genericName,
    productId: Number(productId),
    context: context || 'default',
  });

  console.log(`Preference set: "${genericName}" → ${product.name} (${product.brand || 'no brand'})${context ? ` [${context}]` : ''}`);
  closeDb();
}
