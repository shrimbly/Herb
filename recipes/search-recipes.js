import { getDb, closeDb } from '../lib/db.js';

export function searchRecipes(db, { query, tag, ingredient, limit = 20 } = {}) {
  if (query) {
    const escaped = query.replace(/['"*()]/g, '').trim();
    if (!escaped) return [];

    const terms = escaped.split(/\s+/).map(t => `"${t}"*`).join(' ');

    try {
      return db.prepare(`
        SELECT r.*, rank
        FROM recipes_fts fts
        JOIN recipes r ON r.id = fts.rowid
        WHERE recipes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(terms, limit);
    } catch {
      try {
        return db.prepare(`
          SELECT r.*, rank
          FROM recipes_fts fts
          JOIN recipes r ON r.id = fts.rowid
          WHERE recipes_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(`"${escaped}"`, limit);
      } catch {
        return [];
      }
    }
  }

  if (tag) {
    return db.prepare(`
      SELECT * FROM recipes
      WHERE tags LIKE ?
      LIMIT ?
    `).all(`%"${tag}"%`, limit);
  }

  if (ingredient) {
    return db.prepare(`
      SELECT DISTINCT r.*
      FROM recipes r
      JOIN recipe_ingredients ri ON ri.recipe_id = r.id
      WHERE ri.generic_name LIKE ?
      LIMIT ?
    `).all(`%${ingredient}%`, limit);
  }

  return db.prepare('SELECT * FROM recipes ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getRecipe(db, recipeId) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  if (!recipe) return null;

  recipe.ingredients = db.prepare(
    'SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order'
  ).all(recipeId);

  return recipe;
}

// CLI
if (process.argv[1]?.includes('search-recipes')) {
  const query = process.argv.slice(2).join(' ').trim();
  const db = getDb();

  const results = query
    ? searchRecipes(db, { query })
    : searchRecipes(db, {});

  if (results.length === 0) {
    console.log(query ? `No recipes found for "${query}".` : 'No recipes found.');
  } else {
    console.log(`${results.length} recipe(s) found${query ? ` for "${query}"` : ''}:\n`);
    for (const r of results) {
      const tags = JSON.parse(r.tags || '[]');
      const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
      const rating = r.rating ? ` ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}` : '';
      console.log(`  #${r.id} ${r.name}${tagStr}${rating}`);
      if (r.source_author) console.log(`     by ${r.source_author}`);
    }
  }

  closeDb();
}
