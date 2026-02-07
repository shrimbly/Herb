import config from '../lib/config.js';

const { scraper: scraperConfig } = config;

let chromium;
let useStealth = false;

// Try playwright-extra with stealth, fall back to vanilla playwright
try {
  const { chromium: stealthChromium } = await import('playwright-extra');
  const { default: stealth } = await import('puppeteer-extra-plugin-stealth');
  stealthChromium.use(stealth());
  chromium = stealthChromium;
  useStealth = true;
} catch {
  const pw = await import('playwright');
  chromium = pw.chromium;
}

export async function launchBrowser() {
  const browser = await chromium.launch({
    headless: scraperConfig.headless,
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
  });

  // Manual stealth if playwright-extra wasn't available
  if (!useStealth) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }

  console.log(`Browser launched (stealth: ${useStealth})`);
  return { browser, context };
}

export async function detectCloudflare(page) {
  const title = await page.title();
  const content = await page.content();
  return (
    title.includes('Just a moment') ||
    content.includes('cf-challenge') ||
    content.includes('Checking your browser')
  );
}

export async function waitForCloudflare(page) {
  if (await detectCloudflare(page)) {
    console.log('  Cloudflare challenge detected, waiting...');
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: scraperConfig.cloudflareWait }
      );
      await randomDelay();
      console.log('  Cloudflare challenge passed.');
    } catch {
      console.warn('  Cloudflare wait timed out — may need manual intervention.');
    }
  }
}

export async function navigateWithRetry(page, url, retries = scraperConfig.retries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: scraperConfig.navigationTimeout,
      });
      await waitForCloudflare(page);
      return true;
    } catch (err) {
      console.warn(`  Navigation attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        const backoff = scraperConfig.retryBackoff * attempt;
        console.log(`  Retrying in ${backoff / 1000}s...`);
        await sleep(backoff);
      }
    }
  }
  return false;
}

export function randomDelay() {
  const ms = scraperConfig.delayMin + Math.random() * (scraperConfig.delayMax - scraperConfig.delayMin);
  return sleep(ms);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
