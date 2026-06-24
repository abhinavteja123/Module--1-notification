# OpportunityHub — Student Opportunity Notification Platform

Aggregates hackathons, internships, and jobs from 50+ sources into one searchable page. Auto-refreshes every 6 hours via GitHub Actions. No backend, no database, no cost.

Built for Indian B.Tech students.

---

## Data Sources

### Public APIs

| Source | Type | URL | Items |
|---|---|---|---|
| Devpost | Hackathon | `devpost.com/api/hackathons` | ~9 |
| Devfolio | Hackathon | `api.devfolio.co/api/hackathons` | ~26 |
| Remotive | Job | `remotive.com/api/remote-jobs` | ~30 |
| Arbeitnow | Job | `arbeitnow.com/api/job-board-api` | ~100 |
| RemoteOK | Job | `remoteok.com/api` | ~100 |
| The Muse | Job | `themuse.com/api/public/jobs` | ~20 |
| Jobicy | Job | `jobicy.com/api/v2/remote-jobs` | ~50 |
| YC Startup Jobs | Job | `hacker-news.firebaseio.com/v0/jobstories.json` | ~28 |

### RSS Feeds

| Source | Type | Feed URL | Items |
|---|---|---|---|
| We Work Remotely | Job | `weworkremotely.com/remote-jobs.rss` | ~100 |
| Authentic Jobs | Job | `authenticjobs.com/feed/` | ~10 |

### India-Focused (via Firecrawl — requires `FIRECRAWL_API_KEY`)

| Source | Type | URL | Items |
|---|---|---|---|
| Internshala | Internship | `internshala.com/internships/computer-science-internship/` | ~10 |
| Naukri | Job | `naukri.com/fresher-jobs` | ~8 |

### Browser-Scraped (Playwright — daily only)

| Source | Type | URL | Items |
|---|---|---|---|
| Unstop | Hackathon | `unstop.com/hackathons` | ~18 |

---

### ATS Company Job Boards

Official public APIs — no scraping, no blocking risk. Runs 4× per day.

#### Greenhouse (19 companies)

| Company | Slug |
|---|---|
| Figma | `figma` |
| Discord | `discord` |
| GitLab | `gitlab` |
| Datadog | `datadog` |
| Cloudflare | `cloudflare` |
| Stripe | `stripe` |
| Twilio | `twilio` |
| MongoDB | `mongodb` |
| Elastic | `elastic` |
| Postman | `postman` |
| Brex | `brex` |
| Scale AI | `scaleai` |
| CockroachLabs | `cockroachlabs` |
| PlanetScale | `planetscale` |
| Fastly | `fastly` |
| Airtable | `airtable` |
| Asana | `asana` |
| Groww | `groww` |
| PhonePe | `phonepe` |

#### Lever (7 companies)

| Company | Slug |
|---|---|
| Anyscale | `anyscale` |
| Outreach | `outreach` |
| BenchSci | `benchsci` |
| Kraken | `kraken` |
| CRED | `cred` |
| Meesho | `meesho` |
| Freshworks | `freshworks` |

#### Ashby (26 companies)

| Company | Slug |
|---|---|
| OpenAI | `openai` |
| Cohere | `cohere` |
| Sentry | `sentry` |
| Notion | `notion` |
| Render | `render` |
| Neon | `neon` |
| Confluent | `confluent` |
| Zapier | `zapier` |
| Loom | `loom` |
| Mux | `mux` |
| Temporal | `temporal` |
| Ramp | `ramp` |
| Supabase | `supabase` |
| Reddit | `reddit` |
| Snowflake | `snowflake` |
| Airbyte | `airbyte` |
| Linear | `linear` |
| Vercel | `vercel` |
| Resend | `resend` |
| PostHog | `posthog` |
| Inngest | `inngest` |
| Nango | `nango` |
| Plane | `plane` |
| Twenty | `twenty` |
| Svix | `svix` |
| Common Room | `commonroom` |

**Total: 52 companies · ~5,600 raw listings · ~4,400 unique after dedup**

---

## Quick Start

```bash
git clone <your-repo-url>
cd "Module -1 notification"
npm install
npm run scrape        # writes app/data.js
open app/index.html   # open in browser
```

**Dry run (no writes):**
```bash
npm run scrape:dry
```

---

## GitHub Actions Setup

1. Push repo to GitHub
2. **Settings → Secrets → Actions** → add secrets:

| Secret | Required | Get it from |
|---|---|---|
| `FIRECRAWL_API_KEY` | No (Internshala + Naukri) | firecrawl.dev — free 500 credits/month |
| `GROQ_API_KEY` | No (AI enrichment) | console.groq.com — free tier |

3. **Actions tab → Refresh Opportunities → Run workflow** (first manual test)
4. **Settings → Pages → Source: main branch → `/app` folder**

Runs automatically: midnight, 6am, noon, 6pm UTC.

---

## Adding a Company

Find their ATS from the career page URL, then add the slug to `scraper/configs/companies.json`:

```
boards.greenhouse.io/openai   →  "greenhouse": ["openai", ...]
jobs.lever.co/shopify         →  "lever": ["shopify", ...]
jobs.ashbyhq.com/linear       →  "ashby": ["linear", ...]
```

---

## Project Structure

```
.
├── scraper/
│   ├── run-all.js              # Orchestrator
│   ├── api-scraper.js          # Public JSON APIs (8 formats)
│   ├── ats-scraper.js          # ATS job boards (52 companies)
│   ├── rss-scraper.js          # RSS/Atom feeds
│   ├── playwright-scraper.js   # Browser scraper (Unstop)
│   ├── firecrawl-scraper.js    # Firecrawl (Internshala, Naukri)
│   ├── cheerio-scraper.js      # HTML scraper (unused/reserved)
│   ├── linkedin-scraper.js     # LinkedIn (optional npm)
│   └── configs/
│       ├── companies.json      # 52 company slugs by ATS
│       └── targets.json        # Source configurations
├── app/
│   ├── index.html              # Frontend (static, no build step)
│   ├── data.js                 # Auto-generated — do not edit
│   ├── seen-ids.json           # 90-day dedup registry
│   ├── sources-health.json     # Per-source health stats
│   └── groq-enricher.js        # Groq AI enrichment (optional)
├── .github/workflows/
│   ├── refresh.yml             # Every 6h — APIs + ATS only
│   └── daily-scrape.yml        # Daily — full scrape inc. Playwright
└── .env.example
```

---

## Tech Stack

Node.js · axios · playwright · fast-xml-parser · cheerio · p-limit · Firecrawl API · Groq API · GitHub Actions · GitHub Pages

---

## License

MIT
