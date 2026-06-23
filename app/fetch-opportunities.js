// fetch-opportunities.js
// Pulls hackathons / internships / jobs from FREE, no-key JSON sources,
// normalizes + dedupes, tags B.Tech-relevance + India, writes data.js.
// Run:  node fetch-opportunities.js   (needs Node 18+ for built-in fetch)

const fs = require('fs');
const path = require('path');
const { enrichWithDetails } = require('./detail-enricher');
const { enrichNewItems } = require('./groq-enricher');

// Companies whose careers run on Greenhouse ATS — add more slugs to grow job coverage.
// Find the slug from a careers URL like boards.greenhouse.io/<slug>
const GREENHOUSE_COMPANIES = ['postman', 'gitlab', 'discord', 'figma'];

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };

async function getJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Relevance tagging for B.Tech students ----

const TECH_RE = /\b(software|developer|engineer(ing)?|sde|programmer|backend|back[- ]?end|frontend|front[- ]?end|full[- ]?stack|web|mobile|android|ios|data|machine learning|\bml\b|\bai\b|deep learning|devops|cloud|computer|\bit\b|qa|test|security|cyber|blockchain|embedded|firmware|python|java(script)?|react|node|golang|\bc\+\+|database|sql|api|platform|systems?|technical|tech)\b/i;

const INDIA_RE = /\b(india|indian|bengaluru|bangalore|mumbai|delhi|new delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad|jaipur|coimbatore|kochi|chandigarh|remote[- ]?india)\b/i;

function isBtech(title = '', tags = []) {
  return TECH_RE.test(title) || tags.some(t => TECH_RE.test(t));
}
function isIndia(location = '') {
  return INDIA_RE.test(location);
}
function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice)\b/i.test(title);
}

// ---- Source adapters: each returns an array of partially-normalized items ----

async function fromDevpost() {
  const data = await getJSON('https://devpost.com/api/hackathons');
  return (data.hackathons || []).map(h => ({
    type: 'hackathon',
    title: h.title,
    org: h.organization_name || 'Devpost',
    link: h.url,
    location: h.displayed_location?.location || 'Online',
    tags: (h.themes || []).map(t => t.name).slice(0, 4),
    postedAt: null,
    source: 'Devpost',
  }));
}

async function fromRemotive() {
  const data = await getJSON('https://remotive.com/api/remote-jobs?category=software-dev&limit=100');
  return (data.jobs || []).map(j => ({
    type: isIntern(j.title) ? 'internship' : 'job',
    title: j.title,
    org: j.company_name,
    link: j.url,
    location: j.candidate_required_location || 'Remote',
    tags: (j.tags || []).slice(0, 4),
    postedAt: j.publication_date || null,
    source: 'Remotive',
  }));
}

async function fromArbeitnow() {
  const data = await getJSON('https://www.arbeitnow.com/api/job-board-api');
  return (data.data || []).map(j => ({
    type: isIntern(j.title) ? 'internship' : 'job',
    title: j.title,
    org: j.company_name,
    link: j.url,
    location: j.location || 'Remote',
    tags: (j.tags || []).slice(0, 4),
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    source: 'Arbeitnow',
  }));
}

// The Muse — categorized + level-tagged, great for entry-level / internship B.Tech roles.
async function fromTheMuse() {
  const cats = ['category=Software Engineering', 'category=Data Science',
                'category=Computer and IT', 'category=Engineering'].join('&');
  const levels = ['level=Entry Level', 'level=Internship'].join('&');
  const out = [];
  for (const page of [1, 2]) {
    const url = `https://www.themuse.com/api/public/jobs?${cats}&${levels}&page=${page}`;
    const data = await getJSON(encodeURI(url));
    for (const j of (data.results || [])) {
      out.push({
        type: (j.levels || []).some(l => /intern/i.test(l.name)) ? 'internship' : 'job',
        title: j.name,
        org: j.company?.name || 'Unknown',
        link: j.refs?.landing_page,
        location: (j.locations || []).map(l => l.name).join(', ') || 'Flexible',
        tags: (j.categories || []).map(c => c.name).slice(0, 3),
        postedAt: j.publication_date || null,
        source: 'The Muse',
      });
    }
  }
  return out;
}

