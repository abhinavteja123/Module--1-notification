// ats-scraper.js
// Public ATS job-board APIs — the "any company" engine.
// Add a company slug to companies.json and get all their open roles as structured JSON.
// No CSS selectors needed, no scraping — these are official public APIs.

const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const pLimit = require('p-limit');

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };

// Retry on network errors and 429/5xx — exponential backoff, max 3 attempts
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: err =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    (err.response?.status === 429) ||
    (err.response?.status >= 500),
  onRetry: (count, err, config) => {
    console.log(`    retry #${count} ${config.url}: ${err.message}`);
  },
});

function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(title);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Scrape a single company's ATS job board.
 * Supports: greenhouse, lever, ashby, workable, recruitee
 */
async function scrapeATSCompany(company, ats) {
  let url, mapper;

  if (ats === 'greenhouse') {
    url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;
    mapper = data => (data.jobs || []).map(j => ({
      title: j.title,
      org: capitalize(company),
      link: j.absolute_url,
      location: j.location?.name || 'Unknown',
      description: '',
      deadline: null,
    }));
  } else if (ats === 'lever') {
    url = `https://api.lever.co/v0/postings/${company}?mode=json`;
    mapper = data => (Array.isArray(data) ? data : []).map(j => ({
      title: j.text,
      org: capitalize(company),
      link: j.hostedUrl,
      location: j.categories?.location || 'Unknown',
      description: j.descriptionPlain ? j.descriptionPlain.slice(0, 300) : '',
      deadline: null,
    }));
  } else if (ats === 'ashby') {
    url = `https://api.ashbyhq.com/posting-api/job-board/${company}`;
    mapper = data => (data.jobs || []).map(j => ({
      title: j.title,
      org: capitalize(company),
      link: j.jobUrl,
      location: j.location || 'Unknown',
      description: j.descriptionSocial || '',
      deadline: null,
    }));
  } else if (ats === 'workable') {
    url = `https://apply.workable.com/api/v1/widget/accounts/${company}/jobs`;
    mapper = data => (data.results || []).map(j => ({
      title: j.title,
      org: capitalize(company.replace(/-/g, ' ')),
      link: `https://apply.workable.com/${company}/j/${j.shortcode}`,
      location: j.city ? `${j.city}, ${j.country || ''}`.trim().replace(/,$/, '') : 'Remote',
      description: '',
      deadline: null,
    }));
  } else if (ats === 'recruitee') {
    url = `https://${company}.recruitee.com/api/offers/`;
    mapper = data => (data.offers || []).map(j => ({
      title: j.title,
      org: capitalize(company.replace(/-/g, ' ')),
      link: j.careers_url || `https://${company}.recruitee.com/o/${j.slug}`,
      location: j.city ? `${j.city}, ${j.country || ''}`.trim().replace(/,$/, '') : 'Remote',
      description: '',
      deadline: null,
    }));
  } else {
    return [];
  }

  const { data } = await axios.get(url, { timeout: 12000, headers: UA });

  return mapper(data)
    .filter(r => r.title && r.link)
    .map(r => ({
      ...r,
      type: isIntern(r.title) ? 'internship' : 'job',
      source: `${capitalize(company)} (${capitalize(ats)})`,
    }));
}

/**
 * Scrape all companies from companies.json.
 * @param {object} companiesConfig - { greenhouse: [...slugs], lever: [...], ashby: [...] }
 * @returns {Array}
 */
async function scrapeAllATS(companiesConfig) {
  const globalLimit = pLimit(8); // max 8 total concurrent
  // Per-host limit: max 2 concurrent requests per ATS provider (avoids 429 floods)
  const hostLimits = {};
  const tasks = [];
  const healthCounts = {};

  for (const [ats, companies] of Object.entries(companiesConfig)) {
    hostLimits[ats] = hostLimits[ats] || pLimit(2);
    healthCounts[ats] = { ok: 0, fail: 0, items: 0 };

    for (const company of companies) {
      const hostLimit = hostLimits[ats];
      tasks.push(globalLimit(() => hostLimit(async () => {
        try {
          const items = await scrapeATSCompany(company, ats);
          console.log(`    ok   ${company} (${ats}) → ${items.length} jobs`);
          healthCounts[ats].ok++;
          healthCounts[ats].items += items.length;
          return items;
        } catch (err) {
          const status = err.response?.status;
          if (status === 429) {
            console.log(`    RATE-LIMIT ${company} (${ats}): 429`);
          } else {
            console.log(`    FAIL ${company} (${ats}): ${err.message}`);
          }
          healthCounts[ats].fail++;
          return [];
        }
      })));
    }
  }

  const results = await Promise.all(tasks);

  // Log per-provider summary
  for (const [ats, counts] of Object.entries(healthCounts)) {
    console.log(`  ATS ${ats}: ${counts.ok} ok / ${counts.fail} fail / ${counts.items} jobs`);
  }

  return results.flat();
}

module.exports = { scrapeATSCompany, scrapeAllATS };
