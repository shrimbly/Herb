import { parseWithAI } from '../lib/ai.js';
import { addRecipe } from './add-recipe.js';
import { getDb, closeDb } from '../lib/db.js';

const SYSTEM_PROMPT = `You are a recipe parser. Given content extracted from an Instagram post or reel, extract a structured recipe.

Return a JSON object with these fields:
{
  "name": "Recipe name",
  "servings": number or null,
  "prepTime": minutes as number or null,
  "cookTime": minutes as number or null,
  "tags": ["tag1", "tag2"],
  "instructions": "Step-by-step instructions as a single string",
  "sourceAuthor": "Instagram account name if available, or null",
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
- Instagram captions may be informal — extract what you can
- If the content doesn't contain a recipe, return {"error": "No recipe found in this content"}`;

async function extractInstagramContent(url) {
  // Dynamic import — playwright is a devDependency
  let playwright;
  try {
    const { chromium } = await import('playwright');
    playwright = { chromium };
  } catch {
    try {
      const playwrightExtra = await import('playwright-extra');
      const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
      playwrightExtra.chromium.use(StealthPlugin());
      playwright = { chromium: playwrightExtra.chromium };
    } catch {
      throw new Error('Playwright not available. Install with: npm i -D playwright');
    }
  }

  const browser = await playwright.chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to extract content from meta tags and page
    const content = await page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
        return el?.content || '';
      };

      // Try JSON-LD
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);

      const description = getMeta('og:description') || getMeta('description');
      const title = getMeta('og:title') || document.title;
      const author = getMeta('og:title')?.split('on Instagram')?.[0]?.trim() || '';

      // Get visible text from article/main content
      const article = document.querySelector('article');
      const bodyText = article?.innerText || '';

      return {
        title,
        description,
        author,
        bodyText: bodyText.slice(0, 3000),
        jsonLd: jsonLd.length ? JSON.stringify(jsonLd) : '',
      };
    });

    return content;
  } finally {
    await browser.close();
  }
}

export async function parseInstagram(url) {
  let content;
  try {
    content = await extractInstagramContent(url);
  } catch (err) {
    return {
      error: `Could not load Instagram page: ${err.message}. Try taking a screenshot and using parse-screenshot.js instead.`,
    };
  }

  const textForAI = [
    content.title && `Title: ${content.title}`,
    content.author && `Author: ${content.author}`,
    content.description && `Description: ${content.description}`,
    content.bodyText && `Page content: ${content.bodyText}`,
    content.jsonLd && `Structured data: ${content.jsonLd}`,
  ].filter(Boolean).join('\n\n');

  if (!textForAI.trim()) {
    return { error: 'No content extracted from Instagram page. Try a screenshot instead.' };
  }

  const recipe = await parseWithAI(SYSTEM_PROMPT, textForAI);
  if (!recipe.error) {
    recipe.sourceUrl = url;
    recipe.sourceType = 'instagram';
    if (content.author && !recipe.sourceAuthor) {
      recipe.sourceAuthor = content.author;
    }
  }

  return recipe;
}

// CLI
if (process.argv[1]?.includes('parse-instagram')) {
  const url = process.argv[2];

  if (!url) {
    console.log('Usage: node recipes/parse-instagram.js <instagram-url> [--save]');
    process.exit(1);
  }

  try {
    const recipe = await parseInstagram(url);

    if (recipe.error) {
      console.error('Error:', recipe.error);
      process.exit(1);
    }

    console.log('Parsed recipe from Instagram:');
    console.log(`  Name: ${recipe.name}`);
    console.log(`  Author: ${recipe.sourceAuthor || '-'}`);
    console.log(`  Servings: ${recipe.servings || '-'}`);
    console.log(`  Tags: ${recipe.tags?.join(', ') || '-'}`);
    console.log(`  Ingredients (${recipe.ingredients?.length || 0}):`);
    for (const ing of recipe.ingredients || []) {
      const prep = ing.preparation ? `, ${ing.preparation}` : '';
      console.log(`    - ${ing.quantity || '?'} ${ing.genericName}${prep}`);
    }

    if (process.argv.includes('--save')) {
      const db = getDb();
      const id = addRecipe(db, { ...recipe, addedBy: 'parse-instagram' });
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
