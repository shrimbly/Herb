import { createInterface } from 'readline';
import { getDb, closeDb } from '../lib/db.js';
import { setPreference } from './set-preference.js';

const MAX_DISPLAY = 8;

// Words that describe an animal or farming method, not a specific cut/product type.
// If ALL words in a meat generic_name are in this set, the group is too broad.
const BROAD_MEAT_WORDS = new Set([
  'chicken', 'beef', 'pork', 'lamb', 'veal', 'poultry', 'seafood', 'fish', 'salmon',
  'free', 'range', 'organic', 'certified', 'grass', 'fed', 'premium', 'fresh',
]);

function isBroadMeatGroup(genericName) {
  const words = genericName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  return words.length > 0 && words.every(w => BROAD_MEAT_WORDS.has(w));
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ensure the strategy column exists on brand_preferences.
 */
function ensureStrategyColumn(db) {
  try {
    db.exec("ALTER TABLE brand_preferences ADD COLUMN strategy TEXT DEFAULT 'fixed'");
  } catch {
    // Column already exists
  }
}

/**
 * Get all generic_name groups from purchase history with their products.
 * Returns Map<genericName, { products: [...], totalBuys }> sorted by total buys desc.
 */
function getPurchaseGroups(db) {
  const data = db.prepare(`
    SELECT
      p.generic_name,
      p.category,
      pi.product_id,
      p.name AS product_name,
      p.brand,
      p.price,
      p.on_special,
      p.in_stock,
      COUNT(*) AS buy_count
    FROM purchase_items pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.product_id IS NOT NULL
      AND p.generic_name IS NOT NULL
    GROUP BY p.generic_name, pi.product_id
    ORDER BY p.generic_name, buy_count DESC
  `).all();

  const groups = new Map();
  for (const row of data) {
    const key = row.generic_name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { genericName: row.generic_name, products: [], totalBuys: 0, categories: new Set() });
    }
    const g = groups.get(key);
    g.products.push(row);
    g.totalBuys += row.buy_count;
    if (row.category) g.categories.add(row.category);
  }

  return groups;
}

/**
 * Get existing preferences as a Set of lowercase generic_names.
 */
function getExistingPrefs(db) {
  return new Set(
    db.prepare("SELECT generic_name FROM brand_preferences WHERE context = 'default'").all()
      .map(r => r.generic_name.toLowerCase())
  );
}

/**
 * Format a product line for display.
 */
function formatProduct(p, index) {
  const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
  const special = p.on_special ? ' (SPECIAL)' : '';
  const stock = p.in_stock ? '' : ' [OUT OF STOCK]';
  return `  ${index}) ${p.product_name} — ${price} (${p.buy_count}x bought)${special}${stock}`;
}

/**
 * Handle a multi-product group interactively.
 */
async function handleMultiGroup(db, group, index, total) {
  const { genericName, products, totalBuys } = group;

  console.log(`\n[${index}/${total}] ${genericName} — ${totalBuys} purchases`);

  const displayCount = Math.min(products.length, MAX_DISPLAY);
  for (let i = 0; i < displayCount; i++) {
    console.log(formatProduct(products[i], i + 1));
  }
  if (products.length > MAX_DISPLAY) {
    console.log(`  ... and ${products.length - MAX_DISPLAY} more`);
  }

  console.log();
  console.log(`  [1-${displayCount}] Pick product  [l] Always cheapest  [d] Best deal/on special  [s] Skip`);

  while (true) {
    const answer = await prompt('  > ');
    const lower = answer.toLowerCase();

    if (lower === 's') {
      console.log(`  — skipped`);
      return;
    }

    if (lower === 'l' || lower === 'd') {
      // Dynamic strategy — store all candidate product IDs
      const strategy = lower === 'l' ? 'lowest_price' : 'on_special';
      const candidateIds = products.map(p => p.product_id);
      const strategyLabel = lower === 'l' ? 'Always cheapest' : 'Best deal/on special';

      // Use the top-purchased product as the "anchor" preferred_product_id
      setPreference(db, {
        genericName,
        productId: products[0].product_id,
        source: 'wizard',
        confidence: 0.9,
        strategy,
        notes: JSON.stringify({ candidates: candidateIds }),
      });

      console.log(`  → ${genericName} → ${strategyLabel} (${candidateIds.length} candidates)`);
      return;
    }

    const num = parseInt(answer, 10);
    if (num >= 1 && num <= displayCount) {
      const picked = products[num - 1];
      setPreference(db, {
        genericName,
        productId: picked.product_id,
        source: 'wizard',
        confidence: 0.9,
        strategy: 'fixed',
      });
      console.log(`  → ${genericName} → ${picked.product_name}`);
      return;
    }

    console.log(`  Invalid choice. Enter 1-${displayCount}, l, d, or s.`);
  }
}

