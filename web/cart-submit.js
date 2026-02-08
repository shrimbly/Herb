/**
 * Background Playwright cart submission.
 * Extracted from cart/add-to-cart.js — non-interactive, pushes SSE events.
 */
import config from '../lib/config.js';
import { launchBrowser, navigateWithRetry, sleep } from '../scraper/browser.js';
import { pushEvent } from './session.js';

const BASE_URL = config.store.baseUrl;
const API_BASE = 'https://api-prod.newworld.co.nz';
const CART_API = `${API_BASE}/v1/edge/cart`;

/**
 * Convert DB nw_product_id (e.g. "5007770_ea_000nw") to API format ("5007770-EA-000").
 */
function toApiProductId(nwProductId) {
  return nwProductId.replace(/nw$/, '').replace(/_/g, '-').toUpperCase();
}

function getSaleType(nwProductId) {
  if (nwProductId.includes('_kgm_')) return 'WEIGHT';
  return 'UNITS';
}

async function loginWithCredentials(page) {
  const email = config.nwEmail;
  const password = config.nwPassword;
  if (!email || !password) return false;

  try {
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
    await page.locator('input[type="password"]').first().fill(password);
    await sleep(500);

    const submitBtn = page.locator([
      'button[type="submit"]',
      'input[type="submit"]',
    ].join(', ')).or(
      page.getByRole('button', { name: /sign in|log in|login|submit/i })
    ).first();
    await submitBtn.click();

    await page.waitForFunction(
      () => !document.querySelector('input[type="password"]'),
      { timeout: 20000 }
    );
    await sleep(2000);
    return true;
  } catch {
    return false;
  }
}

async function extractBearerToken(page) {
  let token = null;
  const handler = request => {
    const auth = request.headers()['authorization'];
    if (auth?.startsWith('Bearer ') && !token) {
      token = auth.slice(7);
    }
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
      for (let i = 0; i < sessionStorage.length; i++) {
        const val = sessionStorage.getItem(sessionStorage.key(i));
        if (val?.startsWith('eyJ')) return val;
      }
      return null;
    });
  }

  page.off('request', handler);
  if (!token) throw new Error('Could not extract Bearer token');
  return token;
}

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
    return { status: res.status(), data: await res.json() };
  } catch (err) {
    return { status: 0, data: {}, error: err.message };
  }
}

/**
 * Submit cart in background. Pushes SSE events for progress.
 * session: { id, items } — items must have selectedProductId + candidates with product details
 * db: for logging
 */
export async function submitCart(session, db) {
  const sid = session.id;
  const emit = (type, message, extra = {}) => pushEvent(sid, { type, message, ...extra });

  // Build product list from session
  const toAdd = [];
  let estimatedTotal = 0;

  for (const item of session.items) {
    if (!item.selectedProductId) continue;
    const product = item.candidates.find(c => String(c.id) === String(item.selectedProductId));
    if (!product || !product.nw_product_id) {
      console.log(`[cart] Skipping "${item.name}": no matching product (selectedId=${item.selectedProductId})`);
      continue;
    }

    toAdd.push({
      apiProductId: toApiProductId(product.nw_product_id),
      saleType: getSaleType(product.nw_product_id),
      quantity: item.qty,
      name: product.name,
      price: product.price,
    });
    estimatedTotal += (product.price || 0) * item.qty;
  }

  console.log(`[cart] Session ${sid}: ${toAdd.length}/${session.items.length} items to add`);
  for (const p of toAdd) console.log(`[cart]   ${p.name} x${p.quantity} → ${p.apiProductId} (${p.saleType})`);

  if (toAdd.length === 0) {
    emit('error', 'No products to add');
    return;
  }

  session.status = 'submitting';
  emit('progress', 'Launching browser...');

  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const context = launched.context;
    const page = await context.newPage();

    // Login
    emit('progress', 'Logging in...');
    await navigateWithRetry(page, `${BASE_URL}/shop/my-account/myorders`);
    await sleep(3000);

    const needsLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
    if (needsLogin) {
      const loggedIn = await loginWithCredentials(page);
      if (!loggedIn) {
        emit('error', 'Login failed — check NW_EMAIL/NW_PASSWORD');
        session.status = 'error';
        return;
      }
    }
    emit('progress', 'Logged in');

    // Token
    emit('progress', 'Getting auth token...');
    const token = await extractBearerToken(page);

    // Set store
    if (config.store.id) {
      emit('progress', `Setting store to ${config.store.name || config.store.id}...`);
      await context.request.post(
        `${API_BASE}/v1/edge/cart/store/${config.store.id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
    }

    // Add to cart
    let added = 0;
    let failed = 0;

    emit('progress', `Adding ${toAdd.length} item(s) to cart...`);
    const batchResult = await addToCartApi(context, token, toAdd);

    console.log(`[cart] Batch response: status=${batchResult.status}`, JSON.stringify(batchResult.data).slice(0, 500));
    if (batchResult.status === 200) {
      const unavailIds = new Set((batchResult.data.unavailableProducts || []).map(u => u.productId));
      for (let i = 0; i < toAdd.length; i++) {
        const item = toAdd[i];
        if (unavailIds.has(item.apiProductId)) {
          failed++;
          emit('progress', `${item.name} — unavailable`, { detail: `${i + 1}/${toAdd.length}` });
        } else {
          added++;
          emit('progress', `Added ${item.name}`, { detail: `${i + 1}/${toAdd.length}` });
        }
      }
    } else {
      emit('progress', 'Batch failed, trying individually...', { detail: `Status: ${batchResult.status}` });

      for (let i = 0; i < toAdd.length; i++) {
        const item = toAdd[i];
        emit('progress', `Adding ${item.name}...`, { detail: `${i + 1}/${toAdd.length}` });

        const result = await addToCartApi(context, token, [item]);
        if (result.status === 200) {
          if (result.data.unavailableProducts?.some(u => u.productId === item.apiProductId)) {
            failed++;
          } else {
            added++;
          }
        } else {
          failed++;
        }
        await sleep(500);
      }
    }

    // Update log
    try {
      db.prepare(`
        UPDATE checkout_log SET
          confirmed_count = ?, status = 'completed',
          total_amount = ?, completed_at = datetime('now')
        WHERE session_id = ?
      `).run(added, estimatedTotal, sid);
    } catch {}

    session.status = 'done';
    emit('done', 'Cart updated', {
      added,
      failed,
      total: estimatedTotal.toFixed(2),
    });

    await browser.close();
  } catch (err) {
    session.status = 'error';
    emit('error', err.message || 'Cart submission failed');
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
