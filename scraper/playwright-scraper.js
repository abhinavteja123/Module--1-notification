// playwright-scraper.js
// Headless Chromium scraper for JS-heavy SPAs (Devfolio, Unstop).
// Requires: npx playwright install chromium

const UserAgent = require('user-agents');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch {
  chromium = null;
}

/**
 * Scrape a JS-rendered page using Playwright (headless Chromium).
 * @param {object} config - target config from targets.json
 * @returns {Array<{title, org, link, type, source}>}
 */
async function scrapeWithPlaywright(config) {
  if (!chromium) {
    console.log(`    ⚠ Playwright not installed — skipping ${config.name}`);
    console.log('      Run: npm install playwright && npx playwright install chromium');
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: new UserAgent({ deviceCategory: 'desktop' }).toString(),
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    console.log(`    → navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 30000 });

    // CAPTCHA detection — skip if blocked
    const title = await page.title();
    if (/robot|captcha|verify|blocked/i.test(title)) {
      console.log(`    ⚠ CAPTCHA/block detected on ${config.name} — skipping`);
      return [];
    }

    // Wait for content cards to appear
    const sel = config.selectors;
    const cardSelector = sel.card;
    let found = false;

    try {
      await page.waitForSelector(cardSelector, { timeout: 12000 });
      found = true;
    } catch {
      // Retry once after a short wait
      console.log(`    → first wait failed, retrying in 3s...`);
      await page.waitForTimeout(3000);
      try {
        await page.waitForSelector(cardSelector, { timeout: 8000 });
        found = true;
      } catch {
        console.log(`    ⚠ card selector "${cardSelector}" not found on ${config.name}`);
      }
    }

    if (!found) {
      // Try to extract any useful links from the page as a fallback
      return await fallbackLinkExtraction(page, config);
    }

    // Scroll to load lazy content
    await autoScroll(page);

    // Extract data from cards
    const results = await page.evaluate((s) => {
      const cards = document.querySelectorAll(s.card);
      return Array.from(cards).map(card => {
        // Try each title selector (comma-separated fallbacks)
        const titleSelectors = s.title.split(',').map(s => s.trim());
        let title = '';
        for (const ts of titleSelectors) {
          const el = card.querySelector(ts);
          if (el && el.textContent.trim()) {
            title = el.textContent.trim();
            break;
          }
        }

        // Try each org selector
        const orgSelectors = (s.org || '').split(',').map(s => s.trim());
        let org = '';
        for (const os of orgSelectors) {
          if (!os) continue;
          const el = card.querySelector(os);
          if (el && el.textContent.trim()) {
            org = el.textContent.trim();
            break;
          }
        }

        // Extract link
        let link = '';
        const linkEl = card.querySelector(s.link) || card.closest('a');
        if (linkEl) {
          link = linkEl.href || linkEl.getAttribute('href') || '';
        }

        return { title, org, link };
      }).filter(r => r.title && r.link);
    }, sel);

    return results.map(r => ({
      ...r,
      // Normalize relative URLs
      link: r.link.startsWith('http') ? r.link : new URL(r.link, config.url).href,
      type: config.type,
      source: config.name,
    }));

  } finally {
    await browser.close();
  }
}

/**
 * Fallback: extract hackathon/opportunity links from the page when card selectors fail.
 * This catches cases where CSS class names have changed.
 */
async function fallbackLinkExtraction(page, config) {
  console.log(`    → attempting fallback link extraction for ${config.name}`);

  const results = await page.evaluate((baseUrl) => {
    const links = document.querySelectorAll('a[href]');
    const seen = new Set();
    const items = [];

    for (const a of links) {
      const href = a.href;
      if (!href || seen.has(href)) continue;

      // Filter for likely opportunity links based on URL patterns
      const isHackathon = /hackathon|hack|challenge/i.test(href) && !/\/hackathons\/?$/.test(href);
      const isInternship = /internship|intern/i.test(href) && !/\/internships\/?$/.test(href);
      const isOpportunity = /opportunity|competition/i.test(href);

      if (isHackathon || isInternship || isOpportunity) {
        const title = a.textContent.trim().substring(0, 200);
        if (title && title.length > 3) {
          seen.add(href);
          items.push({ title, link: href, org: '' });
        }
      }
    }

    return items.slice(0, 50);
  }, config.url);

  return results.map(r => ({
    ...r,
    link: r.link.startsWith('http') ? r.link : new URL(r.link, config.url).href,
    type: config.type,
    source: config.name + ' (fallback)',
  }));
}

/**
 * Scroll down the page to trigger lazy-loaded content.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const maxHeight = 3000;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= maxHeight || window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  // Wait a moment for any lazy content to load after scrolling
  await page.waitForTimeout(1500);
}

module.exports = { scrapeWithPlaywright };
