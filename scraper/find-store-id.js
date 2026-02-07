import { launchBrowser, navigateWithRetry, randomDelay } from './browser.js';

async function findStoreId() {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  // Capture network requests that contain store IDs
  const storeIds = new Set();
  page.on('request', req => {
    const url = req.url();
    const match = url.match(/storeId=([^&]+)/i) || url.match(/store[_-]?id[=:]([^&"]+)/i);
    if (match) storeIds.add(match[1]);
  });
  page.on('response', async res => {
    if (res.url().includes('store') && res.headers()['content-type']?.includes('json')) {
      try {
        const body = await res.text();
        console.log(`  [API] ${res.url().slice(0, 100)}`);
        // Try to extract store info
        if (body.includes('New Lynn') || body.includes('new-lynn')) {
          console.log('  Found New Lynn reference in API response!');
          console.log(`  Response preview: ${body.slice(0, 500)}`);
        }
      } catch {}
    }
  });

  console.log('Navigating to New World...');
  await navigateWithRetry(page, 'https://www.newworld.co.nz/');
  await randomDelay();

  // Look for store selector
  console.log('\nLooking for store info in page...');
  const storeInfo = await page.evaluate(() => {
    // Check local storage
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.toLowerCase().includes('store')) {
        ls[key] = localStorage.getItem(key);
      }
    }

    // Check cookies
    const cookies = document.cookie.split(';').filter(c => c.toLowerCase().includes('store'));

    // Check for any global JS variables
    const globals = {};
    for (const key of ['__NEXT_DATA__', '__STORE__', 'storeId', 'selectedStore']) {
      if (window[key]) globals[key] = JSON.stringify(window[key]).slice(0, 1000);
    }

    return { localStorage: ls, cookies, globals };
  });

  console.log('\nLocalStorage store keys:', JSON.stringify(storeInfo.localStorage, null, 2));
  console.log('Store cookies:', storeInfo.cookies);
  console.log('Global vars:', JSON.stringify(storeInfo.globals, null, 2));

  if (storeIds.size > 0) {
    console.log('\nStore IDs found in network requests:', [...storeIds]);
  }

  // Try navigating to store locator
  console.log('\n--- Checking store locator page ---');
  await navigateWithRetry(page, 'https://www.newworld.co.nz/store-locator');
  await randomDelay();

  // Search for New Lynn
  const newLynnInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').filter(l => l.toLowerCase().includes('new lynn') || l.toLowerCase().includes('lynn'));
    const links = [...document.querySelectorAll('a')].filter(a =>
      a.textContent.toLowerCase().includes('new lynn') ||
      (a.href && a.href.toLowerCase().includes('new-lynn'))
    ).map(a => ({ text: a.textContent.trim(), href: a.href }));
    return { lines, links };
  });

  console.log('New Lynn references:', JSON.stringify(newLynnInfo, null, 2));

  if (storeIds.size > 0) {
    console.log('\n=== Store IDs captured from network ===');
    for (const id of storeIds) console.log(`  ${id}`);
  }

  console.log('\n--- Manual step ---');
  console.log('The browser is still open. Please:');
  console.log('1. Click the store selector on the page');
  console.log('2. Search for "New Lynn" and select it');
  console.log('3. Check this terminal for captured store IDs');
  console.log('\nPress Ctrl+C when done.\n');

  // Keep alive so user can interact
  await new Promise(resolve => {
    process.on('SIGINT', () => {
      console.log('\nFinal captured store IDs:', [...storeIds]);
      resolve();
    });
    // Also check periodically
    const interval = setInterval(() => {
      if (storeIds.size > 0) {
        console.log('  Captured IDs so far:', [...storeIds]);
      }
    }, 5000);
    process.on('SIGINT', () => clearInterval(interval));
  });

  await browser.close();
}

findStoreId().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
