# Student Notification Platform — Complete System Design

> **Purpose of this document:** Full A–Z specification for Claude Opus 4.8 to implement the student notification platform end-to-end. Every section is written as an actionable prompt — read top to bottom, implement in order.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Core Features](#2-core-features)
3. [System Architecture](#3-system-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Database Design](#5-database-design)
6. [Scraper Engine](#6-scraper-engine)
7. [AI Enrichment Layer](#7-ai-enrichment-layer)
8. [Backend API](#8-backend-api)
9. [Push Notification System](#9-push-notification-system)
10. [Frontend — Notification Center UI](#10-frontend--notification-center-ui)
11. [Scheduler & Automation](#11-scheduler--automation)
12. [Authentication](#12-authentication)
13. [Folder Structure](#13-folder-structure)
14. [Environment Variables](#14-environment-variables)
15. [Deployment](#15-deployment)
16. [Implementation Order](#16-implementation-order)
17. [Prompts for Claude Opus 4.8](#17-prompts-for-claude-opus-48)
18. [Roadmap — From Notifications to Career Intelligence](#18-roadmap--from-notifications-to-career-intelligence)

---

## 1. Project Overview

### What is this?

A real-time notification platform for students that automatically discovers and delivers:
- **Hackathons** — from Devfolio, Unstop, HackerEarth, Hack2Skill, MLH, DoraHacks, national government portals
- **Jobs** — from LinkedIn, Naukri, Google Careers, Microsoft, Amazon, Razorpay, Swiggy, any company careers page
- **Internships** — from Internshala, Wellfound, Glassdoor, LinkedIn, startup job boards
- **Research opportunities** — ISRO, DRDO, IIT/NIT lab pages, professor openings

The system pulls from a **broad, extensible set of sources** — free job APIs, public ATS endpoints (every company hiring through Greenhouse / Lever / Ashby exposes its open roles as free JSON), RSS feeds, and targeted scraping of a few high-value JS sites — then enriches raw data with AI, deduplicates, stores in a database, and delivers personalized push notifications to students with direct links.

> **Honest framing:** no system "scrapes the entire internet." What makes this feel like it covers everything is the **ATS API layer** (section 6.1) — point it at any company's Greenhouse / Lever / Ashby board and you get all their open jobs for free, no scraping. Add a company to a list and coverage grows without writing a new scraper.

### Goals

- Zero manual curation — fully automated pipeline
- India-first but globally aware
- Works on any device — browser push + mobile ready
- 100% free infrastructure (no paid APIs, no paid hosting)
- Extensible — new scraper targets can be added in minutes

### Audience

College students in India (B.Tech / M.Tech / MCA) looking for hackathons, SDE internships, ML/AI roles, research positions.

### Can this actually be built? — direct answers

| Question | Answer |
|----------|--------|
| **Is it possible?** | Yes. Every piece (data collection, AI cleanup, DB, push, UI) is a solved problem. The hard part is not "can it work" — it's source coverage and keeping scrapers from breaking. |
| **Can it be 100% free?** | Yes, at student scale. Supabase free tier, Vercel free tier, GitHub Actions 2000 min/month, Firebase FCM (unlimited free push). The one cost is the Claude Haiku API for enrichment (~₹1–2 per scrape run) — and even that is optional; you can run a free rule-based cleaner instead (section 7.1). |
| **"Not only fixed websites — give all things from companies"** | The realistic way to do this for free is **ATS APIs** (section 6.1), not crawling the open web. Greenhouse, Lever, and Ashby each serve a public JSON list of every open role for any company that uses them — thousands of companies. You maintain a list of company slugs, not a list of scrapers. This is the closest free thing to "all company jobs." |
| **What is genuinely NOT free / NOT feasible?** | Truly crawling the *entire* internet (needs a search-engine-scale crawler + proxies). LinkedIn / Naukri / Glassdoor at scale (aggressive anti-bot, IP bans, ToS violation — see §6.3). Guaranteed real-time delivery the instant a job is posted (you poll every few hours, not live). |

### What you need to build it (prerequisites)

- Free accounts: **Supabase**, **Firebase**, **Vercel**, **GitHub**, **Anthropic** (for the optional AI step).
- Working knowledge of: Node.js, basic SQL, React/Next.js. Everything else is in this doc.
- ~15–20 hours for a working v1 (see §16). Ongoing: ~1–2 hrs/month fixing broken CSS selectors (APIs/RSS rarely break; CSS scrapers do).

### Legal / ToS note (read once)

Scraping job/hackathon sites (Internshala, LinkedIn, Naukri, etc.) usually violates their Terms of Service even when technically possible. Risk for a small student project is low, but: prefer **official APIs and RSS feeds** wherever they exist (most sources in §6.1 are APIs, by design), respect `robots.txt`, keep request rates low, and never resell the data. The ATS-API and free-job-API sources are explicitly meant to be consumed this way — they are the safe backbone; CSS scraping is the risky tail.

---

## 2. Core Features

### 2.1 Data Collection (Scraper Engine)

**Source strategy — prefer APIs over scraping.** Sources are ranked by reliability. Build top-down: a CSS scraper breaks when a site redesigns; an API does not. Aim for ~80% of listings from Tiers 1–3.

- **Tier 1 — Free job APIs (most reliable, no scraping, no key):**
  - **Remotive** — `remotive.com/api/remote-jobs` (free, JSON)
  - **Arbeitnow** — `arbeitnow.com/api/job-board-api` (free, JSON, EU + remote)
  - **Jobicy** — `jobicy.com/api/v2/remote-jobs` (free, remote jobs)
  - **RemoteOK** — `remoteok.com/api` (free, JSON)
  - **Adzuna** — free tier 250 calls/day with a free app key (India jobs supported)
  - **USAJobs / GitHub Jobs-style** feeds where available
- **Tier 2 — ATS public APIs (this is how you cover "any company"):**
  - **Greenhouse** — `boards-api.greenhouse.io/v1/boards/{company}/jobs` (free JSON, every Greenhouse customer)
  - **Lever** — `api.lever.co/v0/postings/{company}?mode=json` (free JSON)
  - **Ashby** — `api.ashbyhq.com/posting-api/job-board/{company}` (free JSON)
  - **Workday** — many tenants expose a JSON search endpoint (per-company, more work)
  - You maintain a list of company slugs (e.g. `razorpay`, `cred`, `zomato`) → coverage scales by editing a list, not writing scrapers.
- **Tier 3 — RSS / Atom feeds (reliable, no scraping):**
  - Hackathon/devpost-style feeds, university research-opening feeds, company blog/careers RSS where published.
- **Tier 4 — CSS scraping (use only when no API/feed exists; breaks often):**
  - Lightweight (Cheerio + Axios) for server-rendered HTML.
  - Headless (Playwright) for JS-rendered sites: Devfolio, Unstop, HackerEarth, Hack2Skill, Internshala.
  - Hackathons: Devfolio, Unstop, HackerEarth, Hack2Skill, MLH, DoraHacks, SIH portal.
  - Research: ISRO, DRDO, IIT lab/careers pages, professor openings.
- **Scraper config:** Each target is a JSON config — URL, scraper type (`api` / `ats` / `rss` / `cheerio` / `playwright`), selector map (CSS only), type, enabled flag.
- **Anti-block measures (Tier 4 only):** Rotating user-agents, randomized delays (1–4s), respectful crawling, low concurrency.

#### Best free sources for the two student priorities (hackathons + internships)

> **Honest coverage truth:** no free source (and no paid one) has *all* hackathons/internships. You get broad coverage by stacking sources and deduping. Realistic target ≈ 70–85% of what's out there. Every source you add closes the gap.

| Goal | Best free sources (highest coverage first) | Method |
|------|---------------------------------------------|--------|
| **Hackathons** | **Devpost** (`/api/hackathons`, JSON — biggest list incl. India), MLH season list, Devfolio, Unstop, HackerEarth, Hack2Skill | Devpost = `api` (easy); the rest = Playwright (`fragile`) |
| **Internships (India)** | Company internships via **ATS APIs** (Greenhouse/Lever/Ashby — filter titles for "intern"), **Unstop** (huge for Indian students), **Internshala** | ATS = `api` (easy); Unstop/Internshala = Playwright (`fragile`) |
| **Jobs / full-time** | Free job APIs (Remotive, Arbeitnow, RemoteOK) + ATS APIs | all `api` (easy) |

**Takeaway for "give students everything":** start with the `api`/`ats` sources (Devpost + ATS + job APIs) — they are reliable and cover a lot on day one. Then bolt on Playwright scrapers for Unstop/Devfolio/Internshala to chase the last chunk. The feed grows toward "all" as you add sources; it never literally reaches 100%, and that is normal.

### 2.2 AI Enrichment

- Raw scraped data goes through an AI layer before storage
- **What AI does:**
  - Classify listing type (hackathon / job / internship / research)
  - Extract structured fields: title, org, deadline, stipend/CTC, location, remote flag, tech stack tags
  - Detect and flag duplicates across sources
  - Score relevance for students (0–100 score based on India relevance, student-friendliness, freshness)
  - Generate a clean 1-sentence summary for notification preview
- **Model:** Claude Haiku (fastest, cheapest — ~$0.002 per batch of 50 items)

### 2.3 Notification Center UI

- Bell icon with unread count badge
- Notification feed with cards showing:
  - Type icon (hackathon trophy / job briefcase / internship graduation cap)
  - Title + org name
  - Time ago label
  - Tags: prize money, stipend, deadline, remote, CTC
  - Direct "View" link button → opens original listing
- Filter bar: All / Hackathons / Jobs / Internships / Research
- Mark as read (per card + mark all)
- Search bar to search within notifications
- Preference panel: student sets tech interests, role preferences, location → personalized feed

### 2.4 Push Notifications

- Browser push via Firebase Cloud Messaging (FCM) — works on Chrome, Firefox, Edge
- Mobile push (if PWA installed)
- Notification payload: title, org, type, deadline, direct link
- User controls: enable/disable per category, quiet hours setting
- On click → opens the exact listing URL

### 2.5 Personalization

- Student profile: tech stack interests (React, Python, ML, etc.), role types (SDE, DS, ML, PM), min stipend filter, location preference
- Feed ranked by relevance score × student profile match
- "Saved" bookmarks — save listings for later
- "Not interested" — hides similar listings

### 2.6 Admin Panel (optional, Phase 2)

- View all scraped listings with source + status
- Manually trigger a scrape run
- Add/edit scraper target configs
- View push notification delivery stats

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     INTERNET SOURCES                         │
│  Devfolio  Unstop  LinkedIn  Internshala  Company pages ...  │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   GitHub Actions Cron   │  runs every 6 hours (free)
          │   (ubuntu-latest runner)│
          └────────────┬────────────┘
                       │
         ┌─────────────▼──────────────┐
         │      Scraper Engine         │
         │  ┌─────────────────────┐   │
         │  │ Cheerio + Axios     │   │  ← server-rendered sites
         │  │ (lightweight)       │   │
         │  └─────────────────────┘   │
         │  ┌─────────────────────┐   │
         │  │ Playwright          │   │  ← JS-heavy sites
         │  │ (headless Chromium) │   │
         │  └─────────────────────┘   │
         └─────────────┬──────────────┘
                       │ raw JSON
         ┌─────────────▼──────────────┐
         │    AI Enrichment Layer      │
         │    Claude Haiku API         │  ← classify, clean, deduplicate
         └─────────────┬──────────────┘
                       │ structured JSON
         ┌─────────────▼──────────────┐
         │      Supabase              │
         │  PostgreSQL + Realtime     │  ← free tier (500MB)
         │  Row Level Security        │
         └──────┬──────────┬──────────┘
                │          │
    ┌───────────▼──┐  ┌────▼───────────────┐
    │ Firebase FCM │  │  Next.js / React   │
    │ Push Service │  │  Frontend App      │
    │ (free tier)  │  │  (Vercel — free)   │
    └───────┬──────┘  └────────────────────┘
            │
    ┌───────▼──────────────────┐
    │        STUDENTS          │
    │  Browser push + UI feed  │
    └──────────────────────────┘
```

### Data Flow (one scrape cycle)

```
1. GitHub Actions triggers run-all.js
2. run-all.js loads scraper-configs.json → list of targets
3. For each target:
   a. Dispatch to correct scraper (cheerio or playwright)
   b. Collect raw listings array
4. All raw listings → AI enrichment batch (50 items per API call)
5. AI returns cleaned, classified, deduplicated array
6. Upsert to Supabase (on_conflict: link → skip duplicate); `.select()` returns only NEW rows
7. For new items: scraper calls push/send-push.js (firebase-admin, FCM HTTP v1)
8. Push delivered only to users whose prefs/quiet-hours match (not a blanket broadcast)
9. In-app feed also updates instantly via Supabase Realtime (no push needed when app is open)
10. Student clicks notification → lands on original listing URL
```

---

## 4. Tech Stack

### Backend / Scraping

| Tool | Purpose | Cost |
|------|---------|------|
| Node.js 20 | Runtime for all scraper scripts | Free |
| Playwright | Headless browser for JS-heavy sites | Free (open source) |
| Cheerio | Fast HTML parser for static sites | Free |
| Axios | HTTP client with custom headers | Free |
| @anthropic-ai/sdk | Claude Haiku for AI enrichment | ~$0.002/run |
| @supabase/supabase-js | DB writes + realtime subscriptions | Free |
| fast-xml-parser | Parse RSS/Atom feeds | Free |
| p-limit | Concurrency limiter (avoid rate limits) | Free |
| user-agents | Rotating user-agent strings | Free |

### Database

| Tool | Purpose | Cost |
|------|---------|------|
| Supabase | PostgreSQL + Auth + Realtime + Edge Functions | Free (500MB, 50K rows/month) |

### Push Notifications

| Tool | Purpose | Cost |
|------|---------|------|
| Firebase Cloud Messaging (FCM) | Browser + mobile push | Free (unlimited) |
| firebase-admin | Server-side push trigger | Free |
| firebase (client SDK) | Service worker + token management | Free |

### Frontend

| Tool | Purpose | Cost |
|------|---------|------|
| Next.js 14 (App Router) | React framework | Free |
| Tailwind CSS | Styling | Free |
| shadcn/ui | Component library | Free |
| Supabase Realtime | Live feed updates (WebSocket) | Free |
| next-pwa | PWA + service worker | Free |
| date-fns | Time formatting (e.g. "2h ago") | Free |
| Zustand | Client state (filters, preferences) | Free |

### Automation / DevOps

| Tool | Purpose | Cost |
|------|---------|------|
| GitHub Actions | Cron job scheduler (4×/day) | Free (2000 min/month) |
| Vercel | Frontend hosting + serverless | Free tier |
| Supabase Edge Functions | Serverless backend logic (FCM trigger) | Free |

### Auth

| Tool | Purpose | Cost |
|------|---------|------|
| Supabase Auth | Email + Google OAuth | Free |

---

## 5. Database Design

### Supabase SQL (run in order)

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────
-- Table: notifications
-- ─────────────────────────────────────────
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('hackathon', 'job', 'internship', 'research')),
  title           text not null,
  org             text,
  link            text not null unique,          -- deduplicate by link
  summary         text,                          -- AI-generated 1-sentence preview
  source          text,                          -- e.g. 'internshala', 'linkedin'
  deadline        timestamptz,
  stipend_ctc     text,                          -- raw string e.g. "₹30K/month" or "12 LPA"
  is_remote       boolean default false,
  location        text,
  tags            jsonb default '[]',            -- ["ML", "Python", "Remote", "₹1L prize"]
  relevance_score integer default 50,            -- 0–100, AI-assigned
  tech_stack      jsonb default '[]',            -- ["React", "Python", "Node"]
  scraped_at      timestamptz default now(),
  created_at      timestamptz default now()
);

create index on notifications(type);
create index on notifications(created_at desc);
create index on notifications(relevance_score desc);
create index on notifications(deadline);

-- ─────────────────────────────────────────
-- Table: fcm_tokens  (per user device)
-- ─────────────────────────────────────────
create table fcm_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  token       text not null unique,
  device_info text,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────
-- Table: user_reads
-- ─────────────────────────────────────────
create table user_reads (
  user_id   uuid references auth.users(id) on delete cascade,
  notif_id  uuid references notifications(id) on delete cascade,
  read_at   timestamptz default now(),
  primary key (user_id, notif_id)
);

-- ─────────────────────────────────────────
-- Table: user_saves (bookmarks)
-- ─────────────────────────────────────────
create table user_saves (
  user_id   uuid references auth.users(id) on delete cascade,
  notif_id  uuid references notifications(id) on delete cascade,
  saved_at  timestamptz default now(),
  primary key (user_id, notif_id)
);

-- ─────────────────────────────────────────
-- Table: user_preferences
-- ─────────────────────────────────────────
create table user_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  interests        jsonb default '["hackathon", "job", "internship"]',   -- types to receive
  tech_interests   jsonb default '[]',     -- ["React", "Python", "ML"]
  role_types       jsonb default '[]',     -- ["SDE", "ML Engineer", "Data Scientist"]
  min_stipend      integer default 0,      -- in thousands INR
  location_pref    text default 'India',
  push_enabled     boolean default true,
  quiet_hours_start integer default 23,    -- 11 PM
  quiet_hours_end   integer default 7,     -- 7 AM
  updated_at       timestamptz default now()
);

-- ─────────────────────────────────────────
-- Table: scraper_configs (extensible target list)
-- ─────────────────────────────────────────
create table scraper_configs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  type        text check (type in ('hackathon', 'job', 'internship', 'research', 'mixed')),
  scraper     text check (scraper in ('cheerio', 'playwright', 'rss', 'api')),
  selectors   jsonb,                       -- CSS selector map
  enabled     boolean default true,
  last_run    timestamptz,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────
alter table notifications    enable row level security;
alter table fcm_tokens       enable row level security;
alter table user_reads       enable row level security;
alter table user_saves       enable row level security;
alter table user_preferences enable row level security;

-- Notifications: public read
create policy "public read notifications"
  on notifications for select using (true);

-- FCM tokens: own only
create policy "own fcm tokens"
  on fcm_tokens for all using (auth.uid() = user_id);

-- Reads: own only
create policy "own reads"
  on user_reads for all using (auth.uid() = user_id);

-- Saves: own only
create policy "own saves"
  on user_saves for all using (auth.uid() = user_id);

-- Preferences: own only
create policy "own preferences"
  on user_preferences for all using (auth.uid() = user_id);
```

### Phase 2 & 3 schema (personalization + career intelligence — add later)

> Keep these OUT of the Phase-1 MVP. Add when you start the recommendation engine (§18). All of this runs on the Supabase free tier — `pgvector` is included free.

```sql
-- ─────────────────────────────────────────
-- pgvector: semantic matching (free on Supabase)
-- ─────────────────────────────────────────
create extension if not exists vector;

-- 384 dims = sentence-transformers all-MiniLM-L6-v2 (runs locally, free)
alter table notifications     add column if not exists embedding vector(384);
alter table user_preferences  add column if not exists interest_vector vector(384);
create index on notifications using ivfflat (embedding vector_cosine_ops);

-- ─────────────────────────────────────────
-- user_events: behavior signals → powers recsys + analytics
-- ─────────────────────────────────────────
create table user_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  notif_id    uuid references notifications(id) on delete cascade,
  event_type  text not null check (event_type in ('view','click','save','apply','dismiss')),
  created_at  timestamptz default now()
);
create index on user_events(user_id, created_at desc);

-- ─────────────────────────────────────────
-- applications: status tracker → powers the analytics dashboard
-- ─────────────────────────────────────────
create table applications (
  user_id     uuid references auth.users(id) on delete cascade,
  notif_id    uuid references notifications(id) on delete cascade,
  status      text default 'saved' check (status in ('saved','applied','interview','offer','rejected')),
  applied_at  timestamptz,
  notes       text,
  updated_at  timestamptz default now(),
  primary key (user_id, notif_id)
);

-- ─────────────────────────────────────────
-- user_resumes: resume matching (Phase 3)
-- ─────────────────────────────────────────
create table user_resumes (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  raw_text    text,                       -- extracted from uploaded PDF
  skills      jsonb default '[]',         -- ["Python","React","SQL"]
  embedding   vector(384),                -- for resume↔opportunity cosine match
  uploaded_at timestamptz default now()
);

-- RLS for new user-owned tables
alter table user_events  enable row level security;
alter table applications enable row level security;
alter table user_resumes enable row level security;
create policy "own events"  on user_events  for all using (auth.uid() = user_id);
create policy "own apps"     on applications for all using (auth.uid() = user_id);
create policy "own resume"   on user_resumes for all using (auth.uid() = user_id);
```

---

## 6. Scraper Engine

### File: `scraper/configs/targets.json`

```json
[
  {
    "name": "Internshala Internships",
    "url": "https://internshala.com/internships",
    "type": "internship",
    "scraper": "playwright",
    "selectors": {
      "card": ".individual_internship",
      "title": ".profile",
      "org": ".company_name",
      "link": "a.view_detail_button",
      "stipend": ".stipend",
      "deadline": ".deadline"
    }
  },
  {
    "name": "Devfolio Hackathons",
    "url": "https://devfolio.co/hackathons",
    "type": "hackathon",
    "scraper": "playwright",
    "selectors": {
      "card": "[data-testid='hackathon-card']",
      "title": "h2",
      "org": ".organizer",
      "link": "a"
    }
  },
  {
    "name": "Unstop Hackathons",
    "url": "https://unstop.com/hackathons",
    "type": "hackathon",
    "scraper": "playwright",
    "selectors": {
      "card": ".opportunity-card",
      "title": ".title",
      "org": ".org-name",
      "link": "a"
    }
  },
  {
    "name": "HackerEarth Challenges",
    "url": "https://www.hackerearth.com/challenges/hackathon/",
    "type": "hackathon",
    "scraper": "cheerio",
    "selectors": {
      "card": ".challenge-card",
      "title": ".challenge-name",
      "org": ".company-name",
      "link": "a.challenge-card-link"
    }
  },
  {
    "name": "Remotive Remote Jobs API",
    "url": "https://remotive.com/api/remote-jobs?category=software-dev&limit=50",
    "type": "job",
    "scraper": "api",
    "apiFormat": "remotive"
  },
  {
    "name": "Arbeitnow Job Board API",
    "url": "https://www.arbeitnow.com/api/job-board-api",
    "type": "job",
    "scraper": "api",
    "apiFormat": "arbeitnow"
  },
  {
    "name": "RemoteOK API",
    "url": "https://remoteok.com/api",
    "type": "job",
    "scraper": "api",
    "apiFormat": "remoteok"
  },
  {
    "name": "Devpost Hackathons (JSON)",
    "url": "https://devpost.com/api/hackathons",
    "type": "hackathon",
    "scraper": "api",
    "apiFormat": "devpost"
  },
  {
    "name": "Razorpay (Greenhouse ATS)",
    "company": "razorpay",
    "type": "job",
    "scraper": "ats",
    "ats": "greenhouse"
  },
  {
    "name": "Postman (Lever ATS)",
    "company": "postman",
    "type": "job",
    "scraper": "ats",
    "ats": "lever"
  },
  {
    "name": "Linear (Ashby ATS)",
    "company": "linear",
    "type": "job",
    "scraper": "ats",
    "ats": "ashby"
  },
  {
    "name": "Google Careers India",
    "url": "https://careers.google.com/jobs/results/?q=engineer+intern&location=India",
    "type": "job",
    "scraper": "playwright",
    "selectors": {
      "card": "li.lLd3Je",
      "title": "h3.QJPWVe",
      "org": { "static": "Google" },
      "link": "a.WpHeLc"
    }
  },
  {
    "name": "Hack2Skill Hackathons",
    "url": "https://hack2skill.com/hack/all-hackathons",
    "type": "hackathon",
    "scraper": "playwright",
    "selectors": {
      "card": ".hackathon-card",
      "title": ".hackathon-title",
      "org": ".organizer-name",
      "link": "a"
    }
  }
]
```

### File: `scraper/cheerio-scraper.js`

```js
const axios = require('axios');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');

async function scrapeWithCheerio(config) {
  const ua = new UserAgent({ deviceCategory: 'desktop' });
  
  const { data } = await axios.get(config.url, {
    headers: {
      'User-Agent': ua.toString(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const results = [];
  const sel = config.selectors;

  $(sel.card).each((i, el) => {
    const $el = $(el);
    const linkHref = $el.find(sel.link).attr('href') || $el.closest('a').attr('href');
    const link = linkHref?.startsWith('http') ? linkHref : new URL(linkHref, config.url).href;
    
    if (!link) return;

    results.push({
      title: $el.find(sel.title).text().trim(),
      org: sel.org?.static || $el.find(sel.org).text().trim(),
      link,
      type: config.type,
      stipend: sel.stipend ? $el.find(sel.stipend).text().trim() : null,
      deadline: sel.deadline ? $el.find(sel.deadline).text().trim() : null,
      source: config.name,
    });
  });

  return results.filter(r => r.title && r.link);
}

module.exports = { scrapeWithCheerio };
```

### File: `scraper/playwright-scraper.js`

```js
const { chromium } = require('playwright');
const UserAgent = require('user-agents');

async function scrapeWithPlaywright(config) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  
  const context = await browser.newContext({
    userAgent: new UserAgent({ deviceCategory: 'desktop' }).toString(),
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for first card to appear
    const sel = config.selectors;
    await page.waitForSelector(sel.card, { timeout: 12000 }).catch(() => null);

    // Scroll to load lazy content
    await autoScroll(page);

    const results = await page.$$eval(sel.card, (cards, s) => {
      return cards.map(card => {
        const linkEl = card.querySelector(s.link);
        const rawLink = linkEl?.href || card.closest('a')?.href;
        return {
          title: card.querySelector(s.title)?.textContent?.trim() || '',
          org: s.org?.static || card.querySelector(s.org)?.textContent?.trim() || '',
          link: rawLink || '',
          stipend: s.stipend ? card.querySelector(s.stipend)?.textContent?.trim() : null,
          deadline: s.deadline ? card.querySelector(s.deadline)?.textContent?.trim() : null,
        };
      }).filter(r => r.title && r.link);
    }, sel);

    return results.map(r => ({ ...r, type: config.type, source: config.name }));

  } finally {
    await browser.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= 3000 || window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

module.exports = { scrapeWithPlaywright };
```

### File: `scraper/rss-scraper.js`

```js
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

async function scrapeRSS(config) {
  const { data } = await axios.get(config.url, { timeout: 10000 });
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(data);

  const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  return (Array.isArray(items) ? items : [items]).map(item => ({
    title: item.title?.['#text'] || item.title || '',
    org: item['dc:creator'] || item.author?.name || '',
    link: item.link?.['@_href'] || item.link || item.guid || '',
    type: config.type,
    source: config.name,
    deadline: null,
    stipend: null,
  })).filter(r => r.title && r.link);
}

module.exports = { scrapeRSS };
```

### File: `scraper/api-scraper.js`

```js
const axios = require('axios');

async function scrapeAPI(config) {
  const { data } = await axios.get(config.url, {
    timeout: 10000,
    headers: { 'User-Agent': 'student-notify-bot/1.0' }, // RemoteOK needs a UA
  });
  const tag = (r) => ({ ...r, type: config.type, source: config.name });

  // Pick parser by apiFormat (set in targets.json), fall back to shape sniffing.
  if (config.apiFormat === 'remotive' || data.jobs) {
    return (data.jobs || []).map(j => tag({
      title: j.title, org: j.company_name, link: j.url,
      location: j.candidate_required_location || 'Remote', tags: j.tags || [], is_remote: true,
    })).filter(r => r.title && r.link);
  }

  if (config.apiFormat === 'arbeitnow' || data.data) {
    return (data.data || []).map(j => tag({
      title: j.title, org: j.company_name, link: j.url,
      location: j.location || 'Remote', tags: j.tags || [], is_remote: !!j.remote,
    })).filter(r => r.title && r.link);
  }

  if (config.apiFormat === 'devpost') {
    // Devpost returns { hackathons: [...] }. prize_amount is HTML — strip tags.
    return (data.hackathons || []).map(h => tag({
      title: h.title,
      org: h.organization_name || 'Devpost',
      link: h.url,
      location: h.displayed_location?.location || (h.open_state === 'open' ? 'Online' : 'Various'),
      deadline: h.submission_period_dates || null,
      stipend: (h.prize_amount || '').replace(/<[^>]+>/g, '').trim() || null,
      tags: (h.themes || []).map(t => t.name).slice(0, 4),
      is_remote: /online/i.test(h.displayed_location?.location || ''),
    })).filter(r => r.title && r.link);
  }

  if (config.apiFormat === 'remoteok' || Array.isArray(data)) {
    // RemoteOK: first array element is metadata — skip entries without `position`.
    return (Array.isArray(data) ? data : []).filter(j => j.position && j.url).map(j => tag({
      title: j.position, org: j.company, link: j.url,
      location: j.location || 'Remote', tags: j.tags || [], is_remote: true,
    }));
  }

  return [];
}

module.exports = { scrapeAPI };
```

### File: `scraper/ats-scraper.js` (the "any company" engine — free, no scraping)

```js
const axios = require('axios');

// Public ATS job-board APIs. Add a company slug to targets.json and you get
// all of that company's open roles as structured JSON — no CSS selectors, no Playwright.
async function scrapeATS(config) {
  const company = config.company;
  let url, mapper;

  if (config.ats === 'greenhouse') {
    url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;
    mapper = data => (data.jobs || []).map(j => ({
      title: j.title,
      org: company,
      link: j.absolute_url,
      location: j.location?.name || 'Unknown',
    }));
  } else if (config.ats === 'lever') {
    url = `https://api.lever.co/v0/postings/${company}?mode=json`;
    mapper = data => (data || []).map(j => ({
      title: j.text,
      org: company,
      link: j.hostedUrl,
      location: j.categories?.location || 'Unknown',
    }));
  } else if (config.ats === 'ashby') {
    url = `https://api.ashbyhq.com/posting-api/job-board/${company}`;
    mapper = data => (data.jobs || []).map(j => ({
      title: j.title,
      org: company,
      link: j.jobUrl,
      location: j.location || 'Unknown',
    }));
  } else {
    return [];
  }

  const { data } = await axios.get(url, { timeout: 12000 });
  return mapper(data)
    .filter(r => r.title && r.link)
    .map(r => ({ ...r, type: config.type, source: config.name }));
}

module.exports = { scrapeATS };
```

> **Finding company slugs:** if a company's careers page URL looks like `boards.greenhouse.io/razorpay` → slug is `razorpay` (Greenhouse). `jobs.lever.co/postman` → `postman` (Lever). `jobs.ashbyhq.com/linear` → `linear` (Ashby). Keep a growing `companies.json` list; one line per company = full job coverage for that company.

### 6.3 Risky / unreliable sources — handle with care

LinkedIn, Naukri, Glassdoor, and Indeed have strong anti-bot systems, ban data-center IPs (GitHub Actions runners are data-center IPs), and forbid scraping in their ToS. **Do not rely on them.** The old `linkedin.com/jobs/search.rss` endpoint no longer works. If you want LinkedIn-style coverage, get it indirectly through the ATS APIs (§6.1) and free job APIs instead. Treat any CSS scraper as "may silently return 0 items" and design the pipeline to tolerate that (it already does — each scraper is wrapped in try/catch and returns `[]` on failure).

### File: `scraper/run-all.js` (main orchestrator)

```js
const pLimit = require('p-limit');
const { createClient } = require('@supabase/supabase-js');
const configs = require('./configs/targets.json');
const { scrapeWithCheerio }   = require('./cheerio-scraper');
const { scrapeWithPlaywright } = require('./playwright-scraper');
const { scrapeRSS }            = require('./rss-scraper');
const { scrapeAPI }            = require('./api-scraper');
const { scrapeATS }            = require('./ats-scraper');
const { enrichWithAI }         = require('../enricher/ai-enricher');
const { sendPushForNewItems }  = require('../push/send-push');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const limit = pLimit(3); // max 3 concurrent scrapers

async function runScraper(config) {
  console.log(`[START] ${config.name}`);
  try {
    let raw = [];
    if (config.scraper === 'cheerio')    raw = await scrapeWithCheerio(config);
    if (config.scraper === 'playwright') raw = await scrapeWithPlaywright(config);
    if (config.scraper === 'rss')        raw = await scrapeRSS(config);
    if (config.scraper === 'api')        raw = await scrapeAPI(config);
    if (config.scraper === 'ats')        raw = await scrapeATS(config);

    console.log(`[DONE] ${config.name} → ${raw.length} raw items`);
    return raw;
  } catch (err) {
    console.error(`[ERROR] ${config.name}:`, err.message);
    return [];
  }
}

async function main() {
  const enabled = configs.filter(c => c.enabled !== false);

  // Run all scrapers with concurrency limit
  const allRaw = (await Promise.all(enabled.map(c => limit(() => runScraper(c))))).flat();
  console.log(`\nTotal raw items: ${allRaw.length}`);

  // AI enrichment in batches of 40
  const BATCH = 40;
  const enriched = [];
  for (let i = 0; i < allRaw.length; i += BATCH) {
    const batch = allRaw.slice(i, i + BATCH);
    const result = await enrichWithAI(batch);
    enriched.push(...result);
    // Small delay between API calls
    if (i + BATCH < allRaw.length) await sleep(1500);
  }

  // Filter out duplicates flagged by AI
  const toInsert = enriched.filter(e => !e.is_duplicate);
  console.log(`\nAfter AI enrichment: ${toInsert.length} unique items`);

  // Upsert to Supabase (skip on link conflict). `.select()` returns ONLY the rows
  // actually inserted (existing links are ignored) → exactly the new items to push.
  const { data: inserted, error } = await supabase
    .from('notifications')
    .upsert(
      toInsert.map(item => ({
        type:            item.type,
        title:           item.title,
        org:             item.org,
        link:            item.link,
        summary:         item.summary,
        source:          item.source,
        deadline:        item.deadline || null,
        stipend_ctc:     item.stipend_ctc || null,
        is_remote:       item.is_remote || false,
        location:        item.location || 'India',
        tags:            item.tags || [],
        relevance_score: item.relevance_score || 50,
        tech_stack:      item.tech_stack || [],
      })),
      { onConflict: 'link', ignoreDuplicates: true }
    )
    .select();

  if (error) console.error('Supabase upsert error:', error);
  else console.log(`\nInserted ${inserted?.length || 0} new items to Supabase`);

  // Send device push only for the brand-new rows (respects per-user prefs + quiet hours)
  if (inserted?.length) await sendPushForNewItems(inserted);

  // Update last_run timestamps
  await supabase
    .from('scraper_configs')
    .update({ last_run: new Date().toISOString() })
    .in('name', enabled.map(c => c.name));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
main().catch(console.error);
```

---

## 7. AI Enrichment Layer

> **Default pipeline = rule-based FIRST, AI as fallback only.** Run the free deterministic enricher (§7.1) on every item to classify, tag, score, and dedup. Send a record to Claude Haiku **only when rule-based is low-confidence** (unknown type, empty tags, messy free-text). This cuts cost to near ₹0, speeds up runs, and keeps the system maintainable. The `enrichWithAI` function below is the fallback, not the main path.

### File: `enricher/ai-enricher.js`

```js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function enrichWithAI(rawItems) {
  const prompt = `You are a data enrichment agent for a student notification platform targeting Indian college students.

Given the following raw scraped listings, return a JSON array (no markdown, no backticks) with one object per item.

Each object must have these exact fields:
{
  "title": string,                        // clean title (remove emoji, fix caps)
  "org": string,                          // organization name
  "link": string,                         // original link unchanged
  "type": "hackathon" | "job" | "internship" | "research",
  "summary": string,                      // 1 sentence, max 12 words, student-friendly
  "source": string,                       // original source field
  "deadline": string | null,              // ISO date string if found, else null
  "stipend_ctc": string | null,           // e.g. "₹30K/month" or "12 LPA" or null
  "is_remote": boolean,
  "location": string,                     // city or "Remote" or "India"
  "tags": string[],                       // max 4 tags: prize/stipend, deadline hint, remote, key tech
  "tech_stack": string[],                 // tech mentioned: ["React", "Python", "ML"]
  "relevance_score": number,              // 0-100: India relevance × student-friendliness × freshness
  "is_duplicate": boolean                 // true if same listing appears multiple times in this batch
}

Rules:
- relevance_score 80-100: major India hackathon / top company internship with good stipend
- relevance_score 50-79: decent opportunity, some info missing
- relevance_score 0-49: international, very senior, or unclear listing
- Mark is_duplicate=true if two items have the same title+org even from different sources
- If type is unclear, infer from title/org context
- For deadline: only include if explicitly stated, format as ISO date (YYYY-MM-DD)
- Keep tags concise: ["₹1L prize", "Deadline: 30 Jun", "Remote", "AI/ML"]

Raw data:
${JSON.stringify(rawItems, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/```json|```/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('AI enrichment parse error — returning raw items');
    return rawItems.map(r => ({ ...r, is_duplicate: false, relevance_score: 50, tags: [], tech_stack: [], summary: r.title }));
  }
}

module.exports = { enrichWithAI };
```

### 7.1 Free fallback — rule-based enricher (no API cost)

The AI step is optional. To keep the project at **zero** running cost, replace `enrichWithAI` with a deterministic cleaner that does ~80% of the job for free:

- **Classify** by keyword on title/source (`hackathon`, `intern`, `research`, else `job`).
- **Dedup** by normalized `link` (and a `title+org` hash) — the DB `unique(link)` already enforces exact-link dedup on insert.
- **Tags / tech_stack** by matching a keyword list (`React`, `Python`, `ML`, `Remote`, stipend regex like `/₹\s?\d/`).
- **summary** = truncated title; **relevance_score** = simple heuristic (has stipend? +20; India/Remote location? +20; recent? +10).

Use AI only for the messy long-tail (free-text descriptions, ambiguous types). A good default: run rule-based always, send only low-confidence items to Haiku. This caps spend near ₹0 and removes the only paid dependency.

---

## 8. Backend API

> ⚠️ **Critical correction vs. an earlier draft of this doc:** the FCM **legacy server key + `https://fcm.googleapis.com/fcm/send`** HTTP API was **shut down by Google in June 2024** and no longer works. You must use **FCM HTTP v1** (OAuth2, service-account auth). The simplest correct way to do that is the `firebase-admin` SDK, which handles token signing for you. We therefore send push **from the Node scraper pipeline** (it already runs on GitHub Actions and knows exactly which items are new) instead of a Deno edge function — fewer moving parts, no JWT signing in Deno, and easy access to user preferences.

### Push strategy

- **In-app feed updates live** via Supabase Realtime (§10) — no push needed when the app is open.
- **Device push** (app closed) is sent from the scraper run, only for **newly inserted** high-relevance items, and **filtered per user** by their preferences and quiet hours.

### File: `push/send-push.js` (Node, uses firebase-admin — HTTP v1, current)

```js
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// Service account JSON from Firebase Console → Project Settings → Service accounts.
// Store the whole JSON in one secret (FIREBASE_SERVICE_ACCOUNT) and parse it.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ICON = { hackathon: '🏆', job: '💼', internship: '🎓', research: '🔬' };

// newItems: array of notification rows just inserted (only send for fresh, relevant ones)
async function sendPushForNewItems(newItems) {
  const items = newItems.filter(n => (n.relevance_score ?? 50) >= 60);
  if (!items.length) return;

  // Pull every user's tokens + preferences once
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('user_id, interests, push_enabled, quiet_hours_start, quiet_hours_end');
  const { data: tokens } = await supabase.from('fcm_tokens').select('user_id, token');

  const hourUTC = new Date().getUTCHours(); // adjust to IST in real impl if needed
  const tokensByUser = {};
  for (const t of tokens || []) (tokensByUser[t.user_id] ||= []).push(t.token);

  for (const item of items) {
    for (const p of prefs || []) {
      if (!p.push_enabled) continue;
      if (inQuietHours(hourUTC, p.quiet_hours_start, p.quiet_hours_end)) continue;
      const wants = Array.isArray(p.interests) ? p.interests : [];
      if (wants.length && !wants.includes(item.type)) continue;

      const userTokens = tokensByUser[p.user_id] || [];
      if (!userTokens.length) continue;

      await admin.messaging().sendEachForMulticast({
        tokens: userTokens,
        notification: {
          title: `${ICON[item.type] || '🔔'} ${item.title}`,
          body: `${item.org || ''} · ${item.summary || ''}`.trim(),
        },
        data: { link: item.link, type: item.type, notif_id: String(item.id) },
        webpush: { fcmOptions: { link: item.link } },
      });
    }
  }
}

function inQuietHours(hour, start, end) {
  if (start == null || end == null) return false;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

module.exports = { sendPushForNewItems };
```

In `run-all.js`, capture the rows actually inserted (the upsert with `ignoreDuplicates` returns only new rows when you add `.select()`), then call `sendPushForNewItems(insertedRows)`. This keeps push, dedup, and preferences all in one Node process — no edge function, no dead legacy API.

> **Alternative (edge function):** if you prefer Supabase Edge Functions, you can still do HTTP v1 from Deno, but you must mint a Google OAuth2 access token from the service account (JWT sign with the private key) and POST to `https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send`. The Node + `firebase-admin` path above avoids all of that.

---

## 9. Push Notification System

### File: `public/firebase-messaging-sw.js` (service worker)

```js
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: self.FIREBASE_API_KEY,
  authDomain: self.FIREBASE_AUTH_DOMAIN,
  projectId: self.FIREBASE_PROJECT_ID,
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID,
  appId: self.FIREBASE_APP_ID,
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: { url: payload.data?.link },
    actions: [{ action: 'open', title: 'View listing' }],
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (url) event.waitUntil(clients.openWindow(url));
});
```

### File: `lib/firebase.ts` (client-side init + token registration)

```typescript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { supabase } from './supabase';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export async function requestPushPermission(userId: string) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: await navigator.serviceWorker.register('/firebase-messaging-sw.js'),
  });

  // Save token to Supabase
  await supabase.from('fcm_tokens').upsert({ user_id: userId, token });
  return token;
}

export function onForegroundMessage(callback: (payload: any) => void) {
  return onMessage(messaging, callback);
}
```

---

## 10. Frontend — Notification Center UI

### Component tree

```
app/
├── page.tsx                         ← home redirect → /notifications
├── notifications/
│   └── page.tsx                     ← main notification center page
└── layout.tsx                       ← global layout with auth provider

components/
├── NotificationCenter/
│   ├── index.tsx                    ← main container with realtime subscription
│   ├── FilterBar.tsx                ← All / Hackathons / Jobs / Internships chips
│   ├── NotificationCard.tsx         ← individual card with tags + link
│   ├── SearchBar.tsx                ← search within notifications
│   ├── StatsRow.tsx                 ← summary counts (total / hackathons / jobs / internships)
│   └── PreferencesPanel.tsx        ← slide-out panel for student preferences
├── BellIcon.tsx                     ← header bell with unread count badge
└── PushPermissionBanner.tsx        ← one-time "enable notifications" prompt
```

### Key component: `components/NotificationCenter/index.tsx`

```typescript
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FilterBar }         from './FilterBar';
import { NotificationCard }  from './NotificationCard';
import { StatsRow }          from './StatsRow';
import { SearchBar }         from './SearchBar';

type NotifType = 'all' | 'hackathon' | 'job' | 'internship' | 'research';

export function NotificationCenter({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [filter, setFilter]   = useState<NotifType>('all');
  const [search, setSearch]   = useState('');
  const [reads, setReads]     = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Initial fetch
  useEffect(() => {
    async function load() {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') query = query.eq('type', filter);
      if (search) query = query.ilike('title', `%${search}%`);

      const { data } = await query;
      setNotifications(data || []);

      // Load read IDs
      const { data: readData } = await supabase
        .from('user_reads')
        .select('notif_id')
        .eq('user_id', userId);
      setReads(new Set(readData?.map(r => r.notif_id) || []));
      setLoading(false);
    }
    load();
  }, [filter, search, userId]);

  // Supabase Realtime — new notifications arrive live
  useEffect(() => {
    const channel = supabase
      .channel('notifications-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' },
        payload => setNotifications(prev => [payload.new, ...prev])
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function markRead(id: string) {
    if (reads.has(id)) return;
    setReads(prev => new Set([...prev, id]));
    await supabase.from('user_reads').upsert({ user_id: userId, notif_id: id });
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !reads.has(n.id));
    setReads(new Set(notifications.map(n => n.id)));
    await supabase.from('user_reads').upsert(
      unread.map(n => ({ user_id: userId, notif_id: n.id }))
    );
  }

  const unreadCount = notifications.filter(n => !reads.has(n.id)).length;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <StatsRow notifications={notifications} unreadCount={unreadCount} onMarkAll={markAllRead} />
      <SearchBar value={search} onChange={setSearch} />
      <FilterBar active={filter} onChange={setFilter} />
      {loading ? <p className="text-center py-8 text-muted-foreground">Loading...</p> : (
        <div className="space-y-2">
          {notifications.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No notifications yet — check back soon.</p>
          )}
          {notifications.map(n => (
            <NotificationCard
              key={n.id}
              notification={n}
              isRead={reads.has(n.id)}
              onRead={() => markRead(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

### Key component: `components/NotificationCenter/NotificationCard.tsx`

```typescript
'use client';
const TYPE_ICONS = {
  hackathon: 'trophy',
  job: 'briefcase',
  internship: 'school',
  research: 'microscope',
};

const TYPE_COLORS = {
  hackathon:  { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  job:        { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  internship: { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200' },
  research:   { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200' },
};

export function NotificationCard({ notification: n, isRead, onRead }) {
  const colors = TYPE_COLORS[n.type] || TYPE_COLORS.job;

  return (
    <div
      className={`rounded-xl border p-4 cursor-pointer transition-all
        ${isRead ? 'opacity-70' : 'border-l-4 border-l-purple-500'}
        hover:border-gray-300 bg-white`}
      onClick={onRead}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors.bg}`}>
            <span className={`text-sm ${colors.text}`}>
              {n.type === 'hackathon' ? '🏆' : n.type === 'job' ? '💼' : n.type === 'research' ? '🔬' : '🎓'}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-snug">{n.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{n.org}</p>
            {n.summary && <p className="text-xs text-gray-400 mt-1 italic">{n.summary}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!isRead && <span className="w-2 h-2 rounded-full bg-purple-500 mt-1" />}
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatTimeAgo(n.created_at)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex flex-wrap gap-1.5">
          {(n.tags || []).slice(0, 3).map((tag, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {tag}
            </span>
          ))}
        </div>
        <a
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-xs text-purple-600 border border-purple-200 rounded-md px-2 py-1 hover:bg-purple-50"
        >
          View →
        </a>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

---

## 11. Scheduler & Automation

### GitHub Actions workflow

```yaml
# .github/workflows/scrape.yml
name: Scrape student notifications

on:
  schedule:
    - cron: '0 0,6,12,18 * * *'    # 4 times daily at midnight, 6am, noon, 6pm UTC
  workflow_dispatch:                  # allow manual trigger from GitHub UI

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps

      - name: Run all scrapers
        run: node scraper/run-all.js
        env:
          SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY:      ${{ secrets.SUPABASE_SERVICE_KEY }}
          ANTHROPIC_API_KEY:         ${{ secrets.ANTHROPIC_API_KEY }}
          FIREBASE_SERVICE_ACCOUNT:  ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}

      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Scraper failed — ${new Date().toISOString()}`,
              body: 'Check the Actions run for details.',
              labels: ['scraper-failure']
            })
```

> **GitHub Actions cron caveats (free tier):** scheduled runs can be **delayed several minutes** (or skipped) under platform load — fine for a job feed, not for true real-time. Cron is **auto-disabled after 60 days of no repo activity** — a monthly commit (or the `workflow_dispatch` manual trigger) keeps it alive. Each run reinstalls Playwright Chromium (~1 min); cache it (Prompt 6) to stay well within the 2000 min/month budget. Supabase free projects **pause after 7 days of inactivity** — a 4×/day cron keeps the project warm automatically.

---

## 12. Authentication

### Supabase Auth setup

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

### Auth flow

- Students sign up with email or Google OAuth (Supabase handles both)
- On first login: `user_preferences` row created with defaults
- Push permission requested via `PushPermissionBanner` component on first visit
- FCM token saved to `fcm_tokens` table on grant

---

## 13. Folder Structure

```
student-notifications/
│
├── scraper/
│   ├── configs/
│   │   ├── targets.json              ← scraper target definitions
│   │   └── companies.json            ← ATS company slugs (greenhouse/lever/ashby)
│   ├── cheerio-scraper.js
│   ├── playwright-scraper.js
│   ├── rss-scraper.js
│   ├── api-scraper.js                ← free job APIs (remotive, arbeitnow, remoteok)
│   ├── ats-scraper.js                ← "any company" engine (greenhouse/lever/ashby)
│   └── run-all.js                    ← main orchestrator
│
├── enricher/
│   └── ai-enricher.js                ← Claude Haiku enrichment (optional; see §7.1 free fallback)
│
├── push/
│   └── send-push.js                  ← firebase-admin HTTP v1 push (respects user prefs)
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial.sql           ← all table + RLS definitions
│   └── functions/
│       └── send-push/
│           └── index.ts              ← OPTIONAL edge-function push (HTTP v1); default is push/send-push.js
│
├── app/                              ← Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx
│   └── notifications/
│       └── page.tsx
│
├── components/
│   ├── NotificationCenter/
│   │   ├── index.tsx
│   │   ├── FilterBar.tsx
│   │   ├── NotificationCard.tsx
│   │   ├── SearchBar.tsx
│   │   ├── StatsRow.tsx
│   │   └── PreferencesPanel.tsx
│   ├── BellIcon.tsx
│   └── PushPermissionBanner.tsx
│
├── lib/
│   ├── supabase.ts
│   └── firebase.ts
│
├── public/
│   ├── firebase-messaging-sw.js      ← FCM service worker
│   ├── icon-192.png
│   └── badge-72.png
│
├── .github/
│   └── workflows/
│       └── scrape.yml                ← GitHub Actions cron
│
├── .env.local                        ← local dev secrets
├── package.json
└── next.config.js
```

---

## 14. Environment Variables

### `.env.local` (never commit this file)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...             # server-only (scraper + edge functions)

# Anthropic (Claude Haiku for enrichment)
ANTHROPIC_API_KEY=sk-ant-...

# Firebase (client-side — all NEXT_PUBLIC)
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=yourapp.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=yourapp
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123:web:abc
NEXT_PUBLIC_FIREBASE_VAPID_KEY=BNtu...  # from Firebase > Cloud Messaging > Web Push certs

# Firebase (server-side — for push via firebase-admin, HTTP v1)
# Paste the ENTIRE service-account JSON (one line) from
# Firebase Console → Project Settings → Service accounts → Generate new private key.
# Legacy FCM_SERVER_KEY is DEAD (Google shut it off June 2024) — do not use it.
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...","private_key":"..."}
```

### GitHub Actions secrets (add in repo Settings > Secrets)

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
FIREBASE_SERVICE_ACCOUNT          # full service-account JSON, for push from the scraper
```

---

## 15. Deployment

### Step-by-step

```bash
# 1. Create Supabase project (free)
#    https://app.supabase.com → New Project
#    Run 001_initial.sql in SQL Editor

# 2. Enable Supabase Auth
#    Authentication → Providers → Email (enabled by default)
#    Enable Google OAuth if desired

# 3. Create Firebase project (free)
#    https://console.firebase.google.com → New Project
#    Add Web App → copy config (NEXT_PUBLIC_FIREBASE_* vars)
#    Cloud Messaging → Web Push certificates → Generate VAPID key
#    Project Settings → Service accounts → Generate new private key
#    → paste the WHOLE JSON into FIREBASE_SERVICE_ACCOUNT (do NOT use the dead legacy server key)

# 4. Push runs from the Node scraper (push/send-push.js via firebase-admin) — nothing to deploy.
#    (Optional) If you instead use the edge-function path, deploy it with HTTP v1:
# supabase login
# supabase link --project-ref YOUR_PROJECT_REF
# supabase functions deploy send-push --env-file .env.local

# 5. Deploy frontend to Vercel (free)
vercel --prod
# Add all NEXT_PUBLIC_ env vars in Vercel dashboard

# 6. Set GitHub Actions secrets
#    Repo → Settings → Secrets and Variables → Actions
#    Add: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

# 7. Test scraper locally
node scraper/run-all.js

# 8. Trigger first GitHub Actions run manually
#    Actions → Scrape student notifications → Run workflow
```

---

## 16. Implementation Order

Follow this exact order — each phase is independently testable.

Build the **reliable, free sources first** (APIs/ATS) so you have real data on day one, then layer UI, push, and the fragile CSS scrapers last.

| Phase | What | Estimated Time |
|-------|------|----------------|
| 1 | Supabase DB setup (run SQL, verify tables) | 30 min |
| 2 | API scraper (Remotive + Arbeitnow + RemoteOK) → real data, no scraping | 1 hour |
| 3 | ATS scraper (Greenhouse/Lever/Ashby) + `companies.json` list | 1 hour |
| 4 | run-all.js wiring sources → DB upsert (dedup on link) | 1 hour |
| 5 | Rule-based enricher (§7.1, free) — classify/tag/score | 1 hour |
| 6 | GitHub Actions cron (manual `workflow_dispatch` test) | 30 min |
| 7 | Next.js skeleton + Supabase client | 1 hour |
| 8 | NotificationCenter UI with static data | 2 hours |
| 9 | Connect UI to live Supabase data + Realtime | 1 hour |
| 10 | Auth (Supabase email/Google) + preferences panel | 2 hours |
| 11 | Firebase push: service worker + token registration (client) | 2 hours |
| 12 | `push/send-push.js` (firebase-admin HTTP v1) wired into run-all, respects prefs | 1.5 hours |
| 13 | (Optional) Playwright scrapers for Devfolio/Unstop/Internshala | 2 hours |
| 14 | (Optional) Claude Haiku enricher for low-confidence items | 1 hour |
| 15 | Deploy (Vercel + Actions secrets) | 1 hour |

---

## 17. Prompts for Claude Opus 4.8

Use these prompts in order to implement the full system.

---

**Prompt 1 — Database**
```
Read the database design in section 5 of this document.
Generate the complete SQL migration file for Supabase.
Include all tables, indexes, and RLS policies.
(Push is sent from the Node scraper via firebase-admin — do NOT add a DB→edge-function trigger.)
File: supabase/migrations/001_initial.sql
```

---

**Prompt 2 — Cheerio Scraper**
```
Read sections 6 (Scraper Engine) carefully.
Implement scraper/cheerio-scraper.js and scraper/rss-scraper.js exactly as specified.
Then write a test script (test-scraper.js) that scrapes Internshala and logs 5 results.
Handle errors gracefully — log and continue, never throw uncaught.
```

---

**Prompt 3 — Playwright Scraper**
```
Implement scraper/playwright-scraper.js from section 6.
The auto-scroll function must load at least 2 pages of lazy content.
Add retry logic: if a selector is not found, wait 3s and retry once before giving up.
Handle CAPTCHA gracefully: if page title contains "robot" or "captcha", log and skip.
```

---

**Prompt 4 — AI Enricher**
```
Implement enricher/ai-enricher.js from section 7.
The Claude Haiku call must use claude-haiku-4-5-20251001 model.
Add fallback: if JSON parse fails, try to extract JSON from markdown code blocks.
If that also fails, return raw items with default fields filled.
Write a unit test that sends 5 dummy items and logs the enriched output.
```

---

**Prompt 5 — Orchestrator**
```
Implement scraper/run-all.js from section 6.
Use p-limit for concurrency (max 3 parallel scrapers).
Batch AI enrichment at 40 items per call.
Add timing logs: log how long each scraper took.
Add a --dry-run flag that runs everything but skips the Supabase upsert.
```

---

**Prompt 6 — GitHub Actions**
```
Create .github/workflows/scrape.yml from section 11.
Add caching for node_modules and playwright browsers to speed up runs.
Add a job summary at the end that posts how many items were scraped and saved.
```

---

**Prompt 7 — Frontend Setup**
```
Scaffold a Next.js 14 (App Router) project with:
- Tailwind CSS + shadcn/ui installed
- lib/supabase.ts from section 12
- lib/firebase.ts from section 9
- public/firebase-messaging-sw.js from section 9
- All NEXT_PUBLIC_ env variables wired up
Create app/layout.tsx with a global auth provider using Supabase.
```

---

**Prompt 8 — Notification Center UI**
```
Implement all components in components/NotificationCenter/ from section 10.
Start with the full index.tsx including:
- Supabase query with filter + search
- Realtime subscription (INSERT events)
- markRead and markAllRead functions
Then implement NotificationCard.tsx, FilterBar.tsx, StatsRow.tsx, SearchBar.tsx.
Use Tailwind CSS only — no extra UI libraries.
```

---

**Prompt 9 — Push Notifications**
```
Implement the full push notification flow from section 9. Use FCM HTTP v1 via firebase-admin
— do NOT use the legacy FCM server key / fcm/send endpoint (shut down by Google in June 2024).
1. public/firebase-messaging-sw.js (background message handler + click handler)
2. lib/firebase.ts (requestPushPermission — saves token to fcm_tokens)
3. components/PushPermissionBanner.tsx (one-time banner component)
4. push/send-push.js (firebase-admin sendEachForMulticast; filter by user prefs + quiet hours)
Wire sendPushForNewItems(insertedRows) into run-all.js after the upsert.
Test: insert a dummy high-relevance row, run send-push.js, verify a browser push arrives and the
click opens the listing link.
```

---

**Prompt 10a — Add a company (easy path, no scraping)**
```
Add [COMPANY] to job coverage. Find which ATS it uses:
- careers URL contains boards.greenhouse.io/<slug>  → ats: "greenhouse"
- contains jobs.lever.co/<slug>                      → ats: "lever"
- contains jobs.ashbyhq.com/<slug>                   → ats: "ashby"
Add a {company, ats, type:"job", scraper:"ats"} entry to targets.json (or companies.json)
and test with node scraper/run-all.js --dry-run. No CSS selectors needed.
```

---

**Prompt 10b — Add a CSS-scraped target (fragile, last resort)**
```
I want to add [TARGET_WEBSITE] as a new scraper source (no API/RSS/ATS exists for it).
URL: [url]   Type: [hackathon / job / internship]
Inspect the page and determine:
- Is it server-rendered (use cheerio) or JS-rendered (use playwright)?
- What CSS selectors extract the card, title, org, and link?
Add the config to scraper/configs/targets.json and test with node scraper/run-all.js --dry-run.
Note: CSS selectors break on site redesigns — prefer an API/ATS source if one exists.
```

---

## 18. Roadmap — From Notifications to Career Intelligence

The Phase-1 system (sections 1–17) is a notification feed. These extensions turn it into an AI-powered career platform. **Ship Phase 1 first** — each phase below is independently shippable and builds on the last. Honesty column flags what is genuinely free + easy vs. free-but-hard vs. accuracy-limited.

### Priority & feasibility at a glance

| # | Feature | Value | Free? | Effort | Phase |
|---|---------|-------|-------|--------|-------|
| 1 | Rule-first enrichment, AI only on uncertainty | High | ✅ free | Low | 1 (done, §7) |
| 2 | Richer opportunity score (multi-factor) | High | ✅ free | Low | 1–2 |
| 3 | Behavior tracking (clicks/saves/applies) | High | ✅ free | Low | 2 |
| 4 | Recommendation engine (personalized ranking) | Very High | ✅ free | Medium | 2 |
| 5 | Semantic matching (embeddings + pgvector) | Very High | ✅ free (local model) | Medium | 2 |
| 6 | Application tracker + analytics dashboard | High | ✅ free | Medium | 2–3 |
| 7 | Resume matching (match score + missing skills) | **Highest** | ✅ free* | Medium | 3 |
| 8 | Skill-gap analysis + career roadmaps | High | ✅ free* | High | 3 |
| 9 | Company intelligence (salary/reputation/trends) | Medium | ⚠️ partial | High | 3 |

`*` free with local embeddings + rule-based skill matching; small optional Haiku cost for nicer summaries.

### 18.1 Richer opportunity score

Replace the single AI relevance number with a transparent weighted formula computed in code (free, explainable):

```
score = 0.25*brand_value      // known company / org reputation (lookup table)
      + 0.20*compensation     // normalized stipend/CTC
      + 0.20*student_friendly  // intern/fresher-friendly, low experience bar
      + 0.15*freshness        // exp decay on scraped_at
      + 0.10*remote_flexibility
      + 0.10*application_simplicity   // direct apply vs. long form
```

Store the breakdown in `tags`/a `score_factors jsonb` so the UI can show *why* something ranks high.

### 18.2 Behavior tracking → Recommendation engine (Phase 2)

- Log every `view / click / save / apply / dismiss` into `user_events` (schema in §5).
- **Personalized rank** for user *u*, item *i* (all free, no ML training needed at first):

```
final_rank(u,i) = 0.4 * opportunity_score(i)          // global quality (18.1)
                + 0.4 * semantic_match(u,i)            // cosine sim, §18.3
                + 0.2 * freshness(i)
        boosted by collaborative signal: items saved/applied by similar users
```

- **User similarity** (collaborative filtering, free): users who saved the same items are "similar"; recommend what similar users engaged with. Start with simple co-occurrence counts in SQL; upgrade to matrix factorization only if needed.
- This is the LinkedIn/YouTube-style feed the review asked for — built from `user_events` + the score, no paid service.

### 18.3 Semantic matching with embeddings (Phase 2) — free

- Embed each opportunity's `title + summary + tech_stack` and each user's interests into 384-dim vectors using **`all-MiniLM-L6-v2`** via `@xenova/transformers` (runs in Node locally — **no API, no cost**).
- Store vectors in the `notifications.embedding` and `user_preferences.interest_vector` columns (pgvector, free on Supabase).
- Match by cosine similarity → recommends conceptually related roles even when keywords differ ("NLP" ↔ "language models", "frontend" ↔ "React"). pgvector does the nearest-neighbor query in SQL.

### 18.4 Resume matching (Phase 3) — highest value

1. Student uploads resume (PDF) → extract text with `pdf-parse` (free).
2. Extract skills via a skills keyword/taxonomy match (free) + optional Haiku for fuzzy extraction.
3. Embed resume → store in `user_resumes` (§5).
4. For each opportunity: **match score** = cosine(resume_vector, job_vector); **missing skills** = job skills − resume skills; **strengths** = overlap.
5. UI shows per-listing: `87% match · missing: Docker, AWS · strong: Python, React`.

This is the feature with the most immediate, actionable value — prioritize it in Phase 3.

### 18.5 Skill-gap analysis + career roadmaps (Phase 3)

- Define target roles (ML Engineer, SDE, Data Analyst) as skill sets (a JSON taxonomy you maintain).
- Gap = target skills − resume skills. Output: missing skills, ranked by how often they appear in matched job descriptions (data you already scraped).
- Roadmap: map each missing skill → free course/project suggestions + surface the most relevant internships/hackathons that build that skill.

### 18.6 Application tracker + analytics dashboard (Phase 2–3)

- `applications` table (§5) drives a kanban: Saved → Applied → Interview → Offer → Rejected.
- Dashboard charts (free, e.g. Recharts): applications over time, response rate, interview conversion, hackathons joined. Turns the feed into a productivity tool.

### 18.7 Company intelligence (Phase 3) — set expectations honestly

- **Achievable free:** required skills (aggregate from that company's scraped JDs), hiring trend (count of open roles over time — you already store `scraped_at`), role types, remote ratio.
- **Hard / not reliably free:** accurate salary ranges and reputation scores — real data lives behind Levels.fyi / Glassdoor (paid or blocked). Options: show **AI-*estimated* ranges clearly labeled "estimate"**, or crowdsource from users. Do **not** present estimates as facts.

### 18.8 Event-driven updates — what's actually possible

- Webhooks from job sources mostly **do not exist** — you cannot get true push-from-source for LinkedIn/Internshala/Devpost.
- Realistic improvement: poll **RSS/APIs more frequently** than CSS scrapers (they're cheap), keep heavy Playwright runs on the 6-hour cron. Use Supabase Realtime for instant *in-app* delivery once an item lands. This gets you "near real-time" without fictional webhooks.

### Suggested build order across phases

1. **Phase 1 (Module 1, now):** sources → dedup → rule-based enrich → feed → push. *Ship this.*
2. **Phase 2:** `user_events` tracking → opportunity score (18.1) → embeddings (18.3) → recommendation feed (18.2) → application tracker.
3. **Phase 3:** resume matching (18.4) → skill-gap + roadmaps (18.5) → analytics dashboard → company intelligence (best-effort).

---

*Document version: 3.0 | Last updated: June 2026 | Built for Claude Opus 4.8*

**v3.0 changelog:** made rule-based enrichment the explicit default with AI as low-confidence fallback (§7); added Phase 2/3 DB schema (`user_events`, `applications`, `user_resumes`, pgvector embedding columns); added **§18 Roadmap** turning the feed into a career-intelligence platform — multi-factor opportunity score, behavior-driven recommendation engine, free local-embedding semantic matching, resume matching with skill-gap analysis, career roadmaps, application tracker + analytics dashboard; flagged company-intelligence salary/reputation as accuracy-limited (not reliably free) and "event-driven/webhooks" as mostly unavailable (RSS/API polling + Realtime instead); kept everything phased so Module 1 ships first.

**v2.0 changelog:** added feasibility/ToS section answering the core questions; reframed "scrape the whole internet" into a realistic tiered source strategy; added the **ATS API layer** (Greenhouse/Lever/Ashby) as the free "any company" engine; added free job APIs (Arbeitnow, RemoteOK) with a multi-format parser; demoted LinkedIn/Naukri to "unreliable/optional" with a ToS note; **replaced the dead FCM legacy server key with FCM HTTP v1 via firebase-admin**, sent from the scraper and filtered by user preferences + quiet hours; added a free rule-based enricher fallback (zero API cost); noted GitHub Actions cron + Supabase pause caveats; reordered the build plan to ship reliable API/ATS data first.
