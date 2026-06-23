// run-all.js
// Main orchestrator: loads configs, dispatches scrapers, deduplicates, tags,
// enriches (optional), and writes output. Backwards-compatible with app/index.html.
//
// Usage:
//   node scraper/run-all.js              # full run, writes app/data.js
//   node scraper/run-all.js --dry-run    # fetch + log, no file writes

// Load .env for local dev (no-op in CI where secrets are injected via GitHub Secrets)
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const { scrapeWithCheerio }    = require('./cheerio-scraper');
const { scrapeWithPlaywright } = require('./playwright-scraper');
const { scrapeRSS }            = require('./rss-scraper');
const { scrapeAPI }            = require('./api-scraper');
const { scrapeAllATS }         = require('./ats-scraper');
const { scrapeLinkedIn }       = require('./linkedin-scraper');
const { scrapeWithFirecrawl }  = require('./firecrawl-scraper');

const targets    = require('./configs/targets.json');
const companies  = require('./configs/companies.json');

const DRY_RUN  = process.argv.includes('--dry-run');
const API_ONLY = process.argv.includes('--api-only'); // skip playwright/cheerio/firecrawl scrapers
const limit = pLimit(3); // max 3 concurrent scrapers

// ---- Relevance tagging (from existing MVP) ----

const TECH_RE = /\b(software|developer|engineer(ing)?|sde|programmer|backend|back[- ]?end|frontend|front[- ]?end|full[- ]?stack|web|mobile|android|ios|data|machine learning|\bml\b|\bai\b|deep learning|devops|cloud|computer|\bit\b|qa|test|security|cyber|blockchain|embedded|firmware|python|java(script)?|react|node|golang|\bc\+\+|database|sql|api|platform|systems?|technical|tech)\b/i;

const INDIA_RE = /\b(india|indian|bengaluru|bangalore|mumbai|delhi|new delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad|jaipur|coimbatore|kochi|chandigarh|remote[- ]?india)\b/i;

function isBtech(title = '', tags = []) {
  return TECH_RE.test(title) || (tags || []).some(t => TECH_RE.test(t));
}
function isIndia(location = '') {
  return INDIA_RE.test(location);
}

// ---- Source health tracking ----
const sourceHealth = {}; // { sourceName: { count, ok, error } }

function recordHealth(name, count, error = null) {
  sourceHealth[name] = { count, ok: !error, error: error || null, ts: new Date().toISOString() };
}

// ---- Scraper dispatcher ----

const HEAVY_SCRAPERS = new Set(['cheerio', 'playwright', 'firecrawl']);

async function runScraper(config) {
  // --api-only: skip web scrapers, run only api/rss/ats sources
  if (API_ONLY && HEAVY_SCRAPERS.has(config.scraper)) {
    console.log(`  [SKIP]  ${config.name} (api-only mode)`);
    return [];
  }
  const start = Date.now();
  console.log(`  [START] ${config.name}`);
  try {
    let raw = [];
    switch (config.scraper) {
      case 'cheerio':    raw = await scrapeWithCheerio(config); break;
      case 'playwright': raw = await scrapeWithPlaywright(config); break;
      case 'rss':        raw = await scrapeRSS(config); break;
      case 'api':        raw = await scrapeAPI(config); break;
      case 'firecrawl':  raw = await scrapeWithFirecrawl(config); break;
      default:
        console.log(`    ⚠ Unknown scraper type: ${config.scraper}`);
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [DONE]  ${config.name} → ${raw.length} items (${elapsed}s)`);
    recordHealth(config.name, raw.length);
    return raw;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [FAIL]  ${config.name}: ${err.message} (${elapsed}s)`);
    recordHealth(config.name, 0, err.message);
    return [];
  }
}

// ---- Main orchestration ----

