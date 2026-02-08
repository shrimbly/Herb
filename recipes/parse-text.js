import { parseWithAI } from '../lib/ai.js';
import { addRecipe } from './add-recipe.js';
import { getDb, closeDb } from '../lib/db.js';

const SYSTEM_PROMPT = `You are a recipe parser. Given raw text (pasted, forwarded, or copied from any source), extract a structured recipe.

Return a JSON object with these fields:
{
  "name": "Recipe name",
  "servings": number or null,
  "prepTime": minutes as number or null,
  "cookTime": minutes as number or null,
  "tags": ["tag1", "tag2"],
  "instructions": "Step-by-step instructions as a single string",
  "sourceAuthor": "Author name if mentioned, or null",
  "ingredients": [
    {
      "genericName": "ingredient name (generic, e.g. 'coconut milk' not 'Kara Coconut Milk')",
      "quantity": "amount with unit (e.g. '400ml', '2 cups', '1 tbsp')",
      "preparation": "prep notes (e.g. 'diced', 'minced') or null",
      "optional": false
    }
  ]
}

Rules:
- genericName should be the common grocery item name, lowercase
- Separate quantity from preparation (e.g. "2 cloves garlic, minced" → quantity: "2 cloves", genericName: "garlic", preparation: "minced")
- Tags should be cuisine type, dietary info, meal type (e.g. "thai", "vegetarian", "dinner")
- If the text is unclear or not a recipe, return {"error": "Could not parse recipe from this text"}`;

export async function parseText(text) {
  return parseWithAI(SYSTEM_PROMPT, text);
}

// CLI
if (process.argv[1]?.includes('parse-text')) {
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', async () => {
    const input = chunks.join('');
    if (!input.trim()) {
      console.log('Usage: echo "recipe text..." | node recipes/parse-text.js [--save]');
      process.exit(1);
    }

    try {
      const recipe = await parseText(input);

      if (recipe.error) {
        console.error('Parse error:', recipe.error);
        process.exit(1);
      }

      console.log('Parsed recipe:');
      console.log(`  Name: ${recipe.name}`);
      console.log(`  Servings: ${recipe.servings || '-'}`);
      console.log(`  Prep: ${recipe.prepTime ? recipe.prepTime + ' min' : '-'}`);
      console.log(`  Cook: ${recipe.cookTime ? recipe.cookTime + ' min' : '-'}`);
      console.log(`  Tags: ${recipe.tags?.join(', ') || '-'}`);
      console.log(`  Ingredients (${recipe.ingredients?.length || 0}):`);
      for (const ing of recipe.ingredients || []) {
        const prep = ing.preparation ? `, ${ing.preparation}` : '';
        const opt = ing.optional ? ' (optional)' : '';
        console.log(`    - ${ing.quantity || '?'} ${ing.genericName}${prep}${opt}`);
      }

      if (process.argv.includes('--save')) {
        const db = getDb();
        const id = addRecipe(db, { ...recipe, sourceType: 'text', addedBy: 'parse-text' });
        console.log(`\nSaved as recipe #${id}`);
        closeDb();
      } else {
        console.log('\nUse --save to save this recipe.');
      }
    } catch (err) {
      console.error('Failed to parse:', err.message);
      process.exit(1);
    }
  });
}
