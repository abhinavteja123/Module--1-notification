// linkedin-scraper.js
// Uses linkedin-jobs-api npm package (lightweight public scraper, no auth required).
// Optional — runs only if the package is installed: npm i linkedin-jobs-api
// Returns same normalized shape as other scrapers.

const QUERIES = [
  { keyword: 'software engineer intern', location: 'India' },
  { keyword: 'SDE intern', location: 'India' },
  { keyword: 'machine learning intern', location: 'India' },
  { keyword: 'data science intern', location: 'India' },
  { keyword: 'software developer fresher', location: 'India' },
];

function isIntern(title = '') {
  return /\b(intern|internship|trainee|apprentice|fresher)\b/i.test(title);
}

async function scrapeLinkedIn() {
  let linkedIn;
  try {
    linkedIn = require('linkedin-jobs-api');
  } catch {
    console.log('  linkedin-jobs-api not installed — skip (npm i linkedin-jobs-api to enable)');
    return [];
  }

  const results = [];
  const seen = new Set();

  for (const q of QUERIES) {
    try {
      const jobs = await linkedIn.query({
        keyword: q.keyword,
        location: q.location,
        dateSincePosted: 'past month',
        jobType: 'internship',
        remoteFilter: '',
        salary: '',
        experienceLevel: 'internship',
        limit: '25',
      });

      for (const j of (jobs || [])) {
        const link = j.jobUrl || j.link || '';
        if (!link || seen.has(link)) continue;
        seen.add(link);
        results.push({
          title: j.position || j.title || '',
          org: j.company || '',
          link,
          location: j.location || 'India',
          type: isIntern(j.position || j.title || '') ? 'internship' : 'job',
          source: 'LinkedIn',
          deadline: null,
          description: '',
          tags: [],
        });
      }

      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.log(`  LinkedIn query "${q.keyword}" failed: ${err.message}`);
    }
  }

  console.log(`  LinkedIn → ${results.length} items`);
  return results;
}

module.exports = { scrapeLinkedIn };