/**
 * Handle single-product groups in batch.
 */
async function handleSingleGroups(db, singles) {
  if (singles.length === 0) return;

  console.log(`\n--- Single-product categories (auto-suggest) ---\n`);

  for (const g of singles) {
    const p = g.products[0];
    const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
    console.log(`  ${g.genericName} → ${p.product_name} ${price} (${p.buy_count}x)`);
  }

  console.log();
  console.log(`  [a] Apply all  [r] Review individually  [s] Skip all`);

  while (true) {
    const answer = (await prompt('  > ')).toLowerCase();

    if (answer === 's') {
      console.log('  — skipped all');
      return;
    }

    if (answer === 'a') {
      for (const g of singles) {
        const p = g.products[0];
        setPreference(db, {
          genericName: g.genericName,
          productId: p.product_id,
          source: 'wizard',
          confidence: 0.85,
          strategy: 'fixed',
        });
      }
      console.log(`  → Applied ${singles.length} preference(s)`);
      return;
    }

    if (answer === 'r') {
      for (let i = 0; i < singles.length; i++) {
        const g = singles[i];
        const p = g.products[0];
        const price = p.price != null ? `$${p.price.toFixed(2)}` : 'N/A';
        console.log(`\n  [${i + 1}/${singles.length}] ${g.genericName} → ${p.product_name} ${price} (${p.buy_count}x)`);
        console.log(`  [y] Accept  [s] Skip`);

        while (true) {
          const a = (await prompt('  > ')).toLowerCase();
          if (a === 'y') {
            setPreference(db, {
              genericName: g.genericName,
              productId: p.product_id,
              source: 'wizard',
              confidence: 0.85,
              strategy: 'fixed',
            });
            console.log(`  → ${g.genericName} → ${p.product_name}`);
            break;
          }
          if (a === 's') {
            console.log(`  — skipped`);
            break;
          }
          console.log('  Enter y or s.');
        }
      }
      return;
    }

    console.log('  Enter a, r, or s.');
  }
}

async function main() {
  const showAll = process.argv.includes('--all');

  const db = getDb();
  ensureStrategyColumn(db);

  const groups = getPurchaseGroups(db);
  const existingPrefs = getExistingPrefs(db);

  // Separate into multi-product and single-product groups
  const multiGroups = [];
  const singleGroups = [];

  for (const [key, group] of groups) {
    // Skip existing preferences unless --all
    if (!showAll && existingPrefs.has(key)) continue;

    // Skip compound categories and very long names (same filters as learn-from-history)
    if (group.genericName.includes('&') || group.genericName.includes(',')) continue;
    if (group.genericName.split(/\s+/).length > 3) continue;

    // Skip Fruit & Vegetables — generic_names are too broad (e.g. "onions" includes
    // spring onions, shallots, leeks). These are different items, not brand alternatives.
    // Branded produce the user cares about (e.g. frozen berries) falls under other categories.
    if (group.categories.has('Fruit & Vegetables') && group.categories.size === 1) continue;

    // Skip broad meat categories — "free range chicken" groups butterflied, tenders,
    // shredded together. Keep only cut-specific groups like "chicken breast", "pork sausages".
    if (group.categories.has('Meat, Poultry & Seafood') && isBroadMeatGroup(group.genericName)) continue;

    // Need at least 2 total purchases to be worth considering
    if (group.totalBuys < 2) continue;

    if (group.products.length > 1) {
      multiGroups.push(group);
    } else {
      singleGroups.push(group);
    }
  }

  // Sort by total buys descending
  multiGroups.sort((a, b) => b.totalBuys - a.totalBuys);
  singleGroups.sort((a, b) => b.totalBuys - a.totalBuys);

  console.log('Preference Wizard');
  console.log('=================\n');
  console.log(`Existing preferences: ${existingPrefs.size}`);
  console.log(`Categories with multiple products: ${multiGroups.length}`);
  console.log(`Single-product categories to add: ${singleGroups.length}`);

  if (multiGroups.length === 0 && singleGroups.length === 0) {
    console.log('\nNothing to do! All purchase groups already have preferences.');
    closeDb();
    return;
  }

  // Handle multi-product groups interactively
  if (multiGroups.length > 0) {
    console.log(`\n--- Categories with multiple products ---`);

    for (let i = 0; i < multiGroups.length; i++) {
      await handleMultiGroup(db, multiGroups[i], i + 1, multiGroups.length);
    }
  }

  // Handle single-product groups in batch
  await handleSingleGroups(db, singleGroups);

  // Summary
  const finalPrefs = getExistingPrefs(db);
  console.log(`\n=================`);
  console.log(`Done! Total preferences: ${finalPrefs.size}`);
  console.log(`=================\n`);

  closeDb();
}

main().catch(err => {
  console.error('Wizard failed:', err.message);
  closeDb();
  process.exit(1);
});
