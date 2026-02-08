import { createInterface } from 'readline';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, sleep } from '../scraper/browser.js';
import { resolveIngredient } from '../lib/resolve.js';

const BASE_URL = config.store.baseUrl;
const CART_API = 'https://api-prod.newworld.co.nz/v1/edge/cart';

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
 * Convert DB nw_product_id (e.g. "5007770_ea_000nw") to API format ("5007770-EA-000").
 */
function toApiProductId(nwProductId) {
  return nwProductId.replace(/nw$/, '').replace(/_/g, '-').toUpperCase();
}

/**
 * Determine sale_type from the product ID.
 * "_ea_" → UNITS, "_kgm_" → WEIGHT (sold by kg)
 */
function getSaleType(nwProductId) {
  if (nwProductId.includes('_kgm_')) return 'WEIGHT';
  return 'UNITS';
}

/**
 * Extract Bearer token by intercepting API requests after login.
 * Navigates to a page that triggers API calls and captures the Authorization header.
 */
async function extractBearerToken(page) {
  let token = null;

  // Listen for any request to the NW API that carries an auth header
  const handler = request => {
    const auth = request.headers()['authorization'];
    if (auth?.startsWith('Bearer ') && !token) {
      token = auth.slice(7);
    }
  };

  page.on('request', handler);

  // Navigate to cart page — this triggers API calls with the Bearer token
  await navigateWithRetry(page, `${BASE_URL}/shop/cart`);
  await sleep(3000);

  // If we didn't capture from requests, try extracting from page JS context
  if (!token) {
    token = await page.evaluate(() => {
      // Check common storage locations for auth tokens
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val?.startsWith('eyJ')) return val; // JWT prefix
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);
        if (val?.startsWith('eyJ')) return val;
      }
      return null;
    });
  }

  page.off('request', handler);

  if (!token) {
    throw new Error('Could not extract Bearer token. Make sure you are logged in.');
  }

  return token;
}

/**
 * Add products to the NW cart via API.
 * products: [{ apiProductId, quantity, saleType }]
 * Returns the API response.
 */
async function addToCartApi(page, token, products) {
  const payload = {
    products: products.map(p => ({
      productId: p.apiProductId,
      quantity: p.quantity,
      sale_type: p.saleType,
    })),
  };

  // Use the browser's fetch to make the API call (inherits cookies/session)
  const result = await page.evaluate(async ({ url, token, payload }) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return { status: res.status, data };
  }, { url: CART_API, token, payload });

  return result;
}

/**
 * Resolve a list of item names to catalog products.
 * items: [{ name, qty }]
 * Returns [{ name, qty, resolved, product }]
 */
async function resolveItems(db, items) {
  const results = [];

  for (const item of items) {
    const resolution = await resolveIngredient(db, {
      genericName: item.name,
    });

    if (resolution.resolved) {
      // Fetch nw_product_id for the matched product
      const product = db.prepare(
        'SELECT id, nw_product_id, name, brand, price, unit_size FROM products WHERE id = ?'
      ).get(resolution.productId);

      results.push({
        name: item.name,
        qty: item.qty || 1,
        resolved: true,
        product,
        confidence: resolution.confidence,
        source: resolution.source,
      });
    } else {
      results.push({
        name: item.name,
        qty: item.qty || 1,
        resolved: false,
        candidates: (resolution.candidates || []).slice(0, 3),
      });
    }
  }

  return results;
}

/**
 * Main pipeline: resolve items, show confirmation, add to cart.
 * items: [{ name, qty }]
 */
