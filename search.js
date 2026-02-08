import { getDb, closeDb } from './lib/db.js';
import { ftsSearch, vectorSearch, mergeResults } from './lib/search.js';

function formatResult(r, i) {
  const stock = r.in_stock ? 'In Stock' : 'Out of Stock';
  const special = r.on_special ? ` [SPECIAL${r.special_price ? ' $' + r.special_price.toFixed(2) : ''}]` : '';
  const price = r.price != null ? `$${r.price.toFixed(2)}` : 'N/A';
  const dist = r.vecDistance != null ? ` (dist: ${r.vecDistance.toFixed(4)})` : '';

  return [
    `${i + 1}. ${r.name}`,
    `   Brand: ${r.brand || '-'}  |  Price: ${price}${special}  |  ${stock}`,
    `   Category: ${r.category || '-'} > ${r.subcategory || '-'}`,
    `   Match: ${r.matchType}${dist}`,
  ].join('\n');
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim();

  if (!query) {
    console.log('Usage: node search.js <query>');
    console.log('Example: node search.js coconut milk');
    process.exit(1);
  }

  console.log(`Searching for: "${query}"\n`);

  const db = getDb();

  const ftsResults = ftsSearch(db, query);
  console.log(`FTS results: ${ftsResults.length}`);

  let vecResults = [];
  try {
    vecResults = await vectorSearch(db, query);
    console.log(`Vector results: ${vecResults.length}`);
  } catch (err) {
    console.warn(`Vector search failed: ${err.message}`);
  }

  const results = mergeResults(ftsResults, vecResults);
  console.log(`\n--- ${results.length} results ---\n`);

  if (results.length === 0) {
    console.log('No results found.');
  } else {
    for (let i = 0; i < results.length; i++) {
      console.log(formatResult(results[i], i));
      if (i < results.length - 1) console.log('');
    }
  }

  closeDb();
}

main().catch(err => {
  console.error('Search failed:', err);
  process.exit(1);
});
