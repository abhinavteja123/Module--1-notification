// groq-enricher.js
// OPTIONAL: enrich NEW items with the Groq LLM API (free tier, OpenAI-compatible).
// Adds: a 1-line student summary, skill tags, and a 0-100 B.Tech-fit score.
// If GROQ_API_KEY is not set, this is skipped and items pass through unchanged.
// Get a free key at https://console.groq.com/keys

const MODEL = 'llama-3.1-8b-instant'; // fast + high free-tier limits
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const BATCH = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGroq(batch) {
  const compact = batch.map(it => ({
    id: it.id, type: it.type, title: it.title, org: it.org, location: it.location, tags: it.tags,
  }));

  const sys = 'You enrich job/internship/hackathon listings for Indian B.Tech students. ' +
    'Return ONLY JSON: {"items":[{"id":string,"summary":string,"skills":string[],"score":number}]}. ' +
    'summary: max 14 words, plain, student-facing. skills: up to 5 tech skills implied by the role. ' +
    'score: 0-100 fit for a B.Tech CS/IT student (entry-level + tech-relevant = high).';
  const user = 'Enrich these. Return the same "id" string for each:\n' + JSON.stringify(compact);

  const res = await fetch(ENDPOINT, {
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

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed.items || [];
}

// items: array of NEW items to enrich (mutated in place). Returns the same array.
async function enrichNewItems(items) {
  if (!process.env.GROQ_API_KEY) {
    console.log('  (Groq skipped: no GROQ_API_KEY set)');
    return items;
  }
  // Skip items that already have a summary.
  const todo = items.filter(it => !it.summary);
  if (!todo.length) return items;

  console.log(`  Groq enriching ${todo.length} new items (metadata)...`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const enriched = await callGroq(batch);
      const byId = Object.fromEntries(batch.map(it => [it.id, it]));
      for (const e of enriched) {
        const target = byId[e.id];
        if (!target) { console.log(`  Groq returned unknown id ${e.id} — skipped`); continue; }
        if (e.summary) target.summary = e.summary;
        if (Array.isArray(e.skills) && e.skills.length) target.skills = e.skills.slice(0, 5);
        if (typeof e.score === 'number') target.score = Math.max(0, Math.min(100, Math.round(e.score)));
      }
    } catch (err) {
      console.log(`  Groq batch ${i / BATCH} failed: ${err.message} (kept raw)`);
    }
    if (i + BATCH < todo.length) await sleep(1200); // stay under rate limit
  }
  return items;
}

module.exports = { enrichNewItems };
