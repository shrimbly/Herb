import { getDb, closeDb } from '../lib/db.js';

export function addRecipe(db, recipe) {
  const {
    name,
    sourceType = null,
    sourceUrl = null,
    sourceAuthor = null,
    instructions = null,
    servings = null,
    prepTime = null,
    cookTime = null,
    rating = null,
    tags = [],
    notes = null,
    addedBy = null,
    ingredients = [],
  } = recipe;

  const result = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO recipes (name, source_type, source_url, source_author, instructions, servings, prep_time, cook_time, rating, tags, notes, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      sourceType,
      sourceUrl,
      sourceAuthor,
      typeof instructions === 'string' ? instructions : JSON.stringify(instructions),
      servings,
      prepTime,
      cookTime,
      rating,
      JSON.stringify(tags),
      notes,
      addedBy,
    );

    const recipeId = info.lastInsertRowid;

    const insertIng = db.prepare(`
      INSERT INTO recipe_ingredients (recipe_id, generic_name, quantity, preparation, optional, substitute, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      insertIng.run(
        recipeId,
        ing.genericName || ing.generic_name || ing.name,
        ing.quantity || null,
        ing.preparation || null,
        ing.optional ? 1 : 0,
        ing.substitute || null,
        ing.sortOrder ?? ing.sort_order ?? i,
      );
    }

    return recipeId;
  })();

  return result;
}

// CLI
if (process.argv[1]?.includes('add-recipe')) {
  // Read JSON from stdin for recipe data
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    const input = chunks.join('');
    if (!input.trim()) {
      console.log('Usage: echo \'{"name":"...","ingredients":[...]}\' | node recipes/add-recipe.js');
      console.log('Or pipe a JSON file: node recipes/add-recipe.js < recipe.json');
      process.exit(1);
    }

    const recipe = JSON.parse(input);
    const db = getDb();
    const id = addRecipe(db, recipe);
    console.log(`Recipe added: #${id} "${recipe.name}" with ${recipe.ingredients?.length || 0} ingredient(s).`);
    closeDb();
  });
}
