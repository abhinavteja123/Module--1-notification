// run-all.js
// Main orchestrator: loads configs, dispatches scrapers, deduplicates, tags,
// enriches (optional), and writes output. Backwards-compatible with app/index.html.
//
// Usage:
//   node scraper/run-all.js              # full run, writes app/data.js
//   node scraper/run-all.js --dry-run    # fetch + log, no file writes

const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const { scrapeWithCheerio }   = require('./cheerio-scraper');
const { scrapeWithPlaywright } = require('./playwright-scraper');
const { scrapeRSS }            = require('./rss-scraper');
const { scrapeAPI }            = require('./api-scraper');
const { scrapeAllATS }         = require('./ats-scraper');

const targets    = require('./configs/targets.json');
const companies  = require('./configs/companies.json');

const DRY_RUN = process.argv.includes('--dry-run');
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

// ---- Scraper dispatcher ----

async function runScraper(config) {
  const start = Date.now();
  console.log(`  [START] ${config.name}`);
  try {
    let raw = [];
    switch (config.scraper) {
      case 'cheerio':    raw = await scrapeWithCheerio(config); break;
      case 'playwright': raw = await scrapeWithPlaywright(config); break;
      case 'rss':        raw = await scrapeRSS(config); break;
      case 'api':        raw = await scrapeAPI(config); break;
      default:
        console.log(`    ⚠ Unknown scraper type: ${config.scraper}`);
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [DONE]  ${config.name} → ${raw.length} items (${elapsed}s)`);
    return raw;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [FAIL]  ${config.name}: ${err.message} (${elapsed}s)`);
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

  // 3. Merge all results
  const all = [...targetResults.flat(), ...atsResults].filter(x => x.title && x.link);
  console.log(`\n── Total raw items: ${all.length} ──\n`);

  // 4. Deduplicate by normalized link
  const SEEN_FILE = path.join(__dirname, '..', 'app', 'seen-ids.json');
  let firstSeen = {};
  try { firstSeen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch { /* first run */ }
  const nowISO = new Date().toISOString();

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
    // Print a sample
    console.log('\n── Sample (first 5) ──');
    for (const it of unique.slice(0, 5)) {
      console.log(`  ${it.type.padEnd(12)} ${it.title.substring(0, 60)}`);
      console.log(`             ${it.org || '—'} · ${it.source}`);
      console.log(`             ${it.link}`);
    }
  } else {
    // Write data.js (backwards-compatible with app/index.html)
    const dataPath = path.join(__dirname, '..', 'app', 'data.js');
    const out =
      '// Auto-generated by scraper/run-all.js — do not edit by hand.\n' +
      `window.GENERATED_AT = ${JSON.stringify(nowISO)};\n` +
      `window.OPPORTUNITIES = ${JSON.stringify(unique, null, 2)};\n`;
    fs.writeFileSync(dataPath, out);

    // Update seen-ids registry (only IDs still live → no unbounded growth)
    const registry = {};
    for (const it of unique) registry[it.id] = it.firstSeenAt;
    fs.writeFileSync(SEEN_FILE, JSON.stringify(registry));

    console.log(`\n  Written to ${dataPath}`);
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
