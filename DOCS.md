# DOCS — OpportunityHub: A to Z Reference

Complete reference for every API, company, configuration, and data format in the project.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow](#2-data-flow)
3. [Free Public APIs](#3-free-public-apis)
4. [ATS Company Boards](#4-ats-company-boards)
5. [RSS Feeds](#5-rss-feeds)
6. [AI Enrichment APIs](#6-ai-enrichment-apis)
7. [Data Schema](#7-data-schema)
8. [Source Health](#8-source-health)
9. [GitHub Actions Workflow](#9-github-actions-workflow)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Configuration Files](#11-configuration-files)
12. [Adding Sources](#12-adding-sources)
13. [Scraper Types](#13-scraper-types)
14. [Blocking Risk Reference](#14-blocking-risk-reference)
15. [NPM Dependencies](#15-npm-dependencies)
16. [Known Limitations](#16-known-limitations)

---

## 1. Architecture Overview

```
GitHub Actions (cron every 6h)
        │
        ▼
scraper/run-all.js
  ├── Phase 1: targets.json sources
  │     ├── Free JSON APIs (api-scraper.js)
  │     ├── RSS feeds (rss-scraper.js)
  │     ├── HTML scrapers (cheerio-scraper.js)
  │     └── Browser scraper (playwright-scraper.js)
  ├── Phase 2: ATS company boards (ats-scraper.js)
  │     └── 115 companies × 5 ATS providers
  └── Phase 3: LinkedIn (linkedin-scraper.js, optional)
        │
        ▼
  Deduplication (seen-ids.json, 90-day TTL)
        │
        ▼
  Zero-result guard (aborts if 0 items collected)
        │
        ▼
  Groq LLM enrichment (optional, GROQ_API_KEY)
  ├── detail-enricher.js: Jina Reader → Groq (25 items/run)
  └── groq-enricher.js: batch metadata (summary, skills, score)
        │
        ▼
  Atomic writes (tmp → rename)
  app/data.js
  app/seen-ids.json
  app/sources-health.json
        │
        ▼
  git commit + push → GitHub Pages
        │
        ▼
  app/index.html (static frontend, no server needed)
```

---

## 2. Data Flow

### Input — scraper output shape
```js
{
  title: string,
  org: string,
  link: string,        // unique identifier — normalized (strip ?, trailing /)
  type: 'hackathon' | 'internship' | 'job',
  source: string,
  location: string,
  description: string, // ≤300 chars plain text
  deadline: string | null,
  tags: string[],
}
```

### After dedup + tagging (run-all.js)
```js
{
  ...above,
  id: string,          // normalized link (no ? params, no trailing /)
  btech: boolean,      // TECH_RE match on title or tags
  india: boolean,      // INDIA_RE match on location
  firstSeenAt: string, // ISO timestamp of first discovery
  isNew: boolean,      // true only in the run it was first seen
}
```

### After Groq enrichment (optional)
```js
{
  ...above,
  summary: string,     // ≤14 word student-facing summary
  skills: string[],    // up to 5-6 tech skills
  score: number,       // 0-100 B.Tech fit score
  details: {           // from detail-enricher.js (Jina + Groq, 25 cap/run)
    description: string,
    eligibility: string,
    stipend: string,
    deadline: string,
    howToApply: string,
  }
}
```

---

## 3. Free Public APIs

All return JSON with no API key required.

### Hackathons

| Source | Endpoint | Format key |
|---|---|---|
| Devpost | `https://devpost.com/api/hackathons?page=1` | `devpost` |
| DoraHacks | `https://api.dorahacks.io/api/v2/hackathons?page=1&limit=30` | `dorahacks` |
| Devfolio | `https://api.devfolio.co/api/hackathons` | `devfolio` (undocumented — may fail) |

### Jobs

| Source | Endpoint | Format key | Notes |
|---|---|---|---|
| Remotive | `https://remotive.com/api/remote-jobs?category=software-dev&limit=100` | `remotive` | Free, documented |
| Arbeitnow | `https://www.arbeitnow.com/api/job-board-api` | `arbeitnow` | Free, EU-focused |
| RemoteOK | `https://remoteok.com/api` | `remoteok` | No key, rate-limited |
| The Muse | `https://www.themuse.com/api/public/jobs?category=Software%20Engineering&level=Entry%20Level` | `themuse` | Free |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=50&tag=dev` | `jobicy` | Free |

### Fellowships

| Source | Endpoint | Format key |
|---|---|---|
| Outreachy | `https://www.outreachy.org/api/v2/positions/` | `outreachy` |
| LFX Mentorship | `https://api.mentorship.lfx.linuxfoundation.org/v1/programs?limit=100&status=active` | `lfx` |

---

## 4. ATS Company Boards

All are **official public endpoints** — 0% blocking risk, no auth required.

### Greenhouse — `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`

Response: `{ "jobs": [{ "title", "absolute_url", "location": { "name" } }] }`

42 slugs: `openai, anthropic, cohere, huggingface, figma, discord, gitlab, hashicorp, datadog, cloudflare, stripe, twilio, mongodb, elastic, grafana, supabase, notion, postman, brex, ramp, scaleai, replicate, render, confluent, cockroachlabs, planetscale, neon, fastly, sentry, airtable, canva, asana, zapier, rippling, loom, retool, segment, mux, temporal, razorpay, freshworks, browserstack`

### Lever — `https://api.lever.co/v0/postings/{slug}?mode=json`

Response: `[{ "text", "hostedUrl", "categories": { "location" }, "descriptionPlain" }]`

40 slugs: `shopify, reddit, coinbase, dropbox, pinterest, box, zendesk, okta, pagerduty, splunk, hubspot, intercom, mixpanel, amplitude, braze, carta, databricks, snowflake, fivetran, airbyte, wandb, anyscale, modal, baseten, benchling, gong, outreach, klaviyo, iterable, cultureamp, lattice, benchsci, alchemy, consensys, kraken, dbtlabs, astronomer, prefect-technologies, netlify, hasura`

### Ashby — `https://api.ashbyhq.com/posting-api/job-board/{slug}`

Response: `{ "jobs": [{ "title", "jobUrl", "location", "descriptionSocial" }] }`

23 slugs: `linear, vercel, resend, posthog, appwrite, cal.com, inngest, liveblocks, dub, formbricks, typebot, activepieces, directus, nango, loops, june, koala, chatwoot, plane, twenty, svix, trigger, commonroom`

### Workable — `https://apply.workable.com/api/v1/widget/accounts/{slug}/jobs`

Response: `{ "results": [{ "title", "shortcode", "city", "country" }] }`
Link pattern: `https://apply.workable.com/{slug}/j/{shortcode}`

5 slugs: `bending-spoons, revolut, taxfix, hack-the-box, persado`

### Recruitee — `https://{slug}.recruitee.com/api/offers/`

Response: `{ "offers": [{ "title", "careers_url", "slug", "city", "country" }] }`

5 slugs: `adyen, mollie, bynder, testgorilla, messagebird`

---

## 5. RSS Feeds

Parsed via `fast-xml-parser`. Items from `<item>` elements.

| Feed | URL |
|---|---|
| We Work Remotely | `https://weworkremotely.com/feed.rss` |
| Authentic Jobs | `https://www.authenticjobs.com/feed/` |

Fields used: `title`, `link` (or `guid`), `description`, `dc:creator`

---

## 6. AI Enrichment APIs

Both optional — skipped if `GROQ_API_KEY` is not set.

### Jina Reader (free, no key)

- Usage: `GET https://r.jina.ai/{encodeURIComponent(url)}`
- Header: `X-Return-Format: text`
- Returns: Clean readable text from any URL (handles JS rendering)
- Rate limit: ~10 req/min free
- Docs: https://jina.ai/reader

### Groq API (free tier)

- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.1-8b-instant`
- Free tier: 6,000 tokens/min
- Get key: https://console.groq.com/keys
- Auth: `Authorization: Bearer $GROQ_API_KEY`

**Enrichment pipeline:**
1. `detail-enricher.js` — fetches page via Jina → sends to Groq → extracts: summary, skills, score, description, eligibility, stipend, deadline, howToApply (cap: 25/run)
2. `groq-enricher.js` — batch metadata only, no page fetch (cap: 20/batch, BATCH=20)

Items enriched by step 1 are skipped by step 2 (checked via `!it.summary`).

---

## 7. Data Schema

### `app/data.js`
```js
window.GENERATED_AT = "2025-06-23T06:00:00.000Z"; // ISO timestamp
window.OPPORTUNITIES = [ ...opportunity objects ];
```

### Opportunity Object Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Normalized link (no query params, no trailing /) |
| `title` | string | Opportunity title |
| `org` | string | Organization name |
| `link` | string | Direct URL |
| `type` | string | `hackathon` / `internship` / `job` |
| `source` | string | Source name (e.g. `Devpost`, `Stripe (Greenhouse)`) |
| `location` | string | Location string |
| `description` | string | Short description ≤300 chars |
| `deadline` | string\|null | Deadline or null |
| `tags` | string[] | Tags ≤5 |
| `btech` | boolean | Tech-relevant (TECH_RE match) |
| `india` | boolean | India location (INDIA_RE match) |
| `is_remote` | boolean | Remote role |
| `stipend` | string | Stipend info |
| `firstSeenAt` | string | ISO timestamp of first discovery |
| `isNew` | boolean | True only in discovery run |
| `summary` | string | Groq: ≤14 word summary |
| `skills` | string[] | Groq: up to 6 tech skills |
| `score` | number | Groq: 0-100 B.Tech fit |
| `details.description` | string | Groq+Jina: 2-3 sentence description |
| `details.eligibility` | string | Groq+Jina: eligibility criteria |
| `details.stipend` | string | Groq+Jina: compensation |
| `details.deadline` | string | Groq+Jina: deadline from page |
| `details.howToApply` | string | Groq+Jina: application instructions |

### `app/seen-ids.json`
```json
{ "https://company.com/jobs/123": "2025-06-01T06:00:00.000Z" }
```
Entries older than 90 days are automatically pruned each run.

### `app/sources-health.json`
```json
{
  "updatedAt": "2025-06-23T06:00:00.000Z",
  "totalItems": 847,
  "newItems": 23,
  "sources": {
    "Devpost Hackathons": { "count": 24, "ok": true, "error": null, "ts": "..." },
    "Remotive Remote Jobs": { "count": 98, "ok": true, "error": null, "ts": "..." }
  }
}
```

---

## 8. Source Health

Written every run to `app/sources-health.json`. Committed to repo alongside `data.js`.

**Disabled (return 0 silently without this flag):**

| Source | Reason |
|---|---|
| HackerEarth | JavaScript-rendered SPA + Cloudflare |
| Internshala | JavaScript-rendered SPA |

**Flaky from CI:**

| Source | Failure Rate | Reason |
|---|---|---|
| Unstop | ~80% | Cloudflare on datacenter IPs |
| LinkedIn | ~70% | IP blocked by LinkedIn |
| Devfolio | ~40% | Undocumented API |

---

## 9. GitHub Actions Workflow

**File:** `.github/workflows/refresh.yml`

```yaml
Trigger:
  - cron: '0 */6 * * *'    # every 6h UTC
  - workflow_dispatch        # manual

Timeout: 20 minutes

Steps:
  1. checkout@v4
  2. setup-node@v4 (Node 20, npm cache)
  3. cache Playwright Chromium
  4. npm ci
  5. npx playwright install chromium --with-deps
  6. node scraper/run-all.js  (env: GROQ_API_KEY)
  7. git add app/data.js app/seen-ids.json app/sources-health.json
  8. git commit (only if changed) + git push

Secrets needed:
  GROQ_API_KEY  (optional — enrichment skips if absent)

Permissions:
  contents: write
```

---

## 10. Frontend Architecture

**File:** `app/index.html` — single file, no build step, no framework.

### Features
- Tabs: All / Hackathons / Internships / Jobs (with counts)
- Search: fuzzy match on title, org, source, location, tags
- Filter buttons: B.Tech, India, Remote, New Only
- Source + location dropdown filters
- Sort: Newest / A→Z / By Source
- Cards: title, org, source badge, location, description, deadline (red if expired), View link
- Mark All Seen — localStorage
- NEW ribbon on unseen cards

### Security
- `esc()` — HTML-encodes all external data
- `safeUrl()` — blocks `javascript:`, `data:`, other non-http(s) schemes in hrefs
- Delegated click on `#grid` — no inline `onclick` attributes
- Content-Security-Policy meta tag

### LocalStorage
- `seenIds` — JSON array of seen opportunity IDs

---

## 11. Configuration Files

### `scraper/configs/targets.json` — entry shape

```json
{
  "name": "Source Name",
  "url": "https://api.example.com/endpoint",
  "type": "hackathon|job|internship",
  "scraper": "api|rss|cheerio|playwright",
  "apiFormat": "devpost|remotive|arbeitnow|remoteok|themuse|jobicy|dorahacks|devfolio|outreachy|lfx",
  "enabled": false,
  "selectors": { "card": "...", "title": "...", "org": "...", "link": "..." }
}
```

Active: 13 sources. Disabled: HackerEarth, Internshala.

### `scraper/configs/companies.json` — shape

```json
{
  "greenhouse": ["slug1", "slug2"],
  "lever": ["slug1", "slug2"],
  "ashby": ["slug1"],
  "workable": ["slug1"],
  "recruitee": ["slug1"]
}
```

Total: 115 slugs.

---

## 12. Adding Sources

### New ATS company
1. Find slug from career page URL
2. Add to correct array in `scraper/configs/companies.json`
3. No code changes needed

**Slug detection:**
- `boards.greenhouse.io/SLUG` → greenhouse
- `jobs.lever.co/SLUG` → lever  
- `jobs.ashbyhq.com/SLUG` → ashby
- `apply.workable.com/SLUG` → workable
- `SLUG.recruitee.com` → recruitee

### New JSON API
1. Add entry to `scraper/configs/targets.json` with `"scraper": "api"` and new `apiFormat`
2. Add case to `scraper/api-scraper.js`

### New RSS feed
1. Add entry to `scraper/configs/targets.json` with `"scraper": "rss"`
2. Done — no code changes

---

## 13. Scraper Types

| Type | File | Use case |
|---|---|---|
| `api` | `scraper/api-scraper.js` | Free JSON APIs — 10 formats |
| `rss` | `scraper/rss-scraper.js` | RSS 2.0 / Atom feeds |
| `cheerio` | `scraper/cheerio-scraper.js` | Server-rendered HTML only |
| `playwright` | `scraper/playwright-scraper.js` | JS-rendered pages (Unstop) |
| ATS | `scraper/ats-scraper.js` | Official ATS APIs (115 companies) |

---

## 14. Blocking Risk Reference

| Source | Risk | Type |
|---|---|---|
| All ATS (Greenhouse/Lever/Ashby/Workable/Recruitee) | 0% | Official public APIs |
| Devpost / Remotive / Arbeitnow / The Muse / Jobicy / Outreachy / LFX | 0% | Free public APIs |
| WWR / Authentic Jobs RSS | 0% | RSS feeds |
| RemoteOK | 5% | Rate-limited |
| DoraHacks | 5% | Less documented |
| Devfolio | 40% | Undocumented endpoint |
| HackerEarth | — | Disabled (JS-rendered) |
| Internshala | — | Disabled (JS-rendered) |
| Unstop | 80% | Playwright + Cloudflare on CI |
| LinkedIn | 70% | npm scraper + IP blocks |

---

## 15. NPM Dependencies

| Package | Purpose |
|---|---|
| `axios` | HTTP client |
| `axios-retry` | Auto-retry on failure / 429 / 5xx |
| `cheerio` | HTML parsing |
| `fast-xml-parser` | RSS/XML parsing |
| `p-limit` | Concurrency control |
| `user-agents` | Rotating User-Agent strings |
| `linkedin-jobs-api` *(optional)* | LinkedIn scraping |
| `playwright` *(optional)* | Headless browser for Unstop |

---

## 16. Known Limitations

| Limitation | Impact | Status |
|---|---|---|
| No database | Dedup via flat JSON file | Fine for thousands of users |
| CI IP blocks | LinkedIn + Unstop fail silently | Graceful — returns [] |
| Devfolio undocumented API | May stop working | Monitor via sources-health.json |
| No India internship API | Internshala disabled | Workaround: run locally |
| No push notifications | Students must visit manually | Phase 2 plan: Telegram + OneSignal |
| data.js grows over time | Slower page load | Cap at 500 most recent items |
| No user accounts | No personalization | Phase 3 if needed |

---

*Last updated: 2026-06-23*
