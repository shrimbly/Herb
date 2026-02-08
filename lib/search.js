import OpenAI from 'openai';
import config from './config.js';

const openai = new OpenAI({ apiKey: config.openaiKey });

const DEFAULT_LIMIT = 20;

export async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: config.embedding.model,
    input: text,
    dimensions: config.embedding.dimensions,
  });
  return new Float32Array(response.data[0].embedding);
}

export function ftsSearch(db, query, limit = DEFAULT_LIMIT) {
  const escaped = query.replace(/['"*()]/g, '').trim();
  if (!escaped) return [];

  const terms = escaped.split(/\s+/).map(t => `"${t}"*`).join(' ');

  try {
    return db.prepare(`
      SELECT p.*, rank
      FROM products_fts fts
      JOIN products p ON p.id = fts.rowid
      WHERE products_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(terms, limit);
  } catch {
    try {
      return db.prepare(`
        SELECT p.*, rank
        FROM products_fts fts
        JOIN products p ON p.id = fts.rowid
        WHERE products_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(`"${escaped}"`, limit);
    } catch {
      return [];
    }
  }
}

export async function vectorSearch(db, query, limit = DEFAULT_LIMIT) {
  const queryEmbedding = await getEmbedding(query);
  const buffer = Buffer.from(queryEmbedding.buffer);

  return db.prepare(`
    SELECT p.*, v.distance
    FROM vec_products v
    JOIN products p ON p.id = v.product_id
    WHERE v.embedding MATCH ?
    AND k = ?
    ORDER BY v.distance
  `).all(buffer, limit);
}

export function mergeResults(ftsResults, vecResults) {
  const merged = new Map();

  for (const r of ftsResults) {
    merged.set(r.id, {
      ...r,
      matchType: 'FTS',
      ftsRank: r.rank,
      vecDistance: null,
    });
  }

  for (const r of vecResults) {
    if (merged.has(r.id)) {
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

  return [...merged.values()].sort((a, b) => {
    if (a.matchType === 'BOTH' && b.matchType !== 'BOTH') return -1;
    if (b.matchType === 'BOTH' && a.matchType !== 'BOTH') return 1;

    if (a.vecDistance != null && b.vecDistance != null) {
      return a.vecDistance - b.vecDistance;
    }

    if (a.ftsRank != null && b.ftsRank != null) {
      return a.ftsRank - b.ftsRank;
    }

    return 0;
  });
}

export async function hybridSearch(db, query, limit = DEFAULT_LIMIT) {
  const ftsResults = ftsSearch(db, query, limit);

  let vecResults = [];
  try {
    vecResults = await vectorSearch(db, query, limit);
  } catch {
    // Vector search unavailable — FTS only
  }

  return mergeResults(ftsResults, vecResults);
}
