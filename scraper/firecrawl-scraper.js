// firecrawl-scraper.js
// Uses Firecrawl API to scrape JS-rendered / Cloudflare-protected pages.
// Handles sites that block Playwright/Cheerio on GitHub Actions (Internshala, Naukri, etc.)
// Requires: FIRECRAWL_API_KEY env var (free at https://firecrawl.dev — 500 credits/month)
// If key is missing, returns [] gracefully so other sources still run.

const axios = require('axios');

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

// JSON extraction schemas per site — tells Firecrawl what fields to pull out
const SCHEMAS = {
  internshala: {
    type: 'object',
    properties: {
      internships: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title:    { type: 'string', description: 'Internship role/title' },
            org:      { type: 'string', description: 'Company or organization name' },
            link:     { type: 'string', description: 'Full URL to the internship detail page' },
            location: { type: 'string', description: 'City or Remote' },
            stipend:  { type: 'string', description: 'Monthly stipend amount' },
            deadline: { type: 'string', description: 'Last date to apply' },
          },
          required: ['title', 'org'],
        },
      },
    },
  },

  naukri: {
    type: 'object',
    properties: {
      jobs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title:    { type: 'string', description: 'Job title' },
            org:      { type: 'string', description: 'Company name' },
            link:     { type: 'string', description: 'Job detail page URL' },
            location: { type: 'string', description: 'City' },
            experience: { type: 'string', description: 'Required experience (e.g. Fresher, 0-1 yrs)' },
          },
          required: ['title', 'org'],
        },
      },
    },
  },
};

// Per-site normalization: extracted JSON → standard listing shape
const PARSERS = {
  internshala: (data, config) => {
    const list = data?.internships || [];
    return list.map(it => ({
      title:    it.title || '',
      org:      it.org || 'Internshala',
      link:     it.link?.startsWith('http') ? it.link : `https://internshala.com${it.link || ''}`,
      location: it.location || 'India',
      stipend:  it.stipend || null,
      deadline: it.deadline || null,
      type:     'internship',
      source:   config.name,
      india:    true,
      description: '',
    })).filter(r => r.title && r.link);
  },

  naukri: (data, config) => {
    const list = data?.jobs || [];
    return list.map(it => ({
      title:    it.title || '',
      org:      it.org || 'Naukri',
      link:     it.link?.startsWith('http') ? it.link : `https://www.naukri.com${it.link || ''}`,
      location: it.location || 'India',
      type:     'job',
      source:   config.name,
      india:    true,
      description: it.experience ? `Experience: ${it.experience}` : '',
    })).filter(r => r.title && r.link);
  },
};

/**
 * Scrape a page using Firecrawl's LLM-powered JSON extraction.
 * @param {object} config - target config from targets.json (scraper: "firecrawl")
 * @returns {Array<{title, org, link, location, type, source, india, deadline, stipend, description}>}
 */
async function scrapeWithFirecrawl(config) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.log(`  (Firecrawl skipped for ${config.name}: no FIRECRAWL_API_KEY set)`);
    return [];
  }

  const schemaKey = config.firecrawlSchema || config.name.toLowerCase().replace(/\s+\S+/g, '').trim();
  const schema = SCHEMAS[schemaKey];
  if (!schema) {
    console.log(`  (Firecrawl: no schema for "${schemaKey}")`);
    return [];
  }

  const parser = PARSERS[schemaKey];

  const { data: resp } = await axios.post(
    `${FIRECRAWL_BASE}/scrape`,
    {
      url: config.url,
      formats: ['extract'],
      extract: { schema },
      waitFor: config.waitFor || 2000,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    },
  );

  if (!resp.success) {
    throw new Error(`Firecrawl error: ${JSON.stringify(resp).slice(0, 200)}`);
  }

  const extracted = resp.data?.extract || resp.extract || {};
  return parser(extracted, config);
}

module.exports = { scrapeWithFirecrawl };
