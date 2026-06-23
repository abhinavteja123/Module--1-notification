# Student Notifications — minimal app

A notification center that pulls **hackathons, internships, and jobs** from free sources
(Devpost, Remotive, Arbeitnow, company Greenhouse boards) and shows them with direct links.
No accounts, no API keys, no paid services.

## Run it (2 steps)

1. Get the latest opportunities (needs Node 18+):
   ```
   node fetch-opportunities.js
   ```
   This writes `data.js` (~hundreds of real listings).

2. Open `index.html` in your browser. That's the notification center.

## What you get

- Tabs: All / Hackathons / Internships / Jobs (with counts)
- Search by title or company
- Each card has a **View →** link to the original listing
- **New** items are highlighted; the bell shows an unread count
- **Enable alerts** button → real browser notifications for new items
- "Seen" state is remembered in your browser (localStorage)

## Auto-refresh every 6 hours

Each run pulls **live** data from the APIs and only flags genuinely **new** listings
(tracked in `seen-ids.json`). Three ways to automate it:

1. **Keep it running locally** (simplest):
   ```
   node scheduler.js
   ```
   Runs now + every 6h while the terminal stays open.

2. **Windows Task Scheduler** (background, survives reboot): create a Basic Task →
   trigger Daily, repeat every 6 hours → action: `node` with argument
   `fetch-opportunities.js`, "Start in" = this `app` folder.

3. **GitHub Actions** (cloud — runs even when your PC is off): push this project to a
   GitHub repo. `.github/workflows/refresh.yml` already runs every 6h and commits fresh
   data. (Best for a hosted/shared version.)

## Optional: smarter details with Groq (free LLM)

Set a free Groq key to auto-add a 1-line summary, skill tags, and a 0-100 B.Tech-fit
score to **new** items only (stays within free limits):

```
# PowerShell, before running:
$env:GROQ_API_KEY = "gsk_your_key_here"
node fetch-opportunities.js
```

Get a free key at https://console.groq.com/keys . No key = this step is skipped, app
still works. For GitHub Actions, add `GROQ_API_KEY` as a repo secret.

## Manual refresh

Re-run `node fetch-opportunities.js` anytime and refresh the page. New listings since
your last visit show up highlighted with an alert.

## Add more sources

Open `fetch-opportunities.js`:
- **More companies' jobs:** add a slug to `GREENHOUSE_COMPANIES`. Find the slug from a careers
  URL like `boards.greenhouse.io/<slug>`.
- **More job boards / hackathon sources:** copy one of the `from...()` adapter functions,
  point it at another free JSON API, and add it to the `Promise.all([...])` list in `main()`.

## Notes / limits

- Covers a lot, not literally everything — no free source has every listing. Add sources to widen coverage.
- Sites that block bots (LinkedIn, Naukri, Internshala) are deliberately not included — they need
  fragile scraping and violate their terms. The sources here are all free public JSON.
- This is the standalone MVP. The full hosted version (auto-refresh every 6h, push to phones,
  accounts, personalization) is specced in `../student-notification-platform.md`.
