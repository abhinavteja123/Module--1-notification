// rss-scraper.js
// Parse RSS/Atom feeds for hackathons, jobs, or research opportunities.

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

// Some RSS hosts (e.g. We Work Remotely) reject bot UAs — use browser-like one
const RSS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Scrape an RSS or Atom feed.
 * @param {object} config - target config from targets.json
 * @returns {Array<{title, org, link, type, source}>}
 */
async function scrapeRSS(config) {
  const { data } = await axios.get(config.url, {
    timeout: 10000,
    headers: {
      'User-Agent': RSS_UA,
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: true,
    htmlEntities: true,
    entityExpansionLimit: 5000,
  });
  const parsed = parser.parse(data);

  // Handle both RSS and Atom feed formats
  const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  const list = Array.isArray(items) ? items : [items];

  return list.map(item => {
    // Extract link — different in RSS vs Atom
    let link = '';
    if (typeof item.link === 'string') {
      link = item.link;
    } else if (item.link?.['@_href']) {
      link = item.link['@_href'];
    } else if (item.guid && typeof item.guid === 'string') {
      link = item.guid;
    } else if (item.guid?.['#text']) {
      link = item.guid['#text'];
    }

    // Extract title
    let title = '';
    if (typeof item.title === 'string') {
      title = item.title;
    } else if (item.title?.['#text']) {
      title = item.title['#text'];
    }

    // Extract author/org
    let org = '';
    if (item['dc:creator']) {
      org = item['dc:creator'];
    } else if (item.author?.name) {
      org = item.author.name;
    } else if (typeof item.author === 'string') {
      org = item.author;
    }

    return {
      title: title.trim(),
      org: org.trim(),
      link: link.trim(),
      type: config.type,
      source: config.name,
      deadline: null,
      stipend: null,
    };
  }).filter(r => r.title && r.link);
}

module.exports = { scrapeRSS };
