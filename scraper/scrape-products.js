import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, randomDelay } from './browser.js';

const progressFile = join(config.root, 'data', 'scrape-progress.json');
const errorsFile = join(config.root, 'data', 'scrape-errors.json');
const debugDir = join(config.root, 'data', 'debug');

const UNIT_SIZE_RE = /(\d+(?:\.\d+)?)\s*(g|kg|ml|l|pk|ea)\b/i;

function loadProgress() {
  if (existsSync(progressFile)) {
    return JSON.parse(readFileSync(progressFile, 'utf-8'));
  }
  return { completedSlugs: [], scrapeId: Date.now() };
}

function saveProgress(progress) {
  writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

function logError(errors, entry) {
  errors.push(entry);
  writeFileSync(errorsFile, JSON.stringify(errors, null, 2), 'utf-8');
}

export async function scrapeProducts() {
  const db = getDb();
  mkdirSync(debugDir, { recursive: true });

  const progress = loadProgress();
  const errors = [];
  const scrapeTimestamp = new Date().toISOString();

  // Get leaf categories (deepest level in each branch)
  const categories = db.prepare(`
    SELECT c.id, c.slug, c.name, c.nw_url
    FROM categories c
    WHERE NOT EXISTS (
      SELECT 1 FROM categories child WHERE child.parent_id = c.id
    )
    ORDER BY c.slug
  `).all();

  console.log(`Found ${categories.length} leaf categories to scrape.`);

  // Skip already completed categories from this scrape run
  const remaining = categories.filter(c => !progress.completedSlugs.includes(c.slug));
  console.log(`Remaining: ${remaining.length} (${progress.completedSlugs.length} already done)`);

  const upsertProduct = db.prepare(`
    INSERT INTO products (
      store_id, nw_product_id, name, category, subcategory,
      price, unit_price, unit_size, image_url,
      in_stock, on_special, special_price,
      last_price, last_price_change, last_scraped, updated_at
    ) VALUES (
      @store_id, @nw_product_id, @name, @category, @subcategory,
      @price, @unit_price, @unit_size, @image_url,
      @in_stock, @on_special, @special_price,
      @last_price, @last_price_change, @last_scraped, datetime('now')
    )
    ON CONFLICT(nw_product_id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      subcategory = excluded.subcategory,
      price = excluded.price,
      unit_price = excluded.unit_price,
      unit_size = excluded.unit_size,
      image_url = excluded.image_url,
      in_stock = excluded.in_stock,
      on_special = excluded.on_special,
      special_price = excluded.special_price,
      last_price = products.price,
      last_price_change = CASE
        WHEN products.price != excluded.price THEN datetime('now')
        ELSE products.last_price_change
      END,
      last_scraped = excluded.last_scraped,
      updated_at = datetime('now')
  `);

  const updateCategoryCount = db.prepare(`
    UPDATE categories SET product_count = @count, last_scraped = @timestamp WHERE id = @id
  `);

  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  let debugSaved = false;
  let totalProducts = 0;

  try {
    for (const cat of remaining) {
      console.log(`\n[${cat.slug}] Scraping: ${cat.name}`);
      let categoryProductCount = 0;
      let pageNum = 1;

      while (true) {
        const url = `${config.store.baseUrl}/shop/category/${cat.slug}?pg=${pageNum}${config.store.id ? '&storeId=' + config.store.id : ''}`;
        console.log(`  Page ${pageNum}: ${url}`);

        const ok = await navigateWithRetry(page, url);
        if (!ok) {
          logError(errors, { category: cat.slug, page: pageNum, error: 'Navigation failed' });
          break;
        }

        // Wait for product cards to load
        await page.waitForTimeout(3000);

        // Save first product page HTML for debugging
        if (!debugSaved) {
          const html = await page.content();
          writeFileSync(join(debugDir, 'product-page.html'), html, 'utf-8');
          debugSaved = true;
          console.log('  Saved debug HTML to data/debug/product-page.html');
        }

        // Extract products using the real NW data-testid selectors
        const products = await page.evaluate(() => {
          const results = [];

          // Product cards have data-testid="product-{id}-{variant}"
          // e.g. data-testid="product-5012074-EA-000"
          const cards = document.querySelectorAll('[data-testid^="product-"][data-testid$="-000"], [data-testid^="product-"][data-testid*="-EA-"], [data-testid^="product-"][data-testid*="-KG-"]');

          // Filter to actual product cards (exclude product-search-bar, product-title etc.)
          const productCards = [...cards].filter(el => {
            const tid = el.getAttribute('data-testid') || '';
            return /^product-\d/.test(tid);
          });

          for (const card of productCards) {
            try {
              const testId = card.getAttribute('data-testid') || '';
              // Extract product ID: "product-5012074-EA-000" -> "5012074_ea_000"
              const idMatch = testId.match(/^product-(\d+)-(\w+)-(\w+)$/);
              const productId = idMatch
                ? `${idMatch[1]}_${idMatch[2].toLowerCase()}_${idMatch[3].toLowerCase()}nw`
                : '';

              // Title
              const titleEl = card.querySelector('[data-testid="product-title"]');
              const name = titleEl?.textContent?.trim();
              if (!name) continue;

              // Subtitle (often contains size info)
              const subtitleEl = card.querySelector('[data-testid="product-subtitle"]');
              const subtitle = subtitleEl?.textContent?.trim() || '';

              // Price: dollars + cents
              const dollarsEl = card.querySelector('[data-testid="price-dollars"]');
              const centsEl = card.querySelector('[data-testid="price-cents"]');
              const perEl = card.querySelector('[data-testid="price-per"]');
              const dollars = dollarsEl?.textContent?.trim() || '0';
              const cents = centsEl?.textContent?.trim() || '00';
              const price = parseFloat(`${dollars}.${cents}`);
              const pricePer = perEl?.textContent?.trim() || '';

              // Unit price (cup price)
              const unitPriceEl = card.querySelector('[data-testid="non-promo-unit-price"]');
              const unitPrice = unitPriceEl?.textContent?.trim() || '';

              // Image
              const imgEl = card.querySelector('[data-testid="product-image"]');
              const imageUrl = imgEl?.getAttribute('src') || '';

              // Special / promo detection
              // If there's a promo price element, the item is on special
              const promoContainer = card.querySelector('[data-testid="price"]');
              const isSpecial = promoContainer?.classList?.toString()?.includes('promo') ||
                !!card.querySelector('[class*="promo"], [class*="save"], [class*="special"]');

              results.push({
                productId,
                name,
                subtitle,
                price: isNaN(price) ? null : price,
                pricePer,
                unitPrice,
                imageUrl,
                isSpecial,
              });
            } catch {
              // Skip malformed cards
            }
          }

          return results;
        });

        console.log(`  Found ${products.length} products on page ${pageNum}`);

        if (products.length === 0) break;

        // Derive category and subcategory from the DB-stored category tree
        const slugParts = cat.slug.split('/');
        const topSlug = slugParts[0];
        const topCat = db.prepare('SELECT name FROM categories WHERE slug = ?').get(topSlug);
        const category = topCat?.name || topSlug.replace(/-/g, ' ');
        const subcategory = cat.name;

        // Upsert products in a transaction
        db.transaction(() => {
          for (const prod of products) {
            // Parse unit_size from subtitle or product name
            const sizeSource = prod.subtitle || prod.name;
            const unitMatch = sizeSource.match(UNIT_SIZE_RE);
            const unitSize = unitMatch ? `${unitMatch[1]}${unitMatch[2].toLowerCase()}` : null;

            const nwProductId = prod.productId || `gen-${cat.slug}-${prod.name}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

            upsertProduct.run({
              store_id: config.store.id || '',
              nw_product_id: nwProductId,
              name: prod.name,
              category,
              subcategory,
              price: prod.price,
              unit_price: prod.unitPrice || null,
              unit_size: unitSize,
              image_url: prod.imageUrl || null,
              in_stock: 1,
              on_special: prod.isSpecial ? 1 : 0,
              special_price: null,
              last_price: null,
              last_price_change: null,
              last_scraped: scrapeTimestamp,
            });
          }
        })();

        categoryProductCount += products.length;
        totalProducts += products.length;

        // Check for pagination: does a next page link exist?
        const hasNextPage = await page.evaluate((currentPage) => {
          const pageLinks = document.querySelectorAll('[data-testid="pagination-number"]');
          for (const link of pageLinks) {
            const num = parseInt(link.textContent?.trim(), 10);
            if (num > currentPage) return true;
          }
          return false;
        }, pageNum);

        if (!hasNextPage) break;

        pageNum++;
        await randomDelay();
      }

      // Update category product count
      updateCategoryCount.run({
        count: categoryProductCount,
        timestamp: scrapeTimestamp,
        id: cat.id,
      });

      // Save progress
      progress.completedSlugs.push(cat.slug);
      saveProgress(progress);
      console.log(`  Category total: ${categoryProductCount} products`);

      await randomDelay();
    }
  } finally {
    await browser.close();
  }

  // Report
  const totalInDb = db.prepare('SELECT COUNT(*) as count FROM products').get();
  console.log(`\nProduct scrape complete.`);
  console.log(`  This run: ${totalProducts} products scraped`);
  console.log(`  Total in DB: ${totalInDb.count} products`);

  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length} (see data/scrape-errors.json)`);
  }

  // Clean up progress file on successful complete run
  if (remaining.length === categories.length) {
    writeFileSync(progressFile, JSON.stringify({ completedSlugs: [], scrapeId: Date.now() }, null, 2));
  }

  closeDb();
}

// Run standalone
const isMain = process.argv[1] && (
  process.argv[1].includes('scrape-products') ||
  process.argv[1].endsWith('scrape-products.js')
);
if (isMain) {
  scrapeProducts().catch(err => {
    console.error('Product scrape failed:', err);
    process.exit(1);
  });
}
