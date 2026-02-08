import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, randomDelay, sleep } from '../scraper/browser.js';
import { matchPurchaseItems } from './match-items.js';
import { updateFrequency } from './update-frequency.js';
import { suggestPreferences } from '../preferences/learn-from-history.js';
import { setPreference } from '../preferences/set-preference.js';

const debugDir = join(config.root, 'data', 'debug');
const BASE_URL = config.store.baseUrl;

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Navigate to NW login page and wait for the user to log in manually.
 * Returns once the user is authenticated (detected by nav/account elements).
 */
async function waitForLogin(page) {
  // Navigate directly to the orders page — NW will redirect to login if needed
  const ordersUrl = `${BASE_URL}/shop/my-account/myorders`;
  console.log(`\nNavigating to orders page: ${ordersUrl}`);
  await navigateWithRetry(page, ordersUrl);
  await sleep(2000);

  // Check if we landed on orders (already logged in) or got redirected to login
  const onOrdersPage = await page.evaluate(() => {
    return window.location.href.includes('/my-account/myorders');
  });

  if (onOrdersPage) {
    console.log('Already logged in!');
    return;
  }

  console.log('\n========================================');
  console.log('  Please log in to your New World');
  console.log('  account in the browser window.');
  console.log('========================================\n');

  await prompt('Press ENTER once you have logged in...');

  // Give the page a moment to settle after login
  await sleep(2000);

  // Navigate to orders page to verify login worked
  await navigateWithRetry(page, ordersUrl);
  await sleep(3000);

  const loggedIn = await page.evaluate(() => {
    return window.location.href.includes('/my-account/myorders');
  });

  if (!loggedIn) {
    throw new Error('Login verification failed — could not reach orders page. Please try again.');
  }

  console.log('Login verified successfully.\n');
}

/**
 * Scrape the list of past orders from the order history page.
 *
 * DOM structure (from actual HTML):
 *   div[role="list"]
 *     div[role="listitem"] — header row (labels "Orders" / "Est. total")
 *     div[role="listitem"] — order row: favourite btn, method+date, status, price, View btn
 *     ...
 *
 * "View" is a <button>, not a link — navigation is JS-driven.
 * We extract metadata from each row, then click View + capture the URL.
 *
 * Returns an array of { date, reference, url, total, method }.
 */
async function scrapeOrderList(page) {
  const ordersUrl = `${BASE_URL}/shop/my-account/myorders`;

  // If waitForLogin already landed us here, skip re-navigating
  const currentUrl = page.url();
  if (!currentUrl.includes('/my-account/myorders')) {
    console.log(`Navigating to order history: ${ordersUrl}`);
    await navigateWithRetry(page, ordersUrl);
    await sleep(3000);
  }

  // Save debug HTML
  mkdirSync(debugDir, { recursive: true });
  const html = await page.content();
  writeFileSync(join(debugDir, 'order-history.html'), html, 'utf-8');
  console.log('Saved order history HTML to data/debug/order-history.html');

  // Extract order metadata from list items
  const orderCount = await page.evaluate(() => {
    const list = document.querySelector('[role="list"]');
    if (!list) return 0;
    const items = list.querySelectorAll('[role="listitem"]');
    // First listitem is the header row ("Orders" / "Est. total" labels)
    return Math.max(0, items.length - 1);
  });

  console.log(`Found ${orderCount} order row(s) in DOM.`);
  if (orderCount === 0) return [];

  const orders = [];

  // Process each order: extract metadata, click View, capture URL, go back
  for (let i = 0; i < orderCount; i++) {
    // Extract metadata for order at index i (skip header at index 0)
    const meta = await page.evaluate((idx) => {
      const list = document.querySelector('[role="list"]');
      const items = list.querySelectorAll('[role="listitem"]');
      const row = items[idx + 1]; // +1 to skip header
      if (!row) return null;

      const text = row.textContent || '';

      // Date: "Tue, 3 Feb 2026"
      const dateMatch = text.match(/\w{3},\s*(\d{1,2}\s+\w{3}\s+\d{4})/);
      const date = dateMatch ? dateMatch[1] : null;

      // Total: "$292.55"
      const totalMatch = text.match(/\$([\d,.]+)/);
      const total = totalMatch ? parseFloat(totalMatch[1].replace(',', '')) : null;

      // Method: "Delivery", "In store", "Collect"
      const methodMatch = text.match(/(Delivery|In store|Collect)/i);
      const method = methodMatch ? methodMatch[1] : null;

      return { date, total, method };
    }, i);

    if (!meta) continue;

    console.log(`  [${i + 1}/${orderCount}] ${meta.method || '?'} — ${meta.date || '?'} — $${meta.total?.toFixed(2) || '?'}`);

    // Click the View button for this order and capture the URL
    const orderUrl = await clickViewAndCaptureUrl(page, i);

    if (!orderUrl) {
      console.log(`    Could not get order URL — skipping`);
      continue;
    }

    // Extract orderId from URL — numeric for delivery/collect, encoded string for in-store
    const parsedUrl = new URL(orderUrl);
    const reference = parsedUrl.searchParams.get('orderId') || null;

    orders.push({
      date: meta.date,
      reference,
      url: orderUrl,
      total: meta.total,
      method: meta.method,
    });

    console.log(`    URL: ${orderUrl} (ref: ${reference || '?'})`);
  }

  console.log(`\nCollected ${orders.length} order URL(s).`);
  return orders;
}

