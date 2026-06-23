// cheerio-scraper.js
// Lightweight scraper for server-rendered HTML sites using Cheerio + Axios.
// Handles: HackerEarth (CSS selectors) and Internshala (JSON-LD + CSS fallback).

const axios = require('axios');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

/**
 * Scrape a server-rendered page using Cheerio.
 * @param {object} config - target config from targets.json
 * @returns {Array<{title, org, link, type, source, stipend?, deadline?}>}
 */
async function scrapeWithCheerio(config) {
  const ua = new UserAgent({ deviceCategory: 'desktop' });

  const { data } = await axios.get(config.url, {
    headers: {
      'User-Agent': ua.toString(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(data);

  // Try JSON-LD parsing first (Internshala embeds structured data)
  if (config.parseMode === 'jsonld') {
    const jsonldResults = parseJsonLD($, config);
    if (jsonldResults.length > 0) {
      console.log(`    → JSON-LD parsed ${jsonldResults.length} items`);
      return jsonldResults;
    }
    console.log('    → JSON-LD empty, falling back to CSS selectors');
  }

  // CSS selector-based parsing
  const results = [];
  const sel = config.selectors;

  $(sel.card).each((i, el) => {
    const $el = $(el);

    // Extract link — try the selector first, then look for closest <a>
    let linkHref = sel.link
      ? ($el.find(sel.link).attr('href') || $el.closest('a').attr('href'))
      : $el.closest('a').attr('href');

    if (!linkHref) return;

    // Normalize relative URLs
    const link = linkHref.startsWith('http')
      ? linkHref
      : new URL(linkHref, config.url).href;

    // Extract org — handle static values and selector-based extraction
    let org = '';
    if (sel.org) {
      if (typeof sel.org === 'object' && sel.org.static) {
        org = sel.org.static;
      } else {
        org = $el.find(sel.org).text().trim();
        // Clean up org text (remove extra whitespace, newlines)
        org = org.replace(/\s+/g, ' ').trim();
      }
    }

    const item = {
      title: $el.find(sel.title).text().trim(),
      org,
      link,
      type: config.type,
      source: config.name,
    };

    // Optional fields
    if (sel.stipend) {
      item.stipend = $el.find(sel.stipend).text().trim() || null;
    }
    if (sel.deadline) {
      item.deadline = $el.find(sel.deadline).text().trim() || null;
    }

    results.push(item);
  });

  return results.filter(r => r.title && r.link);
}

/**
 * Parse JSON-LD structured data from the page (e.g., Internshala's ItemList).
 */
function parseJsonLD($, config) {
  const results = [];

  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const json = JSON.parse($(el).html());

      // Look for ItemList schema (Internshala uses this)
      if (json['@type'] === 'ItemList' && json.itemListElement) {
        for (const item of json.itemListElement) {
          if (!item.name || !item.url) continue;
          results.push({
            title: item.name,
            org: '', // JSON-LD doesn't include org, but the URL contains it
            link: item.url.startsWith('http') ? item.url : new URL(item.url, config.url).href,
            type: config.type,
            source: config.name,
          });
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD blocks
    }
  });

  return results;
}

module.exports = { scrapeWithCheerio };
