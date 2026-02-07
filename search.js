import OpenAI from 'openai';
import { getDb, closeDb } from './lib/db.js';
import config from './lib/config.js';

const openai = new OpenAI({ apiKey: config.openaiKey });

const MAX_RESULTS = 20;

function ftsSearch(db, query) {
  // Escape special FTS characters and build query
  const escaped = query.replace(/['"*()]/g, '').trim();
  if (!escaped) return [];

  // Use prefix matching for better partial matches
  const terms = escaped.split(/\s+/).map(t => `"${t}"*`).join(' ');

  try {
    return db.prepare(`
      SELECT p.*, rank
      FROM products_fts fts
      JOIN products p ON p.id = fts.rowid
      WHERE products_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(terms, MAX_RESULTS);
  } catch {
    // FTS query syntax error — try simpler query
    try {
      return db.prepare(`
        SELECT p.*, rank
        FROM products_fts fts
        JOIN products p ON p.id = fts.rowid
        WHERE products_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(`"${escaped}"`, MAX_RESULTS);
    } catch {
      return [];
    }
  }
}

async function vectorSearch(db, query) {
  // Generate embedding for query
  const response = await openai.embeddings.create({
    model: config.embedding.model,
    input: query,
    dimensions: config.embedding.dimensions,
  });

  const queryEmbedding = new Float32Array(response.data[0].embedding);
  const buffer = Buffer.from(queryEmbedding.buffer);

  const results = db.prepare(`
    SELECT p.*, v.distance
    FROM vec_products v
    JOIN products p ON p.id = v.product_id
    WHERE v.embedding MATCH ?
    AND k = ?
    ORDER BY v.distance
  `).all(buffer, MAX_RESULTS);

  return results;
}

function mergeResults(ftsResults, vecResults) {
  const merged = new Map();

  // Add FTS results
  for (const r of ftsResults) {
    merged.set(r.id, {
      ...r,
      matchType: 'FTS',
      ftsRank: r.rank,
      vecDistance: null,
    });
  }

  // Add/merge vector results
  for (const r of vecResults) {
    if (merged.has(r.id)) {
      // Found in both — boost it
      const existing = merged.get(r.id);
      existing.matchType = 'BOTH';
      existing.vecDistance = r.distance;
    } else {
      merged.set(r.id, {
        ...r,
        matchType: 'VEC',
        ftsRank: null,
        vecDistance: r.distance,
      });
    }
  }

  // Sort: BOTH first, then by vector distance (lower = better), then FTS rank
  return [...merged.values()].sort((a, b) => {
    // BOTH matches first
    if (a.matchType === 'BOTH' && b.matchType !== 'BOTH') return -1;
    if (b.matchType === 'BOTH' && a.matchType !== 'BOTH') return 1;

    // Then by vector distance if available
    if (a.vecDistance != null && b.vecDistance != null) {
      return a.vecDistance - b.vecDistance;
    }

    // Then by FTS rank
    if (a.ftsRank != null && b.ftsRank != null) {
      return a.ftsRank - b.ftsRank;
    }

    return 0;
  });
}

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

  // Run FTS and vector search
  const ftsResults = ftsSearch(db, query);
  console.log(`FTS results: ${ftsResults.length}`);

  let vecResults = [];
  try {
    vecResults = await vectorSearch(db, query);
    console.log(`Vector results: ${vecResults.length}`);
  } catch (err) {
    console.warn(`Vector search failed: ${err.message}`);
  }

  // Merge and rank
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
