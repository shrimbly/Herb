/**
 * Test: login, change store via API, add product.
 * Usage: node cart/test-cart.js
 */
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, sleep } from '../scraper/browser.js';

const BASE_URL = config.store.baseUrl;
const API_BASE = 'https://api-prod.newworld.co.nz';
const CART_API = `${API_BASE}/v1/edge/cart`;

async function run() {
  console.log('=== Cart Test ===\n');
  const storeId = config.store.id;
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.log('Step 1: Login...');
    await navigateWithRetry(page, `${BASE_URL}/shop/my-account/myorders`);
    await sleep(3000);
    const needsLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
    if (needsLogin && config.nwEmail && config.nwPassword) {
      const emailField = page.locator([
        'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
        'input[name="emailAddress"]', 'input[autocomplete="email"]', 'input[autocomplete="username"]',
      ].join(', ')).first();
      await emailField.waitFor({ timeout: 5000 });
      await emailField.fill(config.nwEmail);
      await page.locator('input[type="password"]').first().fill(config.nwPassword);
      await sleep(500);
      await page.locator('button[type="submit"], input[type="submit"]').or(
        page.getByRole('button', { name: /sign in|log in|login|submit/i })
      ).first().click();
      await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 20000 });
      await sleep(2000);
      console.log('  Done.');
    }

    // Step 2: Extract token
    console.log('\nStep 2: Extract token...');
    let token = null;
    const handler = request => {
      const auth = request.headers()['authorization'];
      if (auth?.startsWith('Bearer ') && !token) token = auth.slice(7);
    };
    page.on('request', handler);
    await navigateWithRetry(page, `${BASE_URL}/shop/cart`);
    await sleep(3000);
    if (!token) {
      token = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const val = localStorage.getItem(localStorage.key(i));
          if (val?.startsWith('eyJ')) return val;
        }
        return null;
      });
    }
    page.off('request', handler);
    console.log(`  Token: ${token ? 'OK' : 'NONE'}`);
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Step 3: Check current cart store
    console.log('\nStep 3: Current cart store...');
    const before = await (await context.request.get(CART_API, { headers: authHeaders })).json();
    console.log(`  Before: ${before.store?.storeName} (${before.store?.storeId})`);

    // Step 4: Change store via POST /v1/edge/cart/store/{storeId}
    console.log(`\nStep 4: POST /v1/edge/cart/store/${storeId}...`);
    const changeRes = await context.request.post(`${API_BASE}/v1/edge/cart/store/${storeId}`, {
      headers: authHeaders,
    });
    console.log(`  Status: ${changeRes.status()}`);
    try {
      const changeBody = await changeRes.json();
      console.log(`  Body: ${JSON.stringify(changeBody).slice(0, 200)}`);
    } catch {
      console.log('  (empty response body — expected)');
    }

    // Step 5: Verify with GET
    console.log('\nStep 5: Verify cart store...');
    const after = await (await context.request.get(CART_API, { headers: authHeaders })).json();
    console.log(`  After: ${after.store?.storeName} (${after.store?.storeId})`);
    console.log(`  Match: ${after.store?.storeId === storeId}`);

    // Step 6: Add a product
    if (after.store?.storeId === storeId) {
      console.log('\nStep 6: Add test product...');
      const postRes = await context.request.post(CART_API, {
        headers: authHeaders,
        data: { products: [{ productId: '5007770-EA-000', quantity: 1, sale_type: 'UNITS' }] },
      });
      const body = await postRes.json();
      console.log(`  Status: ${postRes.status()}`);
      console.log(`  Store: ${body.store?.storeName}`);
      console.log(`  Products: ${(body.products || []).length}`);
    }

    console.log('\n=== Done ===');
    await browser.close();
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    await browser.close();
  }
}

run();
