# OpportunityHub — Student Opportunity Aggregator

A zero-account, no-login notification center that aggregates **hackathons, internships, jobs, and open source programs** from 100+ companies and platforms into one clean feed. Runs entirely in-browser; data refreshes via GitHub Actions every day.

## Quick Start

Open `app/index.html` in your browser. Data is pre-built and committed. No server needed.

To refresh data locally (Node 18+ required):

```bash
node scraper/run-all.js
```

This writes `app/data.js` with live listings from all sources.

---

## Features

### Tabs
| Tab | What it shows |
|-----|---------------|
| All | Every listing |
| Hackathons | Devpost, Devfolio, Unstop hackathons |
| Internships | ATS internships + Internshala |
| Jobs | ATS jobs + remote job boards |
| Open Source | GSoC, MLH Fellowship, Season of Docs, Unstop open source |

### Filters
- **Degree filter** — All Degrees / B.Tech & BE / BBA & MBA
- **Freshers toggle** — shows only entry-level, 0-1 yr exp, trainee, junior, or internship listings
- **Search** — live search by title or company name
- **Sort** — Latest, Relevance, or Deadline

### Cards
Each card shows: title, organization, type badge, location, stipend/prize (if available), deadline, tags, and a direct **Apply** link.

### Manual Listings
Admins can add listings manually via `app/admin.html`. These are stored in `localStorage` and merged into the feed on load.

---

## Data Sources

### ATS Company Job Boards (103 companies)

All pull from public ATS APIs — no scraping, no keys required.

**Greenhouse (50 companies)**

figma, discord, gitlab, datadog, cloudflare, stripe, twilio, mongodb, elastic, postman, brex, scaleai, cockroachlabs, planetscale, fastly, airtable, asana, groww, phonepe, anthropic, togetherai, stabilityai, twitch, lyft, pagerduty, warp, mercury, robinhood, carta, coinbase, thoughtworks, epicgames, riotgames, pinterest, fivetran, intercom, customerio, mixpanel, amplitude, netlify, adyen, vonage, bandwidth, coursera, udemy, duolingo, khanacademy, mozilla, wikimedia, cybereason

**Lever (13 companies)**

anyscale, outreach, benchsci, kraken, cred, meesho, freshworks, paytm, mistral, palantir, logrocket, cloudinary, brilliant

**Ashby (40 companies)**

openai, cohere, sentry, notion, render, neon, confluent, zapier, loom, mux, temporal, ramp, supabase, reddit, snowflake, airbyte, linear, vercel, resend, posthog, inngest, nango, plane, twenty, svix, commonroom, perplexity, replit, railway, plaid, runway, elevenlabs, clickup, prefect, astronomer, helpscout, fullstory, modal, vultr, bounce

### Free Job & Hackathon APIs
| Source | Type | Method |
|--------|------|--------|
| Devpost | Hackathons | JSON API |
| Devfolio | Hackathons | API |
| We Work Remotely | Jobs | RSS |
| Authentic Jobs | Jobs | RSS |
| Remotive | Remote Jobs | JSON API |
| Arbeitnow | Jobs | JSON API |
| RemoteOK | Jobs | JSON API |
| The Muse | Entry-level Jobs | JSON API |
| Jobicy | Remote Jobs | JSON API |
| YC Startup Jobs (HN) | Jobs | JSON API |

### Scraped Sources (Firecrawl / Playwright)
| Source | Type |
|--------|------|
| Internshala | Internships |
| Naukri Fresher Jobs | Jobs |
| Unstop Hackathons | Hackathons |
| Unstop Open Source | Open Source |
| GSoC Organizations | Open Source |
| MLH Fellowship | Open Source |
| Season of Docs | Open Source |

---

## Tagging & Scoring

Each listing is automatically tagged:

| Field | Description |
|-------|-------------|
| `btech` | Title/tags match software/engineering/tech keywords |
| `bba` | Title/tags match business/marketing/finance/HR keywords |
| `fresher` | Entry-level, 0-1 yr, trainee, junior, intern — or type is internship |
| `india` | Location matches Indian city names |
| `is_remote` | Remote-friendly role |
| `score` | Composite: india (+2), btech (+2), remote (+1), new (+3), internship (+2), opensource (+2), hackathon (+1), active deadline (+1) |

---

## Automation

Data refreshes automatically via **GitHub Actions** daily (`.github/workflows/daily-deep-scrape.yml`).

`app/seen-ids.json` tracks when each listing was first seen. Items flagged **New** during the scrape run they first appear in. Entries expire after 90 days.

To trigger a manual refresh from GitHub:
> Actions → daily-deep-scrape → Run workflow

---

## Admin Panel

Access via direct URL: `app/admin.html`

- Password-protected (SHA-256 hash, no plaintext in code)
- Add/delete/clear listings manually
- All fields required: Title, Organization, Apply URL, Type, Location, Stipend/Prize, Deadline, Tags, Description
- Checkboxes: Remote, India, B.Tech Relevant, BBA/MBA, Fresher Friendly
- Listings saved to `localStorage` and merged into the main feed on load

The admin link is not visible anywhere on the main page — access by direct URL only.

---

## Add More Companies

To add a company's jobs:

1. Find which ATS they use from their careers URL:
   - `boards.greenhouse.io/<slug>` → add slug to `greenhouse` array
   - `jobs.lever.co/<slug>` → add slug to `lever` array
   - `jobs.ashbyhq.com/<slug>` → add slug to `ashby` array
2. Edit `scraper/configs/companies.json`
3. Run `node scraper/run-all.js` or wait for next GitHub Actions run

---

## Project Structure

```
Module -1 notification/
├── app/
│   ├── index.html            main feed UI (open this in browser)
│   ├── admin.html            password-protected admin panel
│   ├── data.js               auto-generated listings (committed by CI)
│   └── seen-ids.json         first-seen timestamps (90-day TTL)
│
├── scraper/
│   ├── configs/
│   │   ├── targets.json      scraper targets (APIs, RSS, Playwright, Firecrawl)
│   │   └── companies.json    ATS company slugs (103 companies)
│   ├── run-all.js            main orchestrator
│   ├── ats-scraper.js        Greenhouse / Lever / Ashby APIs
│   ├── api-scraper.js        free job/hackathon APIs
│   ├── rss-scraper.js        RSS/Atom feeds
│   ├── cheerio-scraper.js    static HTML scraping
│   ├── playwright-scraper.js JS-rendered sites
│   └── firecrawl-scraper.js  Cloudflare-protected sites via Firecrawl
│
└── .github/
    └── workflows/
        └── daily-deep-scrape.yml   GitHub Actions cron
```

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `FIRECRAWL_API_KEY` | Optional | Enables Internshala, Naukri, GSoC, MLH, Season of Docs scraping. Free tier: 500 credits/month at firecrawl.dev |
| `GROQ_API_KEY` | Optional | AI enrichment (summaries, tags) for new items only |

No variables needed to open `index.html` — the committed `data.js` works offline.

---

## Notes

- LinkedIn, Naukri (scraping), Glassdoor are excluded — they block data-center IPs (GitHub Actions) and forbid scraping in their ToS. ATS APIs cover most of the same companies cleanly.
- Open Source tab shows zero until GitHub Actions runs — Firecrawl/Playwright scrapers require `FIRECRAWL_API_KEY`.
- 100% free — no database, no backend, no accounts, no paid APIs required for the core feed.
