import { getDb, closeDb } from '../lib/db.js';

/**
 * Recalculate purchase_frequency from all purchase history.
 * Groups by product generic_name, calculates avg days between purchases.
 */
export function updateFrequency(db) {
  // Get all matched purchase items with their order dates and product generic_names
  const items = db.prepare(`
    SELECT
      p.generic_name,
      pu.order_date,
      pi.quantity
    FROM purchase_items pi
    JOIN products p ON p.id = pi.product_id
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pi.product_id IS NOT NULL
      AND p.generic_name IS NOT NULL
      AND pu.order_date IS NOT NULL
    ORDER BY p.generic_name, pu.order_date
  `).all();

  if (items.length === 0) {
    console.log('No matched purchase items found.');
    return { updated: 0 };
  }

  // Group by generic_name
  const groups = new Map();
  for (const item of items) {
    const key = item.generic_name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { genericName: item.generic_name, dates: [], quantities: [] });
    }
    groups.get(key).dates.push(item.order_date);
    groups.get(key).quantities.push(item.quantity || 1);
  }

  // Clear and rebuild frequency table
  db.prepare('DELETE FROM purchase_frequency').run();

  const insert = db.prepare(`
    INSERT INTO purchase_frequency (generic_name, avg_days_between, last_purchased, purchase_count, typical_quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);

  let updated = 0;

  for (const [, group] of groups) {
    const uniqueDates = [...new Set(group.dates)].sort();
    const purchaseCount = uniqueDates.length;
    const lastPurchased = uniqueDates[uniqueDates.length - 1];

    // Calculate avg days between purchases
    let avgDays = null;
    if (uniqueDates.length >= 2) {
      let totalDays = 0;
      for (let i = 1; i < uniqueDates.length; i++) {
        const d1 = new Date(uniqueDates[i - 1]);
        const d2 = new Date(uniqueDates[i]);
        totalDays += (d2 - d1) / (1000 * 60 * 60 * 24);
      }
      avgDays = totalDays / (uniqueDates.length - 1);
    }

    // Typical quantity (median)
    const sorted = group.quantities.sort((a, b) => a - b);
    const typicalQty = sorted[Math.floor(sorted.length / 2)];

    insert.run(group.genericName, avgDays, lastPurchased, purchaseCount, typicalQty);
    updated++;
  }

  return { updated };
}

// CLI
if (process.argv[1]?.includes('update-frequency')) {
  const db = getDb();
  const { updated } = updateFrequency(db);
  console.log(`Purchase frequency updated for ${updated} item(s).`);

  // Show top items
  const top = db.prepare(`
    SELECT * FROM purchase_frequency
    ORDER BY purchase_count DESC
    LIMIT 20
  `).all();

  if (top.length) {
    console.log('\nTop purchased items:');
    for (const t of top) {
      const avg = t.avg_days_between != null ? `every ~${Math.round(t.avg_days_between)} days` : 'once';
      console.log(`  ${t.generic_name}: ${t.purchase_count}x (${avg}), last: ${t.last_purchased}`);
    }
  }

  closeDb();
}
