import { createInterface } from 'readline';
import { getDb, closeDb } from '../lib/db.js';
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, sleep } from '../scraper/browser.js';
import { resolveIngredient } from '../lib/resolve.js';

const BASE_URL = config.store.baseUrl;
const API_BASE = 'https://api-prod.newworld.co.nz';
const CART_API = `${API_BASE}/v1/edge/cart`;

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
 * Attempt automated login with stored credentials.
 * Returns true if login succeeded, false if manual login needed.
 */
async function loginWithCredentials(page) {
  const email = config.nwEmail;
  const password = config.nwPassword;

  if (!email || !password) {
    console.log('No NW_EMAIL/NW_PASSWORD in .env — manual login required.');
    return false;
  }

  try {
    console.log('Attempting automated login...');

    // Find email/username field — try broad set of selectors
    const emailField = page.locator([
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[name="emailAddress"]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
    ].join(', ')).first();
    await emailField.waitFor({ timeout: 5000 });
    await emailField.fill(email);

    // Fill password
    await page.locator('input[type="password"]').first().fill(password);
    await sleep(500);

    // Find submit button — try multiple strategies
    const submitBtn = page.locator([
      'button[type="submit"]',
      'input[type="submit"]',
    ].join(', ')).or(
      page.getByRole('button', { name: /sign in|log in|login|submit/i })
    ).first();
    await submitBtn.click();

    // Wait for login to complete — password field disappears after successful auth
    await page.waitForFunction(
      () => !document.querySelector('input[type="password"]'),
      { timeout: 20000 }
    );
    await sleep(2000);

    console.log('Login successful.');
    return true;
  } catch (err) {
    console.log(`Automated login failed: ${err.message}`);
    return false;
  }
}

/**
 * Wait for login to complete by polling for the password field to disappear.
 */
async function waitForLoginComplete(page, timeoutMs = 120000) {
  console.log('  Waiting for login to complete in browser...');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasPassword = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
    if (!hasPassword) return true;
    await sleep(2000);
  }
  return false;
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
 * Uses Playwright's context.request to bypass CORS (browser fetch fails on cross-origin POST).
 * products: [{ apiProductId, quantity, saleType }]
 * Returns { status, data }.
 */
async function addToCartApi(context, token, products) {
  const payload = {
    products: products.map(p => ({
      productId: p.apiProductId,
      quantity: p.quantity,
      sale_type: p.saleType,
    })),
  };

  try {
    const res = await context.request.post(CART_API, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: payload,
    });

    const data = await res.json();
    return { status: res.status(), data };
  } catch (err) {
    console.error(`  Cart API error: ${err.message}`);
    return { status: 0, data: {} };
  }
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
export async function addToCart(items, { keepOpen = false } = {}) {
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
      const saleType = getSaleType(p.nw_product_id);
      const isWeight = saleType === 'WEIGHT';
      const lineTotal = (p.price || 0) * r.qty;
      estimatedTotal += lineTotal;
      const size = p.unit_size ? ` (${p.unit_size})` : '';
      const unit = isWeight ? '/kg' : ' ea';
      const qtyLabel = isWeight ? `${r.qty}kg` : `x${r.qty}`;
      const src = r.source === 'preference' ? ' *' : '';
      console.log(`  + ${r.name} ${qtyLabel} -> ${p.name}${size} — $${p.price?.toFixed(2) || '?'}${unit}${src}`);
      toAdd.push({
        apiProductId: toApiProductId(p.nw_product_id),
        saleType: getSaleType(p.nw_product_id),
        quantity: r.qty,
        name: p.name,
        price: p.price,
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
    await sleep(3000);

    // Check for login form (password field) rather than URL — NW keeps /my-account in URL even on login page
    const needsLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'));

    if (needsLogin) {
      // Try automated login first, fall back to manual
      const loggedIn = await loginWithCredentials(page);

      if (!loggedIn) {
        console.log('\n========================================');
        console.log('  Please log in to your New World');
        console.log('  account in the browser window.');
        console.log('  (will auto-detect when done)');
        console.log('========================================\n');

        const detected = await waitForLoginComplete(page);
        if (!detected) {
          throw new Error('Login timed out — please try again.');
        }
        console.log('Login detected.');
        await sleep(2000);
      }
    } else {
      console.log('Already logged in.');
    }

    // Extract Bearer token
    console.log('Extracting auth token...');
    const token = await extractBearerToken(page);
    console.log('Token acquired.');

    // Set store via API — POST /v1/edge/cart/store/{storeId}
    if (config.store.id) {
      const storeName = config.store.name || config.store.id;
      console.log(`Setting store to ${storeName}...`);
      const storeRes = await context.request.post(
        `${API_BASE}/v1/edge/cart/store/${config.store.id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (storeRes.status() === 200) {
        console.log(`  Store set to ${storeName}.`);
      } else {
        console.log(`  Warning: store change returned ${storeRes.status()}`);
      }
    }

    // Add to cart — try as a single batch first, fall back to individual on error
    let added = 0;
    let failed = 0;

    console.log(`\nAdding ${toAdd.length} item(s) to cart...`);
    const batchResult = await addToCartApi(context, token, toAdd);

    if (batchResult.status === 200) {
      // Batch succeeded — report using our item names (API returns full cart, not just added items)
      const data = batchResult.data;
      const unavailIds = new Set((data.unavailableProducts || []).map(u => u.productId));
      for (const item of toAdd) {
        if (unavailIds.has(item.apiProductId)) {
          console.log(`  x ${item.name} — unavailable`);
          failed++;
        } else {
          const unit = item.saleType === 'WEIGHT' ? 'kg' : '';
          console.log(`  + ${item.name} x${item.quantity}${unit} — $${item.price?.toFixed(2) || '?'}`);
          added++;
        }
      }
    } else {
      // Batch failed — retry each item individually so one bad item doesn't sink the rest
      console.log(`  Batch failed (${batchResult.status}), retrying individually...`);

      for (const item of toAdd) {
        const result = await addToCartApi(context, token, [item]);

        if (result.status === 200) {
          if (result.data.unavailableProducts?.some(u => u.productId === item.apiProductId)) {
            console.log(`  x ${item.name} — unavailable`);
            failed++;
          } else {
            const unit = item.saleType === 'WEIGHT' ? 'kg' : '';
            console.log(`  + ${item.name} x${item.quantity}${unit} — $${item.price?.toFixed(2) || '?'}`);
            added++;
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

    if (keepOpen) {
      console.log('Browser left open for inspection. Press Ctrl+C to exit.');
      await new Promise(() => {}); // hang until killed
    }

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
  const keepOpen = process.argv.includes('--keep-open');
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

  if (args.length > 0) {
    // Parse CLI arguments: "2x mince" → { name: "mince", qty: 2 }
    const items = args.map(arg => {
      const qtyMatch = arg.match(/^(\d+)\s*x\s+(.+)$/i);
      if (qtyMatch) return { name: qtyMatch[2].trim(), qty: parseInt(qtyMatch[1], 10) };
      return { name: arg.trim(), qty: 1 };
    });

    addToCart(items, { keepOpen }).catch(err => {
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
