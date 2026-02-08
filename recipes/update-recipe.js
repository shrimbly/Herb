import { getDb, closeDb } from '../lib/db.js';

export function updateRecipe(db, recipeId, updates) {
  const allowed = ['name', 'source_type', 'source_url', 'source_author', 'instructions', 'servings', 'prep_time', 'cook_time', 'rating', 'tags', 'notes'];

  const sets = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (allowed.includes(dbKey)) {
      sets.push(`${dbKey} = ?`);
      values.push(dbKey === 'tags' && Array.isArray(value) ? JSON.stringify(value) : value);
    }
  }

  if (sets.length === 0) return null;

  sets.push("updated_at = datetime('now')");
  values.push(recipeId);

  return db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function addIngredient(db, recipeId, ingredient) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM recipe_ingredients WHERE recipe_id = ?').get(recipeId);
  const sortOrder = (maxOrder?.max ?? -1) + 1;

  return db.prepare(`
    INSERT INTO recipe_ingredients (recipe_id, generic_name, quantity, preparation, optional, substitute, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    recipeId,
    ingredient.genericName || ingredient.generic_name || ingredient.name,
    ingredient.quantity || null,
    ingredient.preparation || null,
    ingredient.optional ? 1 : 0,
    ingredient.substitute || null,
    sortOrder,
  );
}

export function removeIngredient(db, ingredientId) {
  return db.prepare('DELETE FROM recipe_ingredients WHERE id = ?').run(ingredientId);
}

export function rateRecipe(db, recipeId, rating) {
  if (rating < 1 || rating > 5) throw new Error('Rating must be 1-5');
  return db.prepare("UPDATE recipes SET rating = ?, updated_at = datetime('now') WHERE id = ?").run(rating, recipeId);
}

export function markCooked(db, recipeId) {
  return db.prepare(`
    UPDATE recipes SET
      last_cooked = datetime('now'),
      times_cooked = times_cooked + 1,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(recipeId);
}

// CLI
if (process.argv[1]?.includes('update-recipe')) {
  const args = process.argv.slice(2);
  const recipeId = Number(args[0]);

  if (!recipeId) {
    console.log('Usage: node recipes/update-recipe.js <recipe_id> [--rating N] [--name "..."] [--cooked] [--add-ingredient "name:qty"] [--remove-ingredient ID]');
    process.exit(1);
  }

  const db = getDb();
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);

  if (!recipe) {
    console.error(`Recipe #${recipeId} not found.`);
    closeDb();
    process.exit(1);
  }

  for (let i = 1; i < args.length; i++) {
    const flag = args[i];

    if (flag === '--rating' && args[i + 1]) {
      rateRecipe(db, recipeId, Number(args[++i]));
      console.log(`Rating set to ${args[i]}/5`);
    } else if (flag === '--name' && args[i + 1]) {
      updateRecipe(db, recipeId, { name: args[++i] });
      console.log(`Name updated to "${args[i]}"`);
    } else if (flag === '--cooked') {
      markCooked(db, recipeId);
      console.log('Marked as cooked.');
    } else if (flag === '--add-ingredient' && args[i + 1]) {
      const [name, qty] = args[++i].split(':');
      addIngredient(db, recipeId, { genericName: name.trim(), quantity: qty?.trim() });
      console.log(`Added ingredient: ${name.trim()}`);
    } else if (flag === '--remove-ingredient' && args[i + 1]) {
      removeIngredient(db, Number(args[++i]));
      console.log(`Removed ingredient #${args[i]}`);
    }
  }

  closeDb();
}
