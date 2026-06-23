// api-scraper.js
// Handles all free public JSON APIs — no selectors, no scraping, no blocking risk.
// Sources: Devpost, DoraHacks, Devfolio, Remotive, Arbeitnow, RemoteOK,
//          The Muse, Jobicy, Outreachy, LFX Mentorship, HN Jobs.

const axios = require('axios');
const pLimit = require('p-limit');

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };

function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(title);
}

function stripHtml(str = '') {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
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
      description: stripHtml(j.description || '').slice(0, 300),
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
      description: stripHtml(j.description || '').slice(0, 300),
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
        description: stripHtml(j.description || '').slice(0, 300),
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
      description: stripHtml(j.contents || '').slice(0, 300),
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
      deadline: null,
      description: stripHtml(j.jobDescription || '').slice(0, 300),
    })).filter(r => r.title && r.link);
  }

  // ---- DoraHacks ----
  if (config.apiFormat === 'dorahacks') {
    const list = data.data?.hackathons || data.hackathons || data.data || [];
    return (Array.isArray(list) ? list : []).map(h => tag({
      type: 'hackathon',
      title: h.title || h.name || '',
      org: h.organization?.name || h.organizer || 'DoraHacks',
      link: h.url || (h.id ? `https://dorahacks.io/hackathon/${h.id}` : ''),
      location: h.location || 'Online',
      tags: (h.tags || []).slice(0, 4),
      deadline: h.end_time || h.deadline || null,
      description: stripHtml(h.description || '').slice(0, 300),
    })).filter(r => r.title && r.link);
  }

  // ---- Devfolio (undocumented public API — graceful if shape changes) ----
  if (config.apiFormat === 'devfolio') {
    const now = Date.now();
    const list = (data.result || data.hackathons || data.data || (Array.isArray(data) ? data : []))
      .filter(h => !h.ends_at || new Date(h.ends_at).getTime() > now);
    return list.map(h => tag({
      type: 'hackathon',
      title: h.name || h.title || '',
      org: h.team?.name || h.organization || 'Devfolio',
      link: h.url || (h.slug ? `https://${h.slug}.devfolio.co` : ''),
      location: h.city || (h.is_online ? 'Online' : 'India'),
      tags: (h.themes || h.tags || []).slice(0, 4),
      deadline: h.ends_at || h.submission_deadline || null,
      description: stripHtml(h.desc || h.tagline || '').slice(0, 300),
    })).filter(r => r.title && r.link);
  }

  // ---- Outreachy ----
  if (config.apiFormat === 'outreachy') {
    const list = data.results || (Array.isArray(data) ? data : []);
    return list.map(p => tag({
      type: 'internship',
      title: p.project_name || p.title || '',
      org: p.community?.name || 'Outreachy',
      link: p.url || p.project_url || 'https://www.outreachy.org',
      location: 'Remote',
      tags: (p.skills || []).slice(0, 4).map(s => s.skill || s),
      deadline: p.intern_selection_deadline || p.deadline || null,
      description: p.short_description || '',
    })).filter(r => r.title && r.link);
  }

  // ---- LFX Mentorship ----
  if (config.apiFormat === 'lfx') {
    const list = data.data || (Array.isArray(data) ? data : []);
    return list.map(p => tag({
      type: 'internship',
      title: p.name || '',
      org: 'Linux Foundation (LFX)',
      link: p.programUrl || 'https://mentorship.lfx.linuxfoundation.org',
      location: 'Remote',
      tags: [],
      deadline: p.terms?.[0]?.applicationDeadline || null,
      description: stripHtml(p.description || '').slice(0, 300),
    })).filter(r => r.title && r.link);
  }

  // ---- Hacker News Jobs (YC startups — official Firebase API) ----
  if (config.apiFormat === 'hn') {
    const ids = (Array.isArray(data) ? data : []).slice(0, 30);
    const limit = pLimit(5);
    const items = await Promise.all(
      ids.map(id => limit(() =>
        axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 8000, headers: UA })
          .then(r => r.data)
          .catch(() => null)
      ))
    );
    return items
      .filter(it => it && it.title && it.url)
      .map(it => {
        // Title format: "Company (YC W23) Is Hiring Role" or "Company Is Hiring Role"
        const companyMatch = it.title.match(/^(.+?)\s+(?:\(YC\s+\w+\)\s+)?[Ii]s [Hh]iring/);
        const org = companyMatch ? companyMatch[1].trim() : it.by || 'YC Startup';
        const roleMatch = it.title.match(/[Ii]s [Hh]iring\s+(?:a\s+|an\s+)?(.+)$/);
        const title = roleMatch ? roleMatch[1].trim() : it.title;
        return tag({
          type: isIntern(title) ? 'internship' : 'job',
          title,
          org,
          link: it.url,
          location: 'Remote / USA',
          tags: [],
          description: stripHtml(it.text || '').slice(0, 300),
          deadline: null,
          postedAt: it.time ? new Date(it.time * 1000).toISOString() : null,
        });
      })
      .filter(r => r.title && r.link);
  }

  console.log(`    unknown apiFormat: ${config.apiFormat}`);
  return [];
}

module.exports = { scrapeAPI };
