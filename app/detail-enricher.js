// detail-enricher.js
// "LLM scraping": for each NEW + B.Tech-relevant item, fetch the listing page as
// clean text via Jina Reader (free, no key, handles JS), then let Groq pull full
// structured details. No CSS selectors -> survives site redesigns.
// Needs GROQ_API_KEY (the reading is done by the LLM). No key => skipped.

const MODEL = 'llama-3.1-8b-instant';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_DETAIL = 25;       // cap pages per run -> fast + within free limits
const PAGE_CHARS = 6000;     // how much page text to feed the LLM

const UA = { 'User-Agent': 'student-notify/1.0 (+personal project)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Jina Reader: any URL -> clean text. Free, no key for low volume.
async function fetchPageText(url) {
  const res = await fetch('https://r.jina.ai/' + url, {
    headers: { ...UA, 'X-Return-Format': 'text' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  return (await res.text()).slice(0, PAGE_CHARS);
}

async function groqDetails(item, pageText) {
  const sys = 'You read a job/internship/hackathon page for an Indian B.Tech student and ' +
    'return ONLY JSON with these keys: ' +
    '{"summary":string,"skills":string[],"score":number,"description":string,' +
    '"eligibility":string,"stipend":string,"deadline":string,"howToApply":string}. ' +
    'summary: max 14 words. skills: up to 6. score: 0-100 fit for a B.Tech CS/IT student. ' +
    'description: 2-3 sentences. Use "" for anything not found. Do not invent facts.';
  const user = `Listing: ${item.title} @ ${item.org} (${item.location}).\n\nPage text:\n${pageText}`;

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// items: the NEW items this run. Mutates the B.Tech-relevant ones (capped) in place.
async function enrichWithDetails(items) {
  if (!process.env.GROQ_API_KEY) {
    console.log('  (detail-enricher skipped: no GROQ_API_KEY set)');
    return items;
  }
  const targets = items.filter(it => it.btech).slice(0, MAX_DETAIL);
  if (!targets.length) return items;

  console.log(`  LLM-scraping details for ${targets.length} new items (Jina + Groq)...`);
  let ok = 0;
  for (const it of targets) {
    try {
      const text = await fetchPageText(it.link);
      const d = await groqDetails(it, text);
      if (d.summary) it.summary = d.summary;
      if (Array.isArray(d.skills) && d.skills.length) it.skills = d.skills.slice(0, 6);
      if (typeof d.score === 'number') it.score = Math.max(0, Math.min(100, Math.round(d.score)));
      it.details = {
        description: d.description || '',
        eligibility: d.eligibility || '',
        stipend: d.stipend || '',
        deadline: d.deadline || '',
        howToApply: d.howToApply || '',
      };
      ok++;
    } catch (err) {
      console.log(`  detail skip (${it.org}): ${err.message}`);
    }
    await sleep(800); // be polite to Jina + stay under Groq rate limit
  }
  console.log(`  details done: ${ok}/${targets.length}`);
  return items;
}

module.exports = { enrichWithDetails };
