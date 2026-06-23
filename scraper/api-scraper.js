// api-scraper.js
// Fetches from free, public JSON APIs (no scraping, no keys needed).
// Sources: Devpost, Remotive, Arbeitnow, RemoteOK, The Muse, Jobicy.

const axios = require('axios');

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };

function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(title);
}

/**
 * Scrape a free job/hackathon API.
 * @param {object} config - target config from targets.json
 * @returns {Array<{title, org, link, type, source, ...}>}
 */
async function scrapeAPI(config) {
  const { data } = await axios.get(config.url, {
    timeout: 15000,
    headers: UA,
  });

  const tag = (r) => ({ ...r, type: r.type || config.type, source: config.name });

  // ---- Devpost ----
  if (config.apiFormat === 'devpost') {
    return (data.hackathons || []).map(h => tag({
      type: 'hackathon',
      title: h.title,
      org: h.organization_name || 'Devpost',
      link: h.url,
      location: h.displayed_location?.location || 'Online',
      tags: (h.themes || []).map(t => t.name).slice(0, 4),
      deadline: h.submission_period_dates || null,
      stipend: (h.prize_amount || '').replace(/<[^>]+>/g, '').trim() || null,
      is_remote: /online/i.test(h.displayed_location?.location || ''),
    })).filter(r => r.title && r.link);
  }

  // ---- Remotive ----
  if (config.apiFormat === 'remotive') {
    return (data.jobs || []).map(j => tag({
      type: isIntern(j.title) ? 'internship' : 'job',
      title: j.title,
      org: j.company_name,
      link: j.url,
      location: j.candidate_required_location || 'Remote',
      tags: (j.tags || []).slice(0, 4),
      is_remote: true,
    })).filter(r => r.title && r.link);
  }

  // ---- Arbeitnow ----
  if (config.apiFormat === 'arbeitnow') {
    return (data.data || []).map(j => tag({
      type: isIntern(j.title) ? 'internship' : 'job',
      title: j.title,
      org: j.company_name,
      link: j.url,
      location: j.location || 'Remote',
      tags: (j.tags || []).slice(0, 4),
      is_remote: !!j.remote,
    })).filter(r => r.title && r.link);
  }

  // ---- RemoteOK ----
  if (config.apiFormat === 'remoteok') {
    return (Array.isArray(data) ? data : [])
      .filter(j => j.position && j.url)
      .map(j => tag({
        type: isIntern(j.position) ? 'internship' : 'job',
        title: j.position,
        org: j.company,
        link: j.url,
        location: j.location || 'Remote',
        tags: (j.tags || []).slice(0, 4),
        is_remote: true,
      }));
  }

  // ---- The Muse ----
  if (config.apiFormat === 'themuse') {
    return (data.results || []).map(j => tag({
      type: (j.levels || []).some(l => /intern/i.test(l.name)) ? 'internship' : 'job',
      title: j.name,
      org: j.company?.name || 'Unknown',
      link: j.refs?.landing_page,
      location: (j.locations || []).map(l => l.name).join(', ') || 'Flexible',
      tags: (j.categories || []).map(c => c.name).slice(0, 3),
    })).filter(r => r.title && r.link);
  }

  // ---- Jobicy ----
  if (config.apiFormat === 'jobicy') {
    return (data.jobs || []).map(j => tag({
      type: isIntern(j.jobTitle) ? 'internship' : 'job',
      title: j.jobTitle,
      org: j.companyName,
      link: j.url,
      location: j.jobGeo || 'Remote',
      tags: Array.isArray(j.jobIndustry) ? j.jobIndustry.slice(0, 3) : [],
    })).filter(r => r.title && r.link);
  }

  console.log(`    ⚠ Unknown apiFormat: ${config.apiFormat}`);
  return [];
}

module.exports = { scrapeAPI };
