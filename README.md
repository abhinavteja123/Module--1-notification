# OpportunityHub — Student Opportunity Notification Platform

Aggregates hackathons, internships, and jobs from 15+ sources into one searchable page. Auto-refreshes every 6 hours via GitHub Actions. No backend, no database, no cost.

Built for Indian B.Tech students.

---

## What It Does

- Scrapes 110+ company job boards (Greenhouse / Lever / Ashby / Workable / Recruitee ATS)
- Fetches free public APIs: Devpost, DoraHacks, Remotive, Arbeitnow, RemoteOK, The Muse, Jobicy, Outreachy, LFX Mentorship
- Parses RSS feeds: We Work Remotely, Authentic Jobs
- Optional: LinkedIn via `linkedin-jobs-api` npm package
- Deduplicates with 90-day memory, tags B.Tech-relevant + India listings
- Optionally enriches new listings with Groq LLM (free tier) — summary, skills, fit score
- Commits `app/data.js` to repo every 6h → GitHub Pages serves it statically

---

## Quick Start

```bash
# 1. Clone
git clone <your-repo-url>
cd "Module -1 notification"

# 2. Install
npm install

# 3. Optional: enable LinkedIn scraping
npm install linkedin-jobs-api

# 4. Run once (writes app/data.js)
npm run scrape

# 5. Open frontend
open app/index.html
```

**Optional Groq enrichment** (adds AI summaries + skill tags):
```bash
GROQ_API_KEY=your_key_here npm run scrape
```
Free key: https://console.groq.com/keys

**Dry run** (fetch + log, no writes):
```bash
npm run scrape:dry
```

---

## GitHub Actions Setup (Auto-refresh every 6h)

1. Push repo to GitHub
2. Go to **Settings → Secrets → Actions**
3. Add secret: `GROQ_API_KEY` (optional — skip to skip enrichment)
4. Go to **Actions** tab → **Refresh Opportunities** → **Run workflow** (manual first test)
5. Enable GitHub Pages: **Settings → Pages → Source: main branch → `/app` folder**

The workflow runs at midnight, 6am, noon, 6pm UTC automatically.

---

## Project Structure

```
.
├── scraper/
│   ├── run-all.js              # Main entry point
│   ├── api-scraper.js          # Free JSON API adapter (10 formats)
│   ├── ats-scraper.js          # ATS job boards (110 companies)
│   ├── rss-scraper.js          # RSS feed parser
│   ├── cheerio-scraper.js      # HTML scraper (Cheerio)
│   ├── playwright-scraper.js   # Browser scraper (Unstop)
│   ├── linkedin-scraper.js     # LinkedIn (optional npm)
│   └── configs/
│       ├── companies.json      # 110 company slugs by ATS provider
│       └── targets.json        # 15 source configurations
├── app/
│   ├── index.html              # Frontend (static, no build step)
│   ├── data.js                 # Auto-generated — do not edit
│   ├── seen-ids.json           # Dedup registry (auto-generated)
│   ├── sources-health.json     # Per-source health (auto-generated)
│   ├── detail-enricher.js      # Jina Reader + Groq deep enrichment
│   └── groq-enricher.js        # Groq batch metadata enrichment
├── .github/workflows/
│   └── refresh.yml             # GitHub Actions cron job
└── package.json
```

---

## Adding a New Company

1. Find their ATS. Check career page URL:
   - `greenhouse.io` → add slug to `scraper/configs/companies.json` under `"greenhouse"`
   - `lever.co` → add to `"lever"`
   - `ashby.com` → add to `"ashby"`
   - `workable.com` → add to `"workable"`
   - `recruitee.com` → add to `"recruitee"`
2. The slug is the part after the ATS domain: `boards.greenhouse.io/openai` → slug is `openai`

---

## Adding a New API Source

1. Add entry to `scraper/configs/targets.json`
2. Add parser case to `scraper/api-scraper.js`

See [DOCS.md](DOCS.md) for the full API reference.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | No | AI enrichment — free at console.groq.com |

---

## Tech Stack

Node.js 18+ · axios + axios-retry · cheerio · playwright · fast-xml-parser · p-limit · Groq API · Jina Reader · GitHub Actions · GitHub Pages

---

## License

MIT
