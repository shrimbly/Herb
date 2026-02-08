import { getDb, closeDb } from '../lib/db.js';
import { ftsSearch, vectorSearch, mergeResults } from '../lib/search.js';

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Match unmatched purchase items to catalog products.
 */
export async function matchPurchaseItems(db, purchaseId) {
  const items = db.prepare(`
    SELECT * FROM purchase_items
    WHERE purchase_id = ? AND product_id IS NULL
  `).all(purchaseId);

  if (items.length === 0) {
    return { matched: 0, flagged: 0, total: 0 };
  }

  const updateItem = db.prepare(`
    UPDATE purchase_items SET product_id = ?, match_confidence = ?
    WHERE id = ?
  `);

  let matched = 0;
  let flagged = 0;
  const results = [];

  for (const item of items) {
    const ftsResults = ftsSearch(db, item.raw_name, 5);

    let vecResults = [];
    try {
      vecResults = await vectorSearch(db, item.raw_name, 5);
    } catch {
      // Vector search unavailable
    }

    const merged = mergeResults(ftsResults, vecResults);

    if (merged.length === 0) {
      results.push({ item: item.raw_name, status: 'no_match', candidates: [] });
      flagged++;
      continue;
    }

    // Score the best match
    const best = merged[0];
    let confidence = 0;

    // Exact name match
    if (best.name.toLowerCase() === item.raw_name.toLowerCase()) {
      confidence = 0.95;
    } else if (best.name.toLowerCase().includes(item.raw_name.toLowerCase()) ||
               item.raw_name.toLowerCase().includes(best.name.toLowerCase())) {
      confidence = 0.8;
    } else if (best.matchType === 'BOTH') {
      confidence = 0.7;
    } else {
      confidence = 0.5;
    }

    updateItem.run(best.id, confidence, item.id);

    if (confidence < CONFIDENCE_THRESHOLD) {
      flagged++;
      results.push({
        item: item.raw_name,
        status: 'low_confidence',
        matchedTo: best.name,
        confidence,
        candidates: merged.slice(0, 3).map(c => ({ id: c.id, name: c.name, brand: c.brand })),
      });
    } else {
      matched++;
      results.push({
        item: item.raw_name,
        status: 'matched',
        matchedTo: best.name,
        confidence,
      });
    }
  }

  return { matched, flagged, total: items.length, results };
}

// CLI
if (process.argv[1]?.includes('match-items')) {
  const purchaseId = Number(process.argv[2]);

  if (!purchaseId) {
    console.log('Usage: node history/match-items.js <purchase_id>');
    process.exit(1);
  }

  const db = getDb();

  try {
    const { matched, flagged, total, results } = await matchPurchaseItems(db, purchaseId);

    console.log(`Matching items for purchase #${purchaseId}:\n`);

    for (const r of results || []) {
      if (r.status === 'matched') {
        console.log(`  ✅ ${r.item} → ${r.matchedTo} (${(r.confidence * 100).toFixed(0)}%)`);
      } else if (r.status === 'low_confidence') {
        console.log(`  ⚠️  ${r.item} → ${r.matchedTo} (${(r.confidence * 100).toFixed(0)}%) — needs confirmation`);
        for (const c of r.candidates || []) {
          console.log(`     → ${c.name} (${c.brand || '-'})`);
        }
      } else {
        console.log(`  ❌ ${r.item} — no match found`);
      }
    }

    console.log(`\n${matched} matched, ${flagged} need review, ${total} total.`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    closeDb();
  }
}
