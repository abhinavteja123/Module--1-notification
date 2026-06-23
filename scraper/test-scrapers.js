// test-scrapers.js
// Test harness to run individual scrapers and verify they return data.
//
// Usage:
//   node scraper/test-scrapers.js --target=hackerearth
//   node scraper/test-scrapers.js --target=internshala
//   node scraper/test-scrapers.js --target=devfolio
//   node scraper/test-scrapers.js --target=unstop
//   node scraper/test-scrapers.js --target=devpost
//   node scraper/test-scrapers.js --target=ats
//   node scraper/test-scrapers.js --all

const { scrapeWithCheerio }   = require('./cheerio-scraper');
const { scrapeWithPlaywright } = require('./playwright-scraper');
const { scrapeAPI }            = require('./api-scraper');
const { scrapeAllATS }         = require('./ats-scraper');

const targets   = require('./configs/targets.json');
const companies = require('./configs/companies.json');

const args = process.argv.slice(2);
const targetFlag = args.find(a => a.startsWith('--target='));
const target = targetFlag ? targetFlag.split('=')[1].toLowerCase() : null;
const runAll = args.includes('--all');

function printResults(name, results) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}: ${results.length} items`);
  console.log(`${'─'.repeat(60)}`);
  for (const r of results.slice(0, 5)) {
    console.log(`  [${r.type}] ${r.title}`);
    console.log(`    org: ${r.org || '—'} | source: ${r.source}`);
    console.log(`    link: ${r.link}`);
    if (r.location) console.log(`    location: ${r.location}`);
    if (r.stipend) console.log(`    stipend: ${r.stipend}`);
    console.log();
  }
  if (results.length > 5) {
    console.log(`  ... and ${results.length - 5} more`);
  }
  if (results.length === 0) {
    console.log('  ⚠ No results — selectors may need updating');
  }
}

async function testTarget(name) {
  const config = targets.find(t => t.name.toLowerCase().includes(name));
  if (!config) {
    console.log(`  ⚠ No target found matching "${name}"`);
    console.log(`  Available: ${targets.map(t => t.name).join(', ')}`);
    return;
  }

  console.log(`\nTesting: ${config.name} (${config.scraper})`);

  let results = [];
  try {
    switch (config.scraper) {
      case 'cheerio':    results = await scrapeWithCheerio(config); break;
      case 'playwright': results = await scrapeWithPlaywright(config); break;
      case 'api':        results = await scrapeAPI(config); break;
      case 'rss':        results = await require('./rss-scraper').scrapeRSS(config); break;
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return;
  }

  printResults(config.name, results);
}

async function testATS() {
  console.log('\nTesting: ATS scrapers (Greenhouse / Lever / Ashby)');
  const results = await scrapeAllATS(companies);
  printResults('ATS Companies', results);
}

async function main() {
  if (!target && !runAll) {
    console.log('Usage:');
    console.log('  node scraper/test-scrapers.js --target=hackerearth');
    console.log('  node scraper/test-scrapers.js --target=internshala');
    console.log('  node scraper/test-scrapers.js --target=devfolio');
    console.log('  node scraper/test-scrapers.js --target=unstop');
    console.log('  node scraper/test-scrapers.js --target=devpost');
    console.log('  node scraper/test-scrapers.js --target=remotive');
    console.log('  node scraper/test-scrapers.js --target=ats');
    console.log('  node scraper/test-scrapers.js --all');
    process.exit(0);
  }

  if (runAll) {
    // Test all targets
    for (const config of targets) {
      await testTarget(config.name.toLowerCase());
    }
    await testATS();
  } else if (target === 'ats') {
    await testATS();
  } else {
    await testTarget(target);
  }
}

main().catch(console.error);
