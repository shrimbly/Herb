import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';

const referencePath = join(config.root, 'references', 'generic-names.json');
const references = JSON.parse(readFileSync(referencePath, 'utf-8'));

const { subcategory_overrides, pattern_matches, multi_word_brands } = references;

// Sort multi-word brands by length (longest first) for greedy matching
const sortedBrands = [...multi_word_brands].sort((a, b) => b.length - a.length);

function extractBrand(productName) {
  const nameLower = productName.toLowerCase();

  // Check multi-word brands first
  for (const brand of sortedBrands) {
    if (nameLower.startsWith(brand.toLowerCase())) {
      // Return with original casing from the product name
      return productName.slice(0, brand.length).trim();
    }
  }

  // Fallback: first word as brand (common pattern)
  const firstWord = productName.split(/\s+/)[0];
  // Skip if it looks like a generic word rather than a brand
  const genericStarters = ['the', 'a', 'an', 'fresh', 'organic', 'free', 'nz', 'new'];
  if (genericStarters.includes(firstWord.toLowerCase())) {
    // Try second word
    const words = productName.split(/\s+/);
    return words.length > 1 ? words[1] : firstWord;
  }

  return firstWord;
}

function resolveGenericName(productName, subcategory) {
  const nameLower = productName.toLowerCase();
  const subLower = (subcategory || '').toLowerCase();

  // Tier 1: subcategory overrides
  if (subcategory_overrides[subLower]) {
    return subcategory_overrides[subLower];
  }

  // Tier 2: pattern matches on product name
  for (const { pattern, generic } of pattern_matches) {
    if (nameLower.includes(pattern.toLowerCase())) {
      return generic;
    }
  }

  // Tier 3: fallback to lowercased subcategory
  return subLower || null;
}

export async function normaliseProducts() {
  const db = getDb();

  const products = db.prepare('SELECT id, name, subcategory FROM products WHERE brand IS NULL OR generic_name IS NULL').all();
  console.log(`Normalising ${products.length} products...`);

  let brandCount = 0;
  let genericCount = 0;

  const updateStmt = db.prepare(`
    UPDATE products SET brand = @brand, generic_name = @generic_name, updated_at = datetime('now')
    WHERE id = @id
  `);

  // Batch in transactions of 500
  const batchSize = 500;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    db.transaction(() => {
      for (const prod of batch) {
        const brand = extractBrand(prod.name);
        const genericName = resolveGenericName(prod.name, prod.subcategory);

        updateStmt.run({
          id: prod.id,
          brand: brand || null,
          generic_name: genericName || null,
        });

        if (brand) brandCount++;
        if (genericName) genericCount++;
      }
    })();
  }

  const total = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const withBrand = db.prepare('SELECT COUNT(*) as count FROM products WHERE brand IS NOT NULL').get().count;
  const withGeneric = db.prepare('SELECT COUNT(*) as count FROM products WHERE generic_name IS NOT NULL').get().count;

  console.log(`Normalisation complete.`);
  console.log(`  Brands: ${withBrand}/${total} (${((withBrand / total) * 100).toFixed(1)}%)`);
  console.log(`  Generic names: ${withGeneric}/${total} (${((withGeneric / total) * 100).toFixed(1)}%)`);

  closeDb();
}

// Run standalone
const isMain = process.argv[1] && (
  process.argv[1].includes('normalise-products') ||
  process.argv[1].endsWith('normalise-products.js')
);
if (isMain) {
  normaliseProducts().catch(err => {
    console.error('Normalisation failed:', err);
    process.exit(1);
  });
}
