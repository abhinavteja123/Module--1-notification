// ats-scraper.js
// Public ATS job-board APIs — the "any company" engine.
// Add a company slug to companies.json and get all their open roles as structured JSON.
// No CSS selectors needed, no scraping — these are official public APIs.

const axios = require('axios');

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };

function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(title);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Scrape a single company's ATS job board.
 * @param {string} company - company slug (e.g. 'razorpay')
 * @param {'greenhouse'|'lever'|'ashby'} ats - ATS platform
 * @returns {Array<{title, org, link, type, source, location}>}
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
    }));
  } else if (ats === 'lever') {
    url = `https://api.lever.co/v0/postings/${company}?mode=json`;
    mapper = data => (Array.isArray(data) ? data : []).map(j => ({
      title: j.text,
      org: capitalize(company),
      link: j.hostedUrl,
      location: j.categories?.location || 'Unknown',
    }));
  } else if (ats === 'ashby') {
    url = `https://api.ashbyhq.com/posting-api/job-board/${company}`;
    mapper = data => (data.jobs || []).map(j => ({
      title: j.title,
      org: capitalize(company),
      link: j.jobUrl,
      location: j.location || 'Unknown',
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
  const results = [];

  for (const [ats, companies] of Object.entries(companiesConfig)) {
    for (const company of companies) {
      try {
        const items = await scrapeATSCompany(company, ats);
        console.log(`    ok   ${company} (${ats}) → ${items.length} jobs`);
        results.push(...items);
      } catch (err) {
        console.log(`    FAIL ${company} (${ats}): ${err.message}`);
      }
    }
  }

  return results;
}

module.exports = { scrapeATSCompany, scrapeAllATS };