/**
 * Click the "View" button for order at given index and capture the navigated URL.
 * Returns the order detail URL, or null on failure.
 */
async function clickViewAndCaptureUrl(page, orderIndex) {
  try {
    // Find the View button inside the listitem at orderIndex+1 (skip header)
    const viewBtn = await page.evaluateHandle((idx) => {
      const list = document.querySelector('[role="list"]');
      const items = list.querySelectorAll('[role="listitem"]');
      const row = items[idx + 1];
      if (!row) return null;

      // Find button whose text starts with "View"
      const buttons = row.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim().startsWith('View')) return btn;
      }
      return null;
    }, orderIndex);

    if (!viewBtn) return null;

    // Click and wait for navigation
    await Promise.all([
      page.waitForURL(/orderId|order/i, { timeout: 15000 }),
      viewBtn.click(),
    ]);

    await sleep(1000);
    const url = page.url();

    // Navigate back to order list
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await sleep(2000);

    return url;
  } catch (err) {
    console.log(`    View click failed: ${err.message}`);
    // Try to get back to order list
    try {
      await navigateWithRetry(page, `${BASE_URL}/shop/my-account/myorders`);
      await sleep(2000);
    } catch { /* ignore */ }
    return null;
  }
}

/**
 * Scrape items from a single order detail page.
 *
 * Page layout (from screenshot):
 *   Products grouped by category (bold heading like "Baking Supplies & Sugar")
 *   Each group has column headers: Product | Quantity | Purchase price
 *   Each product row: image | name + size | qty (number or weight like "500g") | price (dollars large + cents superscript)
 *
 * Returns array of { rawName, quantity, unitPrice, totalPrice }.
 */
