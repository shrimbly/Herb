import { readFileSync } from 'fs';
import { extname } from 'path';
import { parseImageWithAI } from '../lib/ai.js';
import { addRecipe } from './add-recipe.js';
import { getDb, closeDb } from '../lib/db.js';

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const SYSTEM_PROMPT = `You are a recipe parser. Given a screenshot or photo of a recipe (from Instagram, a website, a cookbook, handwritten notes, etc.), extract a structured recipe.

Return a JSON object:
{
  "name": "Recipe name",
  "servings": number or null,
  "prepTime": minutes as number or null,
  "cookTime": minutes as number or null,
  "tags": ["tag1", "tag2"],
  "instructions": "Step-by-step instructions as a single string",
  "sourceAuthor": "Author if visible, or null",
  "ingredients": [
    {
      "genericName": "ingredient name (generic, lowercase)",
      "quantity": "amount with unit or null",
      "preparation": "prep notes or null",
      "optional": false
    }
  ]
}

Rules:
- genericName should be the common grocery item name, lowercase
- Extract as much as you can read from the image
- If the image doesn't contain a recipe, return {"error": "No recipe found in image"}`;

export async function parseScreenshot(imagePath) {
  const ext = extname(imagePath).toLowerCase();
  const mimeType = MIME_TYPES[ext];

  if (!mimeType) {
    throw new Error(`Unsupported image format: ${ext}. Use .jpg, .png, .gif, or .webp`);
  }

  const imageBuffer = readFileSync(imagePath);
  return parseImageWithAI(SYSTEM_PROMPT, imageBuffer, mimeType);
}

// CLI
if (process.argv[1]?.includes('parse-screenshot')) {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.log('Usage: node recipes/parse-screenshot.js <image-path> [--save]');
    process.exit(1);
  }

  try {
    const recipe = await parseScreenshot(imagePath);

    if (recipe.error) {
      console.error('Error:', recipe.error);
      process.exit(1);
    }

    console.log('Parsed recipe from screenshot:');
    console.log(`  Name: ${recipe.name}`);
    console.log(`  Servings: ${recipe.servings || '-'}`);
    console.log(`  Prep: ${recipe.prepTime ? recipe.prepTime + ' min' : '-'}`);
    console.log(`  Cook: ${recipe.cookTime ? recipe.cookTime + ' min' : '-'}`);
    console.log(`  Tags: ${recipe.tags?.join(', ') || '-'}`);
    console.log(`  Ingredients (${recipe.ingredients?.length || 0}):`);
    for (const ing of recipe.ingredients || []) {
      const prep = ing.preparation ? `, ${ing.preparation}` : '';
      console.log(`    - ${ing.quantity || '?'} ${ing.genericName}${prep}`);
    }

    if (process.argv.includes('--save')) {
      const db = getDb();
      const id = addRecipe(db, { ...recipe, sourceType: 'screenshot', addedBy: 'parse-screenshot' });
      console.log(`\nSaved as recipe #${id}`);
      closeDb();
    } else {
      console.log('\nUse --save to save this recipe.');
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}