export async function addToCart(items) {
  const db = getDb();

  // Step 1: Resolve items to products
  console.log('Resolving items to products...\n');
  const resolved = await resolveItems(db, items);

  // Display resolution results
  const toAdd = [];
  const unresolved = [];
  let estimatedTotal = 0;

  for (const r of resolved) {
    if (r.resolved) {
      const p = r.product;
      const lineTotal = (p.price || 0) * r.qty;
      estimatedTotal += lineTotal;
      const size = p.unit_size ? ` (${p.unit_size})` : '';
      const src = r.source === 'preference' ? ' *' : '';
      console.log(`  + ${r.name} x${r.qty} -> ${p.name}${size} — $${p.price?.toFixed(2) || '?'} ea${src}`);
      toAdd.push({
        apiProductId: toApiProductId(p.nw_product_id),
        saleType: getSaleType(p.nw_product_id),
        quantity: r.qty,
        name: p.name,
        dbName: r.name,
      });
    } else {
      console.log(`  ? ${r.name} x${r.qty} — could not resolve`);
      if (r.candidates?.length) {
        for (const c of r.candidates) {
          console.log(`      candidate: ${c.name} (${c.brand || '-'}) $${c.price?.toFixed(2) || '?'}`);
        }
      }
      unresolved.push(r);
    }
  }

  console.log(`\n  (* = matched from preference)`);
  console.log(`  Resolved: ${toAdd.length}/${resolved.length}`);
  console.log(`  Estimated total: $${estimatedTotal.toFixed(2)}\n`);

  if (toAdd.length === 0) {
    console.log('Nothing to add to cart.');
    closeDb();
    return { added: 0, failed: 0, unresolved: unresolved.length };
  }

  // Step 2: Confirm
  const answer = (await prompt('Add to cart? (y/n): ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Cancelled.');
    closeDb();
    return { added: 0, failed: 0, unresolved: unresolved.length };
  }

  // Step 3: Launch browser, login, extract token, add to cart
  console.log('\nLaunching browser...');
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    // Navigate to orders page to trigger login
    await navigateWithRetry(page, `${BASE_URL}/shop/my-account/myorders`);
    await sleep(2000);

    const onAccountPage = await page.evaluate(() => {
      return window.location.href.includes('/my-account');
    });

    if (!onAccountPage) {
      console.log('\n========================================');
      console.log('  Please log in to your New World');
      console.log('  account in the browser window.');
      console.log('========================================\n');

      await prompt('Press ENTER once you have logged in...');
      await sleep(2000);

      await navigateWithRetry(page, `${BASE_URL}/shop/my-account/myorders`);
      await sleep(2000);
    } else {
      console.log('Already logged in.');
    }

    // Extract Bearer token
    console.log('Extracting auth token...');
    const token = await extractBearerToken(page);
    console.log('Token acquired.\n');

    // Add to cart — try as a single batch first, fall back to individual on error
    let added = 0;
    let failed = 0;

    console.log(`Adding ${toAdd.length} item(s) to cart...`);
    const batchResult = await addToCartApi(page, token, toAdd);

    if (batchResult.status === 200) {
      // Batch succeeded
      const data = batchResult.data;
      for (const p of data.products || []) {
        console.log(`  + ${p.name} x${p.quantity} — $${(p.price / 100).toFixed(2)}`);
        added++;
      }
      for (const u of data.unavailableProducts || []) {
        console.log(`  x ${u.productId} — unavailable`);
        failed++;
      }
    } else {
      // Batch failed — retry each item individually so one bad item doesn't sink the rest
      console.log(`  Batch failed (${batchResult.status}), retrying individually...`);

      for (const item of toAdd) {
        const result = await addToCartApi(page, token, [item]);

        if (result.status === 200) {
          const p = result.data.products?.[0];
          if (p) {
            console.log(`  + ${p.name} x${p.quantity} — $${(p.price / 100).toFixed(2)}`);
            added++;
          } else if (result.data.unavailableProducts?.length) {
            console.log(`  x ${item.name} — unavailable`);
            failed++;
          }
        } else {
          console.log(`  x ${item.name} — API error (${result.status})`);
          failed++;
        }

        await sleep(500);
      }
    }

    console.log(`\n========================================`);
    console.log(`  Cart updated!`);
    console.log(`  Added: ${added}`);
    if (failed) console.log(`  Failed: ${failed}`);
    if (unresolved.length) console.log(`  Unresolved: ${unresolved.length}`);
    console.log(`========================================\n`);

    return { added, failed, unresolved: unresolved.length };
  } finally {
    await browser.close();
    closeDb();
  }
}

// CLI — accepts items as JSON on stdin or as arguments
// Usage:
//   echo '[{"name":"chicken thighs","qty":1},{"name":"mince","qty":2}]' | node cart/add-to-cart.js
//   node cart/add-to-cart.js "chicken thighs" "broccoli" "2x mince" "milk"
if (process.argv[1]?.includes('add-to-cart')) {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Parse CLI arguments: "2x mince" → { name: "mince", qty: 2 }
    const items = args.map(arg => {
      const qtyMatch = arg.match(/^(\d+)\s*x\s+(.+)$/i);
      if (qtyMatch) return { name: qtyMatch[2].trim(), qty: parseInt(qtyMatch[1], 10) };
      return { name: arg.trim(), qty: 1 };
    });

    addToCart(items).catch(err => {
      console.error('Failed:', err.message);
      process.exit(1);
    });
  } else {
    // Read JSON from stdin
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', async () => {
      const input = chunks.join('').trim();
      if (!input) {
        console.log('Usage:');
        console.log('  node cart/add-to-cart.js "chicken thighs" "broccoli" "2x mince"');
        console.log('  echo \'[{"name":"milk","qty":1}]\' | node cart/add-to-cart.js');
        process.exit(1);
      }

      try {
        const items = JSON.parse(input);
        await addToCart(items);
      } catch (err) {
        console.error('Failed:', err.message);
        process.exit(1);
      }
    });
  }
}