async function scrapeOrderDetail(page, orderUrl, debugSlug) {
  await navigateWithRetry(page, orderUrl);
  await sleep(3000);

  // Always save debug HTML for the first few orders
  if (debugSlug) {
    mkdirSync(debugDir, { recursive: true });
    const html = await page.content();
    writeFileSync(join(debugDir, `order-detail-${debugSlug}.html`), html, 'utf-8');
  }

  const items = await page.evaluate(() => {
    const results = [];

    // Anchor on [data-testid="price"] — each product row has exactly one.
    // DOM structure per product row:
    //   div (row)
    //     div > div > img (product image, alt="")
    //     div (name col) > p "Pams Sliced Almonds" + p "70g"
    //     div (qty+price col)
    //       p "1" (or "500g" for weight items)
    //       div > div[data-testid="price"]
    //             p[data-testid="price-dollars"] "2"
    //             div > p[data-testid="price-cents"] "89"
    //
    const priceEls = document.querySelectorAll('[data-testid="price"]');

    for (const priceEl of priceEls) {
      // Extract price from dollars + cents
      const dollarsEl = priceEl.querySelector('[data-testid="price-dollars"]');
      const centsEl = priceEl.querySelector('[data-testid="price-cents"]');
      if (!dollarsEl) continue;

      const dollars = dollarsEl.textContent.replace(/[^0-9]/g, '');
      const cents = centsEl ? centsEl.textContent.replace(/[^0-9]/g, '') : '00';
      const price = parseFloat(`${dollars}.${cents.padEnd(2, '0')}`);
      if (isNaN(price)) continue;

      // Walk up to the product row container — it's the ancestor that holds
      // the image, name, qty, and price as direct child divs.
      // Typically 3-5 levels up from the price element.
      let row = priceEl.parentElement;
      while (row) {
        // The row has direct child divs for image, name, qty+price columns
        // and contains an <img> tag (product image)
        if (row.querySelector('img') && row.children.length >= 2) {
          // Verify this looks like a product row (has <p> text for a name)
          const paragraphs = row.querySelectorAll('p');
          if (paragraphs.length >= 2) break;
        }
        row = row.parentElement;
      }
      if (!row) continue;

      // Skip if already processed
      if (row.dataset._scraped) continue;
      row.dataset._scraped = '1';

      // Extract product name — find the first <p> that isn't a size, qty, or price
      const paragraphs = row.querySelectorAll('p');
      let name = null;
      let size = null;
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (!text) continue;
        // Skip price elements
        if (p.closest('[data-testid="price"]')) continue;
        // Skip pure numbers (quantity)
        if (/^\d+$/.test(text)) continue;
        // Skip weight quantities like "500g"
        if (/^\d+\s*(?:g|kg|ml|l)$/i.test(text)) continue;
        // Size strings: "70g", "210g", "1L", "kg", "1.5kg", "6 Pack", "4pk" etc.
        if (/^\d*\.?\d*\s*(?:g|kg|ml|l|pk|ea|pack)$/i.test(text) || /^(?:g|kg|ml|l|ea)$/i.test(text)) {
          size = text;
          continue;
        }
        // First non-skipped <p> is the product name
        if (!name) {
          name = text;
        }
      }

      if (!name) continue;

      // Quantity: find a <p> containing just a number (not inside the price div)
      let quantity = 1;
      for (const p of paragraphs) {
        if (p.closest('[data-testid="price"]')) continue;
        const text = p.textContent.trim();
        // Exact integer match
        if (/^\d+$/.test(text)) {
          quantity = parseInt(text, 10);
          break;
        }
      }

      results.push({
        rawName: name,
        quantity,
        unitPrice: price && quantity > 1 ? Math.round((price / quantity) * 100) / 100 : price,
        totalPrice: price,
      });
    }

    return results;
  });

  return items;
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/**
 * Normalise a date string from NW (various formats) into YYYY-MM-DD.
 * Handles: "3 Feb 2026", "30 Jan 2026", "2026-01-30", "30/01/2026".
 */
