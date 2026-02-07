import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry } from './browser.js';

const debugDir = join(config.root, 'data', 'debug');

export async function scrapeCategories() {
  const db = getDb();
  mkdirSync(debugDir, { recursive: true });

  const storeParam = config.store.id ? `?storeId=${config.store.id}` : '';

  // The entire category tree is in the global nav on every page.
  // We only need to load ONE page and extract all category links.
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    const url = `${config.store.baseUrl}/shop/category/fruit-and-vegetables${storeParam}`;
    console.log(`Loading page to extract global nav: ${url}`);

    const ok = await navigateWithRetry(page, url);
    if (!ok) {
      throw new Error('Failed to load page for category extraction.');
    }

    // Save debug HTML
    const html = await page.content();
    writeFileSync(join(debugDir, 'category-page.html'), html, 'utf-8');
    console.log('Saved debug HTML to data/debug/category-page.html');

    await page.waitForTimeout(2000);

    // Extract all category links from the global nav
    const allLinks = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="/shop/category/"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/shop\/category\/([^?#]+)/);
        if (!match) continue;
        const slug = match[1].replace(/\/$/, '');
        // Get clean name: strip "View all '" prefix and trailing quote
        let name = link.textContent?.trim() || '';
        name = name.replace(/^View all\s*'?\s*/i, '').replace(/'?\s*$/, '');
        if (!name || !slug) continue;
        results.push({ name, slug });
      }
      return results;
    });

    console.log(`Extracted ${allLinks.length} raw category links from nav.`);

    // Dedupe by slug
    const deduped = new Map();
    for (const link of allLinks) {
      if (!deduped.has(link.slug)) {
        deduped.set(link.slug, link);
      }
    }

    console.log(`${deduped.size} unique category slugs.`);

    // Build the tree: determine depth and parent from slug structure
    // e.g. "fruit-and-vegetables" = depth 0
    //      "fruit-and-vegetables/fruit" = depth 1
    //      "fruit-and-vegetables/fruit/apples--pears" = depth 2
    const upsertCategory = db.prepare(`
      INSERT INTO categories (name, slug, parent_id, nw_url, depth)
      VALUES (@name, @slug, @parent_id, @nw_url, @depth)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        parent_id = excluded.parent_id,
        nw_url = excluded.nw_url,
        depth = excluded.depth
    `);

    const findCategory = db.prepare('SELECT id FROM categories WHERE slug = ?');

    // Sort by slug length so parents are inserted before children
    const sorted = [...deduped.values()].sort((a, b) => {
      const aParts = a.slug.split('/').length;
      const bParts = b.slug.split('/').length;
      return aParts - bParts || a.slug.localeCompare(b.slug);
    });

    db.transaction(() => {
      for (const cat of sorted) {
        const parts = cat.slug.split('/');
        const depth = parts.length - 1;

        // Find parent slug (everything except last segment)
        let parentId = null;
        if (parts.length > 1) {
          const parentSlug = parts.slice(0, -1).join('/');
          const parent = findCategory.get(parentSlug);
          parentId = parent?.id || null;
        }

        upsertCategory.run({
          name: cat.name,
          slug: cat.slug,
          parent_id: parentId,
          nw_url: `${config.store.baseUrl}/shop/category/${cat.slug}${storeParam}`,
          depth,
        });
      }
    })();

  } finally {
    await browser.close();
  }

  // Report
  const total = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  const byDepth = db.prepare(
    'SELECT depth, COUNT(*) as count FROM categories GROUP BY depth ORDER BY depth'
  ).all();
  console.log(`\nCategory scrape complete: ${total.count} total categories`);
  for (const row of byDepth) {
    console.log(`  Depth ${row.depth}: ${row.count} categories`);
  }

  // Show a few examples
  const examples = db.prepare(
    'SELECT slug, name, depth FROM categories ORDER BY slug LIMIT 15'
  ).all();
  console.log('\nSample categories:');
  for (const e of examples) {
    console.log(`  ${'  '.repeat(e.depth)}${e.name} [${e.slug}]`);
  }

  closeDb();
}

// Run standalone
const isMain = process.argv[1] && (
  process.argv[1].includes('scrape-categories') ||
  process.argv[1].endsWith('scrape-categories.js')
);
if (isMain) {
  scrapeCategories().catch(err => {
    console.error('Category scrape failed:', err);
    process.exit(1);
  });
}
