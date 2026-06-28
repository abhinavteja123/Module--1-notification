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
  const md = full.slice(0, 16000); // token budget — listing grids often sit below page nav

  // 2. Groq extraction call — pull structured listings out of the markdown.
  const sys = `You extract ${config.type} listings from scraped web page markdown for Indian students. ` +
    'Return ONLY JSON: {"items":[{"title":string,"org":string,"link":string,"location":string,"stipend":string,"deadline":string,"tags":string[]}]}. ' +
    'Rules: title = role/position name; org = company; link = the FULL absolute URL to the listing detail page (must start with http); ' +
    'location = city or "Remote"; stipend/deadline = "" if unknown; tags = up to 4 skills. ' +
    `Skip nav/footer/ads — only real ${config.type} postings. If none found return an empty items array.`;
  const user = 'Extract listings from this page markdown:\n\n' + md;

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
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!groqRes.ok) throw new Error(`Groq HTTP ${groqRes.status}: ${(await groqRes.text()).slice(0, 120)}`);
  const data = await groqRes.json();
  const items = JSON.parse(data.choices[0].message.content).items || [];

  // 3. Normalize each extracted item to the standard listing shape.
  return items.map(it => {
    let link = it.link || '';
    if (link.startsWith('http')) {
      // keep as-is
    } else if (config.baseUrl && link) {
      link = config.baseUrl + (link.startsWith('/') ? link : '/' + link);
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
}

module.exports = { scrapeWithJina };
