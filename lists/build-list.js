import { getDb, closeDb } from '../lib/db.js';
import { getRecipe } from '../recipes/search-recipes.js';
import { searchRecipes } from '../recipes/search-recipes.js';
import { resolveIngredients } from '../lib/resolve.js';

/**
 * Build a shopping list from recipes and/or manual items.
 */
export async function buildList(db, { recipeIds = [], recipeNames = [], manualItems = [], requestedBy = null, name = null }) {
  // Resolve recipe names to IDs
  const allRecipeIds = [...recipeIds];
  for (const recipeName of recipeNames) {
    const matches = searchRecipes(db, { query: recipeName, limit: 1 });
    if (matches.length > 0) {
      allRecipeIds.push(matches[0].id);
    } else {
      console.warn(`Recipe not found: "${recipeName}"`);
    }
  }

  // Load all recipe ingredients
  const recipes = [];
  const ingredientMap = new Map(); // genericName → { quantity, sources }

  for (const id of allRecipeIds) {
    const recipe = getRecipe(db, id);
    if (!recipe) {
      console.warn(`Recipe #${id} not found.`);
      continue;
    }
    recipes.push(recipe);

    for (const ing of recipe.ingredients) {
      const key = ing.generic_name.toLowerCase();
      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key);
        existing.sources.push(recipe.name);
        // Aggregate quantity as text
        if (ing.quantity) {
          existing.quantities.push(ing.quantity);
        }
      } else {
        ingredientMap.set(key, {
          genericName: ing.generic_name,
          quantities: ing.quantity ? [ing.quantity] : [],
          sources: [recipe.name],
          optional: !!ing.optional,
        });
      }
    }
  }

  // Add manual items
  for (const item of manualItems) {
    const itemName = typeof item === 'string' ? item : item.name;
    const quantity = typeof item === 'string' ? null : item.quantity;
    const key = itemName.toLowerCase();

    if (ingredientMap.has(key)) {
      const existing = ingredientMap.get(key);
      existing.sources.push('manual');
      if (quantity) existing.quantities.push(quantity);
    } else {
      ingredientMap.set(key, {
        genericName: itemName,
        quantities: quantity ? [quantity] : [],
        sources: ['manual'],
        optional: false,
      });
    }
  }

  // Build ingredient list for resolution
  const ingredients = [...ingredientMap.values()].map(v => ({
    genericName: v.genericName,
    quantity: v.quantities.join(' + ') || null,
    sources: v.sources,
    optional: v.optional,
  }));

  // Resolve all ingredients to catalog products
  const recipeContext = recipes.map(r => r.name).join(', ');
  const resolutions = await resolveIngredients(db, ingredients, recipeContext);

  // Create shopping list in DB
  const listName = name || recipes.map(r => r.name).join(' + ') || 'Shopping List';
  const listInfo = db.prepare(`
    INSERT INTO shopping_lists (name, status, requested_by, recipe_ids, notes)
    VALUES (?, 'draft', ?, ?, ?)
  `).run(
    listName,
    requestedBy,
    JSON.stringify(allRecipeIds),
    recipes.length ? `Recipes: ${recipes.map(r => r.name).join(', ')}` : null,
  );

  const listId = listInfo.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO shopping_list_items (list_id, generic_name, resolved_product_id, display_name, quantity, category, source, estimated_price, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const items = [];
  let estimatedTotal = 0;
  let unresolvedCount = 0;

  for (let i = 0; i < resolutions.length; i++) {
    const { ingredient, resolution } = resolutions[i];
    const displayName = resolution.resolved
      ? resolution.productName
      : ingredient.genericName;
    const category = resolution.resolved && resolution.candidates?.[0]?.category
      ? resolution.candidates[0].category
      : null;
    const price = resolution.resolved ? resolution.price : null;

    if (price) estimatedTotal += price;
    if (!resolution.resolved) unresolvedCount++;

    insertItem.run(
      listId,
      ingredient.genericName,
      resolution.resolved ? resolution.productId : null,
      displayName,
      ingredient.quantity,
      category,
      ingredient.sources.join(', '),
      price,
      i,
    );

    items.push({
      genericName: ingredient.genericName,
      displayName,
      quantity: ingredient.quantity,
      category,
      source: ingredient.sources.join(', '),
      estimatedPrice: price,
      resolved: resolution.resolved,
      candidates: resolution.candidates?.slice(0, 3),
    });
  }

  return {
    listId,
    name: listName,
    recipes: recipes.map(r => ({ id: r.id, name: r.name })),
    items,
    unresolvedCount,
    estimatedTotal,
  };
}

// CLI
if (process.argv[1]?.includes('build-list')) {
  const args = process.argv.slice(2);
  const recipeNames = [];
  const manualItems = [];
  let name = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--recipe' && args[i + 1]) {
      recipeNames.push(args[++i]);
    } else if (args[i] === '--item' && args[i + 1]) {
      manualItems.push(args[++i]);
    } else if (args[i] === '--name' && args[i + 1]) {
      name = args[++i];
    } else {
      recipeNames.push(args[i]);
    }
  }

  if (recipeNames.length === 0 && manualItems.length === 0) {
    console.log('Usage: node lists/build-list.js --recipe "Recipe Name" [--item "extra item"] [--name "List Name"]');
    process.exit(1);
  }

  const db = getDb();

  try {
    const { formatList } = await import('./format-list.js');
    const list = await buildList(db, { recipeNames, manualItems, name });
    console.log(formatList(list));
  } catch (err) {
    console.error('Failed to build list:', err.message);
    process.exit(1);
  } finally {
    closeDb();
  }
}