// Jobicy — remote jobs, no key.
async function fromJobicy() {
  const data = await getJSON('https://jobicy.com/api/v2/remote-jobs?count=50&tag=dev');
  return (data.jobs || []).map(j => ({
    type: isIntern(j.jobTitle) ? 'internship' : 'job',
    title: j.jobTitle,
    org: j.companyName,
    link: j.url,
    location: j.jobGeo || 'Remote',
    tags: Array.isArray(j.jobIndustry) ? j.jobIndustry.slice(0, 3) : [],
    postedAt: j.pubDate || null,
    source: 'Jobicy',
  }));
}

// RemoteOK — array; first element is metadata.
async function fromRemoteOK() {
  const data = await getJSON('https://remoteok.com/api');
  return (Array.isArray(data) ? data : []).filter(j => j.position && j.url).map(j => ({
    type: isIntern(j.position) ? 'internship' : 'job',
    title: j.position,
    org: j.company,
    link: j.url,
    location: j.location || 'Remote',
    tags: (j.tags || []).slice(0, 4),
    postedAt: j.date || null,
    source: 'RemoteOK',
  }));
}

async function fromGreenhouse(company) {
  const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs`);
  return (data.jobs || []).map(j => ({
    type: isIntern(j.title) ? 'internship' : 'job',
    title: j.title,
    org: company.charAt(0).toUpperCase() + company.slice(1),
    link: j.absolute_url,
    location: j.location?.name || 'Unknown',
    tags: [],
    postedAt: j.updated_at || null,
    source: `${company} (Greenhouse)`,
  }));
}

// ---- Orchestrate ----

async function safe(label, fn) {
  try {
    const items = await fn();
    console.log(`  ok   ${label} -> ${items.length}`);
    return items;
  } catch (err) {
    console.log(`  FAIL ${label}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('Fetching free sources...');

  const groups = await Promise.all([
    safe('Devpost hackathons', fromDevpost),
    safe('Remotive jobs', fromRemotive),
    safe('Arbeitnow jobs', fromArbeitnow),
    safe('The Muse jobs', fromTheMuse),
    safe('Jobicy jobs', fromJobicy),
    safe('RemoteOK jobs', fromRemoteOK),
    ...GREENHOUSE_COMPANIES.map(c => safe(`Greenhouse ${c}`, () => fromGreenhouse(c))),
  ]);

  const all = groups.flat().filter(x => x.title && x.link);

  // Persistent registry: which ids we've seen before, with first-seen timestamp.
  const SEEN_FILE = path.join(__dirname, 'seen-ids.json');
  let firstSeen = {};
  try { firstSeen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch { /* first run */ }
  const nowISO = new Date().toISOString();

  // Dedupe by link, tag relevance, detect genuinely NEW items across runs
  const dedup = new Set();
  const unique = [];
  const newItems = [];
  for (const item of all) {
    const key = item.link.split('?')[0];
    if (dedup.has(key)) continue;
    dedup.add(key);
    item.id = key;
    item.btech = item.type === 'hackathon' ? true : isBtech(item.title, item.tags);
    item.india = isIndia(item.location);
    if (firstSeen[key]) {
      item.firstSeenAt = firstSeen[key];
    } else {
      item.firstSeenAt = nowISO;
      item.isNew = true;
      newItems.push(item);
    }
    unique.push(item);
  }

  // Deep "LLM scraping" (Jina page text -> Groq) for new + B.Tech items (capped).
  await enrichWithDetails(newItems);
  // Light metadata Groq for any remaining new items not already enriched above.
  await enrichNewItems(newItems);

  // Save registry (only ids still live this run → no unbounded growth)
  const registry = {};
  for (const it of unique) registry[it.id] = it.firstSeenAt;
  fs.writeFileSync(SEEN_FILE, JSON.stringify(registry));

  // Sort: newly discovered first, then by posted date
  unique.sort((a, b) =>
    (Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt)) ||
    ((Date.parse(b.postedAt || 0) || 0) - (Date.parse(a.postedAt || 0) || 0)));

  const out =
    '// Auto-generated by fetch-opportunities.js — do not edit by hand.\n' +
    `window.GENERATED_AT = ${JSON.stringify(nowISO)};\n` +
    `window.OPPORTUNITIES = ${JSON.stringify(unique, null, 2)};\n`;

  fs.writeFileSync(path.join(__dirname, 'data.js'), out);
  const btech = unique.filter(x => x.btech).length;
  const india = unique.filter(x => x.india).length;
  console.log(`\nDone. ${unique.length} unique, ${newItems.length} NEW this run ` +
    `(${btech} B.Tech-relevant, ${india} India) -> data.js`);
  console.log('Open index.html in your browser.');
}

main();
