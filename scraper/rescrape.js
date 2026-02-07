import { getDb, closeDb } from '../lib/db.js';
import { backupDatabase } from '../db/backup.js';
import { scrapeCategories } from './scrape-categories.js';
import { scrapeProducts } from './scrape-products.js';
import { normaliseProducts } from './normalise-products.js';
import { embedProducts } from './embed-products.js';

async function rescrape() {
  console.log('=== Rescrape Pipeline ===\n');

  // Step 1: Backup
  console.log('--- Step 1: Database backup ---');
  backupDatabase();

  // Mark all products as potentially out-of-stock before scraping
  // Products seen during scrape will be marked back as in_stock
  const db = getDb();
  const markOutOfStock = db.prepare('UPDATE products SET in_stock = 0');
  const result = markOutOfStock.run();
  console.log(`Marked ${result.changes} products as potentially out-of-stock.\n`);
  closeDb();

  // Step 2: Scrape categories
  console.log('--- Step 2: Scrape categories ---');
  await scrapeCategories();
  console.log('');

  // Step 3: Scrape products
  console.log('--- Step 3: Scrape products ---');
  await scrapeProducts();
  console.log('');

  // Step 4: Normalise
  console.log('--- Step 4: Normalise products ---');
  await normaliseProducts();
  console.log('');

  // Step 5: Generate embeddings
  console.log('--- Step 5: Generate embeddings ---');
  await embedProducts();

  console.log('\n=== Rescrape complete ===');
}

rescrape().catch(err => {
  console.error('Rescrape pipeline failed:', err);
  process.exit(1);
});
