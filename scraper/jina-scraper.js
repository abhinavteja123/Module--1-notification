// jina-scraper.js
// Scrapes JS-rendered job/internship listing pages via Jina Reader (https://r.jina.ai).
// Jina fetches the page server-side, so no client IP / proxy is exposed and no headless
// browser is needed on the runner — it returns clean markdown of the rendered page.
// The Groq LLM then extracts structured listings from that markdown.
// Requires: GROQ_API_KEY env var (free at https://console.groq.com/keys) for extraction —
//   if it is missing this scraper returns [] gracefully so other sources still run.
// Optional: JINA_API_KEY env var (free at https://jina.ai) raises Jina rate limits.

const MODEL = 'llama-3.1-8b-instant';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const JINA_BASE = 'https://r.jina.ai/';
const MAX_MD = 9000;       // chars of markdown sent to Groq — keeps one request under the free-tier per-minute token cap
const GROQ_GAP_MS = 3000;  // spacing inserted after each Groq call

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Serialize ALL Jina→Groq calls across sources. run-all.js dispatches up to 3 jina
// targets concurrently, but Groq's free tier shares one per-minute token (TPM) budget,
// so bursting 5 extractions trips 429/413. A module-level promise chain runs them
// one-at-a-time with a gap, keeping us under the limit.
let groqQueue = Promise.resolve();
function serialize(task) {
  const run = groqQueue.then(task, task);
  groqQueue = run.then(() => sleep(GROQ_GAP_MS), () => sleep(GROQ_GAP_MS));
  return run;
}

// One Groq extraction call. Throws an Error with `.status` set on 429/413 so the
// caller can shrink (413) or back off (429).
async function callGroq(sys, md) {
  const groqRes = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: 'Extract listings from this page markdown:\n\n' + md },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!groqRes.ok) {
    const err = new Error(`Groq HTTP ${groqRes.status}: ${(await groqRes.text()).slice(0, 120)}`);
    err.status = groqRes.status;
    throw err;
  }
  const data = await groqRes.json();
  if (!data.choices?.length) throw new Error('Groq returned no choices');
  const content = data.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.log(`  [jina] Groq returned non-JSON — raw: ${(content || '').slice(0, 200)}`);
    throw err;
  }
  if (!Array.isArray(parsed.items)) {
    console.log(`  [jina] Groq response missing .items array (keys: ${Object.keys(parsed).join(',')}) — treating as empty`);
    return [];
  }
  return parsed.items;
}

// Extract with self-healing: on 413 (request too large) halve the markdown and retry;
// on 429 (rate limit) back off and retry. Up to 3 attempts, then give up.
async function extract(sys, md0) {
  let md = md0;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callGroq(sys, md);
    } catch (err) {
      lastErr = err;
      if (err.status === 413 && md.length > 1500) {
        const half = Math.floor(md.length / 2);
        console.log(`  [jina] Groq 413 — shrinking markdown ${md.length}→${half} chars (retry ${attempt + 1}/3)`);
        md = md.slice(0, half);
        continue;
      }
      if (err.status === 429 && attempt < 2) { await sleep(20000 * (attempt + 1)); continue; }
      throw err;
    }
  }
  // Exhausted retries — throw so run-all.js logs [FAIL] and records ok:false (not a silent empty source).
  throw lastErr || new Error('Jina extraction exhausted retries');
}

/**
 * Scrape a page using Jina Reader (markdown) + Groq LLM extraction.
 * @param {object} config - target config from targets.json (scraper: "jina")
 * @returns {Array<{title, org, link, location, stipend, deadline, tags, type, source, india, description}>}
 */
async function scrapeWithJina(config) {
  if (!process.env.GROQ_API_KEY) {
    console.log(`  (Jina skipped for ${config.name}: extraction needs GROQ_API_KEY — set it as a GitHub secret)`);
    return [];
  }

  // 1. Fetch the rendered page markdown from Jina Reader (server-side, no client IP exposed).
  const headers = { 'X-Return-Format': 'markdown' };
  if (process.env.JINA_API_KEY) {
    headers['Authorization'] = 'Bearer ' + process.env.JINA_API_KEY;
  }

  const res = await fetch(JINA_BASE + config.url, {
    headers,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error('Jina HTTP ' + res.status);
  const full = await res.text();
  const md = full.slice(0, MAX_MD); // listing grids often sit below page nav

  // 2. Groq extraction — serialized + self-healing to respect the shared free-tier budget.
  const sys = `You extract ${config.type} listings from scraped web page markdown for Indian students. ` +
    'Return ONLY JSON: {"items":[{"title":string,"org":string,"link":string,"location":string,"stipend":string,"deadline":string,"tags":string[]}]}. ' +
    'Rules: title = role/position name; org = company; link = the FULL absolute URL to the listing detail page (must start with http); ' +
    'location = city or "Remote"; stipend/deadline = "" if unknown; tags = up to 4 skills. ' +
    `Skip nav/footer/ads — only real ${config.type} postings. If none found return an empty items array.`;

  const items = await serialize(() => extract(sys, md));

  // 3. Normalize each extracted item to the standard listing shape.
  const base = config.baseUrl ? config.baseUrl.replace(/\/$/, '') : '';
  const kept = items.map(it => {
    let link = it.link || '';
    if (link.startsWith('http')) {
      // keep as-is
    } else if (base && link) {
      link = base + (link.startsWith('/') ? link : '/' + link);
    } else {
      link = '';
    }
    return {
      title:       it.title || '',
      org:         it.org || config.name,
      link,
      location:    it.location || (config.india ? 'India' : ''),
      stipend:     it.stipend || null,
      deadline:    it.deadline || null,
      tags:        Array.isArray(it.tags) ? it.tags.slice(0, 4) : [],
      type:        config.type,
      source:      config.name,
      india:       !!config.india,
      description: '',
    };
  }).filter(r => r.title && r.link && r.link.startsWith('http'));

  if (items.length > 0 && kept.length === 0) {
    console.log(`  [jina] ${config.name}: extracted ${items.length} but kept 0 — check baseUrl config or absolute links`);
  }
  return kept;
}

module.exports = { scrapeWithJina };
