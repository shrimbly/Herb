import { getDb, closeDb } from '../lib/db.js';
import { getRecipe } from './search-recipes.js';
import { resolveIngredients } from '../lib/resolve.js';

/**
 * Resolve all recipe ingredients to catalog products.
 * Returns resolution results for review.
 */
export async function linkIngredients(db, recipeId) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) throw new Error(`Recipe #${recipeId} not found`);

  const ingredients = recipe.ingredients.map(ing => ({
    id: ing.id,
    genericName: ing.generic_name,
    quantity: ing.quantity,
  }));

  const resolutions = await resolveIngredients(db, ingredients, recipe.name);

  const results = [];
  for (const { ingredient, resolution } of resolutions) {
    results.push({
      ingredientId: ingredient.id,
      genericName: ingredient.genericName,
      resolved: resolution.resolved,
      productName: resolution.productName || null,
      productId: resolution.productId || null,
      confidence: resolution.confidence || 0,
      candidates: resolution.candidates?.slice(0, 3) || [],
    });
  }

  return { recipe: recipe.name, results };
}

// CLI
if (process.argv[1]?.includes('link-ingredients')) {
  const recipeId = Number(process.argv[2]);

  if (!recipeId) {
    console.log('Usage: node recipes/link-ingredients.js <recipe_id>');
    process.exit(1);
  }

  const db = getDb();

  try {
    const { recipe, results } = await linkIngredients(db, recipeId);
    console.log(`Linking ingredients for: ${recipe}\n`);

    for (const r of results) {
      if (r.resolved) {
        console.log(`  ✅ ${r.genericName} → ${r.productName} (${(r.confidence * 100).toFixed(0)}%)`);
      } else {
        console.log(`  ❓ ${r.genericName} — not resolved`);
        if (r.candidates.length) {
          for (const c of r.candidates) {
            const price = c.price != null ? `$${c.price.toFixed(2)}` : 'N/A';
            console.log(`     → ${c.name} (${c.brand || '-'}) ${price}`);
          }
        }
      }
    }

    const resolved = results.filter(r => r.resolved).length;
    console.log(`\n${resolved}/${results.length} ingredients resolved.`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    closeDb();
  }
}