function normaliseDate(dateStr) {
  if (!dateStr) return null;

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }

  // "3 Feb 2026" or "30 January 2026" (NW order history format)
  const namedMonth = dateStr.match(/(\d{1,2})\s+(\w{3,})\s+(\d{4})/);
  if (namedMonth) {
    const [, day, monthStr, year] = namedMonth;
    const month = MONTHS[monthStr.slice(0, 3).toLowerCase()];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or D/M/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    let [, day, month, year] = slashMatch;
    if (year.length === 2) year = '20' + year;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Fallback: native Date parse
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Import a scraped order into the database with dedup by order_reference.
 * Returns { purchaseId, skipped, itemCount }.
 */
function importOrder(db, orderData) {
  const { date, reference, total, items } = orderData;

  // Dedup: skip if this order reference already exists
  if (reference) {
    const existing = db.prepare(
      'SELECT id FROM purchases WHERE order_reference = ?'
    ).get(reference);

    if (existing) {
      return { purchaseId: existing.id, skipped: true, itemCount: 0 };
    }
  }

  const normalisedDate = normaliseDate(date);

  const purchaseId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchases (order_date, order_reference, import_method, item_count, total_amount)
      VALUES (?, ?, 'scrape', ?, ?)
    `).run(normalisedDate, reference, items.length, total || null);

    const id = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO purchase_items (purchase_id, raw_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(id, item.rawName, item.quantity || 1, item.unitPrice, item.totalPrice);
    }

    return id;
  })();

  return { purchaseId, skipped: false, itemCount: items.length };
}

/**
 * Main orchestrator: scrape all orders and run the full import pipeline.
 */
/**
 * Show preference suggestions and let the user apply all, pick individually, or skip.
 */
async function applyPreferences(db, suggestions) {
  console.log('\n  Options:');
  console.log('    a = apply all');
  console.log('    s = skip all');
  console.log('    p = pick individually');

  const answer = (await prompt('\n  Apply preferences? (a/s/p): ')).trim().toLowerCase();

  if (answer === 's' || (!answer && answer !== 'a' && answer !== 'p')) {
    console.log('  Skipped.\n');
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const s of suggestions) {
    let apply = answer === 'a';

    if (answer === 'p') {
      const price = s.price != null ? `$${s.price.toFixed(2)}` : 'N/A';
      const choice = (await prompt(`  ${s.genericName} -> ${s.productName} (${s.brand || '-'}) ${price} — ${s.share}%? (y/n): `)).trim().toLowerCase();
      apply = choice === 'y' || choice === 'yes';
    }

    if (apply) {
      setPreference(db, {
        genericName: s.genericName,
        productId: s.productId,
        source: 'history',
        confidence: s.confidence,
        notes: `Auto-suggested: ${s.buyCount}/${s.totalBuys} purchases (${s.share}%)`,
      });
      applied++;
    } else {
      skipped++;
    }
  }

  console.log(`\n  Applied ${applied} preference(s), skipped ${skipped}.\n`);
}

export async function scrapeOrders() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  const db = getDb();

  try {
    // Step 1: Login
    await waitForLogin(page);

    // Step 2: Get order list
    const orders = await scrapeOrderList(page);

    if (orders.length === 0) {
      console.log('No orders found. Check data/debug/order-history.html for the page content.');
      return;
    }

    // Step 3: Scrape each order detail
    const importedIds = [];
    let skippedCount = 0;
    let totalItems = 0;

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      console.log(`\n[${i + 1}/${orders.length}] Order ${order.reference || '(no ref)'} — ${order.date || 'unknown date'}`);

      if (!order.url) {
        console.log('  Skipping — no detail URL');
        continue;
      }

      // Scrape detail page — save debug HTML for first 2 orders (or all failures)
      const slug = (order.reference || `order-${i}`).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 50);
      const debugSlug = i < 2 ? slug : null;
      const items = await scrapeOrderDetail(page, order.url, debugSlug);
      console.log(`  Found ${items.length} item(s)`);

      if (items.length === 0) {
        // Always save debug HTML on failure
        if (!debugSlug) {
          mkdirSync(debugDir, { recursive: true });
          const html = await page.content();
          writeFileSync(join(debugDir, `order-detail-${slug}.html`), html, 'utf-8');
        }
        console.log(`  Saved debug HTML: data/debug/order-detail-${slug}.html`);
        continue;
      }

      // Import into DB
      const result = importOrder(db, { ...order, items });

      if (result.skipped) {
        console.log(`  Skipped (already imported as purchase #${result.purchaseId})`);
        skippedCount++;
      } else {
        console.log(`  Imported as purchase #${result.purchaseId} (${result.itemCount} items)`);
        importedIds.push(result.purchaseId);
        totalItems += result.itemCount;
      }

      await randomDelay();
    }

    console.log('\n========================================');
    console.log(`  Scraping complete!`);
    console.log(`  Imported: ${importedIds.length} order(s), ${totalItems} item(s)`);
    console.log(`  Skipped:  ${skippedCount} (already imported)`);
    console.log('========================================\n');

    if (importedIds.length === 0) {
      console.log('No new orders to process.');
      return;
    }

    // Step 4: Match items to catalog products
    console.log('Matching items to product catalog...\n');
    let totalMatched = 0;
    let totalFlagged = 0;

    for (const purchaseId of importedIds) {
      const { matched, flagged, total } = await matchPurchaseItems(db, purchaseId);
      console.log(`  Purchase #${purchaseId}: ${matched}/${total} matched, ${flagged} need review`);
      totalMatched += matched;
      totalFlagged += flagged;
    }

    console.log(`\nTotal matched: ${totalMatched}, needs review: ${totalFlagged}\n`);

    // Step 5: Update frequency stats
    console.log('Updating purchase frequency...');
    const { updated } = updateFrequency(db);
    console.log(`  ${updated} frequency record(s) updated.\n`);

    // Step 6: Suggest and optionally apply preferences
    console.log('Analyzing purchase patterns for preferences...');
    const suggestions = suggestPreferences(db);

    if (suggestions.length === 0) {
      console.log('  No new preference suggestions yet (need 3+ purchases with >60% same product).\n');
    } else {
      console.log(`\n  ${suggestions.length} preference suggestion(s):\n`);
      for (let idx = 0; idx < suggestions.length; idx++) {
        const s = suggestions[idx];
        const price = s.price != null ? `$${s.price.toFixed(2)}` : 'N/A';
        console.log(`    ${idx + 1}. ${s.genericName} -> ${s.productName} (${s.brand || '-'}) ${price}`);
        console.log(`       Bought ${s.buyCount}/${s.totalBuys} times (${s.share}%)`);
      }

      await applyPreferences(db, suggestions);
    }
  } finally {
    await browser.close();
    closeDb();
  }
}

// CLI
if (process.argv[1]?.includes('scrape-orders')) {
  scrapeOrders().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}