async function main() {
  const totalStart = Date.now();
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Student Notification Scraper — Full Run');
  console.log(`  ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('  MODE: dry-run (no file writes)');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Run all configured scrapers (targets.json)
  console.log('── Phase 1: Configured targets ──');
  const enabled = targets.filter(c => c.enabled !== false);
  const targetResults = await Promise.all(
    enabled.map(c => limit(() => runScraper(c)))
  );

  // 2. Run ATS scrapers (companies.json)
  console.log('\n── Phase 2: ATS company boards ──');
  const atsResults = await scrapeAllATS(companies);

  // 3. LinkedIn (optional — skips gracefully if package not installed or blocked)
  console.log('\n── Phase 3: LinkedIn ──');
  const linkedInResults = await scrapeLinkedIn().catch(() => []);

  // 4. Merge all results
  const all = [...targetResults.flat(), ...atsResults, ...linkedInResults].filter(x => x.title && x.link);
  console.log(`\n── Total raw items: ${all.length} ──\n`);

  // 4. Deduplicate by normalized link
  const SEEN_FILE = path.join(__dirname, '..', 'app', 'seen-ids.json');
  let firstSeen = {};
  try {
    firstSeen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`  [WARN] seen-ids.json corrupt (${err.message}) — starting fresh`);
  }
  const nowISO = new Date().toISOString();
  // 90-day TTL: drop entries older than 90 days to prevent re-notification of stale items
  const TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TTL_MS;
  for (const [id, ts] of Object.entries(firstSeen)) {
    if (Date.parse(ts) < cutoff) delete firstSeen[id];
  }

  const dedup = new Set();
  const unique = [];
  const newItems = [];

  for (const item of all) {
    const key = item.link.split('?')[0].replace(/\/+$/, ''); // normalize
    if (dedup.has(key)) continue;
    dedup.add(key);

    item.id = key;
    item.btech = item.type === 'hackathon' ? true : isBtech(item.title, item.tags);
    item.india = isIndia(item.location || '');

    if (firstSeen[key]) {
      item.firstSeenAt = firstSeen[key];
    } else {
      item.firstSeenAt = nowISO;
      item.isNew = true;
      newItems.push(item);
    }

    unique.push(item);
  }

  // 5. Optional: Groq enrichment for new items (if GROQ_API_KEY is set)
  if (process.env.GROQ_API_KEY && newItems.length > 0) {
    try {
      const enricherPath = path.join(__dirname, '..', 'app', 'groq-enricher.js');
      if (fs.existsSync(enricherPath)) {
        const { enrichNewItems } = require(enricherPath);
        await enrichNewItems(newItems);
      }
    } catch (err) {
      console.log(`  Groq enrichment failed: ${err.message}`);
    }
  }

  // 6. Sort: newly discovered first, then by posted date
  unique.sort((a, b) =>
    (Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt)) ||
    ((Date.parse(b.postedAt || 0) || 0) - (Date.parse(a.postedAt || 0) || 0))
  );

  // Stats
  const btech = unique.filter(x => x.btech).length;
  const india = unique.filter(x => x.india).length;
  const hackathons = unique.filter(x => x.type === 'hackathon').length;
  const internships = unique.filter(x => x.type === 'internship').length;
  const jobs = unique.filter(x => x.type === 'job').length;

  console.log('── Results ──');
  console.log(`  ${unique.length} unique listings (${newItems.length} NEW this run)`);
  console.log(`  ${hackathons} hackathons · ${internships} internships · ${jobs} jobs`);
  console.log(`  ${btech} B.Tech-relevant · ${india} India`);

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Skipping file writes.');
    console.log('\n── Sample (first 5) ──');
    for (const it of unique.slice(0, 5)) {
      console.log(`  ${it.type.padEnd(12)} ${it.title.substring(0, 60)}`);
      console.log(`             ${it.org || '—'} · ${it.source}`);
      console.log(`             ${it.link}`);
    }
  } else {
    // Zero-result guard: never overwrite good data with an empty run
    const PREV_DATA_PATH = path.join(__dirname, '..', 'app', 'data.js');
    let prevCount = 0;
    try {
      const prev = fs.readFileSync(PREV_DATA_PATH, 'utf8');
      const m = prev.match(/window\.OPPORTUNITIES\s*=\s*(\[[\s\S]*?\]);/);
      if (m) prevCount = JSON.parse(m[1]).length;
    } catch { /* no previous file */ }

    if (unique.length === 0) {
      console.error('  [ABORT] Zero items collected — skipping all writes to protect existing data.');
      process.exit(0);
    }
    if (prevCount > 20 && unique.length < prevCount * 0.4) {
      console.warn(`  [WARN] Collected ${unique.length} items vs previous ${prevCount} (>60% drop). Writing anyway but check sources.`);
    }

    // Write data.js — atomic via temp file
    const dataPath = path.join(__dirname, '..', 'app', 'data.js');
    const out =
      '// Auto-generated by scraper/run-all.js — do not edit by hand.\n' +
      `window.GENERATED_AT = ${JSON.stringify(nowISO)};\n` +
      `window.OPPORTUNITIES = ${JSON.stringify(unique, null, 2)};\n`;
    fs.writeFileSync(dataPath + '.tmp', out);
    fs.renameSync(dataPath + '.tmp', dataPath);

    // Update seen-ids registry with 90-day TTL (retain all entries still in TTL window)
    const registry = { ...firstSeen };
    for (const it of unique) registry[it.id] = it.firstSeenAt;
    fs.writeFileSync(SEEN_FILE + '.tmp', JSON.stringify(registry));
    fs.renameSync(SEEN_FILE + '.tmp', SEEN_FILE);

    // Write source health JSON for dashboard/monitoring
    const healthPath = path.join(__dirname, '..', 'app', 'sources-health.json');
    const healthOut = { updatedAt: nowISO, totalItems: unique.length, newItems: newItems.length, sources: sourceHealth };
    fs.writeFileSync(healthPath + '.tmp', JSON.stringify(healthOut, null, 2));
    fs.renameSync(healthPath + '.tmp', healthPath);

    console.log(`\n  Written: ${unique.length} items (${newItems.length} new)`);
    console.log('  Open app/index.html in your browser to see results.');
  }

  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`\n  Total time: ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
