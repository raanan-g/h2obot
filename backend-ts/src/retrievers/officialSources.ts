// src/retrievers/officialSources.ts
import * as cheerio from 'cheerio';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { parseDate } from 'chrono-node';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.mjs';

// --- Location heuristics ----------------------------------------------------
const RETRIEVER_DEBUG = (process.env.RETRIEVER_DEBUG === '1' || process.env.DEBUG_RETRIEVER === '1');
const RETRIEVER_STRICT_LOCAL = (process.env.RETRIEVER_STRICT_LOCAL !== '0');

function norm(s: string) { return (s||'').toLowerCase().trim(); }
function tokens(s: string) { return norm(s).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }

// Minimal map for common test locations; extend over time
const STATE_DOMAINS: Record<string,string[]> = {
  'NY': ['health.ny.gov', 'nyc.gov', 'dep.nyc.gov'],
  'MI': ['michigan.gov', 'cityofflint.com', 'geneseecountymi.gov'],
  'MS': ['msdh.ms.gov', 'jacksonms.gov'],
  'CA': ['waterboards.ca.gov', 'cdph.ca.gov', 'ocgov.com', 'ocsd.org'],
  'TX': ['tceq.texas.gov', 'austintexas.gov', 'traviscountytx.gov', 'austinwater.org'],
  'FL': ['floridahealth.gov', 'floridadep.gov'],
  // NEW — Pennsylvania / Pittsburgh
  'PA': ['dep.pa.gov', 'pennsylvania.gov', 'alleghenycounty.us', 'pittsburghpa.gov', 'pgh2o.com']
};

function deriveLocalDomains(location: string): string[] {
  const st = inferStateCode(location);
  const list = new Set<string>();
  if (st && STATE_DOMAINS[st]) STATE_DOMAINS[st].forEach(d=>list.add(d));

  const L = norm(location);
  if (/(^|\b)nyc(\b|$)|new york city|manhattan|brooklyn|queens|bronx|staten island/.test(L)) {
    list.add('nyc.gov'); list.add('dep.nyc.gov');
  }
  if (/flint/.test(L)) { list.add('cityofflint.com'); list.add('michigan.gov'); }
  if (/jackson/.test(L) && (st==='MS' || /mississippi/.test(L))) { list.add('jacksonms.gov'); list.add('msdh.ms.gov'); }
  if (/travis county|austin/.test(L)) { list.add('traviscountytx.gov'); list.add('austintexas.gov'); list.add('tceq.texas.gov'); list.add('austinwater.org'); }
  if (/pittsburgh|allegheny/.test(L)) { list.add('pgh2o.com'); list.add('alleghenycounty.us'); list.add('dep.pa.gov'); list.add('pittsburghpa.gov'); }

  return Array.from(list);
}

function inferStateCode(location: string): string | null {
  const m = location.match(/\b([A-Z]{2})\b/); if (m) return m[1].toUpperCase();
  const L = norm(location);
  const dict: Record<string,string> = {
    'new york':'NY','michigan':'MI','mississippi':'MS','california':'CA','texas':'TX','florida':'FL'
  };
  for (const k of Object.keys(dict)) if (L.includes(k)) return dict[k];
  return null;
}

function host(href: string): string {
  try { return new URL(href).hostname.toLowerCase(); } catch { return ''; }
}

function hostMatchesAllowed(href: string, allowed: string[]): boolean {
  const h = host(href); if (!h) return false;
  return allowed.some(d => h === d || h.endsWith('.'+d));
}

function strongLocationMatch(docTitle: string, docText: string|undefined, loc: string): boolean {
  const want = new Set(tokens(loc));
  const hay = (docTitle + ' ' + (docText||'')).toLowerCase();
  let hits = 0; for (const t of want) { if (t.length>=3 && hay.includes(t)) hits++; }
  return hits >= Math.min(2, Math.max(1, Math.floor(want.size/2)));
}

export interface RetrievedDoc {
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string; // ISO
  snippet?: string;
  text?: string;
  contentType?: string;
  score?: number; // ranking score
  tier?: 'federal' | 'state' | 'local' | 'other';
}

const UA = 'H2obot/1.0 (+https://example.local)';

const DOMAIN_TIERS: Record<string, RetrievedDoc['tier']> = {
  'epa.gov': 'federal', 'cdc.gov': 'federal', 'who.int': 'federal',
};

function tierFor(url: string): RetrievedDoc['tier'] {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.endsWith('.gov')) return h.includes('epa.gov') || h.includes('cdc.gov') ? 'federal' : 'state';
    if (h.endsWith('.us')) return 'local';
    return DOMAIN_TIERS[h] ?? 'other';
  } catch { return 'other'; }
}

function cleanText(t: string) {
  return t.replace(/\s+/g, ' ').trim();
}

async function fetchBuffer(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const lastMod = res.headers.get('last-modified') || undefined;
  return { buf, ct, lastMod };
}

function extractDateFromHtml($: cheerio.CheerioAPI): string | undefined {
  const meta = [
    $('meta[name="date"]').attr('content'),
    $('meta[name="last-modified"]').attr('content'),
    $('meta[property="article:published_time"]').attr('content'),
    $('time').attr('datetime')
  ].find(Boolean);
  const candidate = meta || $('time').first().text();
  const parsed = candidate ? parseDate(candidate) : undefined;
  return parsed ? new Date(parsed).toISOString() : undefined;
}

async function parseHtml(url: string, html: string): Promise<RetrievedDoc> {
  const $ = cheerio.load(html);
  const title = cleanText($('title').first().text() || 'Untitled');
  const bodyText = cleanText($('main').text() || $('article').text() || $('body').text());
  const publishedAt = extractDateFromHtml($);
  const snippet = cleanText(bodyText.slice(0, 400));
  return { url, title, text: bodyText, snippet, publishedAt, contentType: 'text/html', tier: tierFor(url) };
}

async function parsePdf(url: string, buf: Buffer): Promise<RetrievedDoc> {
  // Load PDF from a buffer
  const loadingTask = pdfjsLib.getDocument({
    data: buf,
    // Hardening flags for server-side use:
    isEvalSupported: false,
    useSystemFonts: true,
    // Avoid fetch in worker since we already have the bytes:
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;

  // Extract text from the first ~10–12 pages to keep it fast
  const textChunks: string[] = [];
  const maxPages = Math.min(pdf.numPages, 12);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageText = (tc.items as any[])
      .map((it) => ('str' in it ? it.str : (it as any).text ?? ''))
      .join(' ');
    textChunks.push(pageText);
    if (textChunks.join(' ').length > 20000) break; // cap total text
  }

  const raw = textChunks.join('\n');
  const text = raw.replace(/\s+/g, ' ').trim();
  const title = text.split('\n')[0]?.slice(0, 120) || 'PDF';
  const parsed = parseDate(text.slice(0, 3000));
  const publishedAt = parsed ? new Date(parsed).toISOString() : undefined;
  const snippet = text.slice(0, 400);

  return {
    url,
    title,
    text,
    snippet,
    publishedAt,
    contentType: 'application/pdf',
    tier: tierFor(url),
  };
}


async function fetchAndParse(url: string): Promise<RetrievedDoc | null> {
  try {
    const { buf, ct, lastMod } = await fetchBuffer(url);
    if (ct.includes('pdf')) {
      const doc = await parsePdf(url, buf);
      if (!doc.publishedAt && lastMod) doc.publishedAt = new Date(lastMod).toISOString();
      return doc;
    } else if (ct.includes('html') || ct.includes('text')) {
      const doc = await parseHtml(url, buf.toString('utf-8'));
      if (!doc.publishedAt && lastMod) doc.publishedAt = new Date(lastMod).toISOString();
      return doc;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// --- Built-in curated hints (works without a search key) ------------------
function curatedSeeds(location: string): string[] {
  const seeds: string[] = [
    'https://www.epa.gov/ccr',
    'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html',
  ];
  const locals = deriveLocalDomains(location);
  const has = (d: string) => locals.some(h => h === d || h.endsWith('.'+d));

  if (has('nyc.gov') || has('dep.nyc.gov')) {
    seeds.push('https://www.nyc.gov/site/dep/water/drinking-water-quality-reports.page');
  }
  if (has('michigan.gov')) {
    seeds.push('https://www.michigan.gov/egle');
  }
  if (has('jacksonms.gov')) {
    seeds.push('https://www.jacksonms.gov/');
  }
  if (has('tceq.texas.gov')) {
    seeds.push('https://www.tceq.texas.gov/drinkingwater');
  }
  if (has('austintexas.gov') || has('austinwater.org')) {
    seeds.push('https://www.austintexas.gov/department/water');
  }
  if (has('pgh2o.com')) {
    seeds.push('https://www.pgh2o.com/your-water/water-quality');
  }
  if (has('alleghenycounty.us')) {
    seeds.push('https://www.alleghenycounty.us/Health-Department');
  }
  if (has('dep.pa.gov')) {
    seeds.push('https://www.dep.pa.gov/Citizens/My-Water/Pages/default.aspx');
  }

  return seeds;
}

// --- Optional: Tavily (simple web search API) -----------------------------
async function tavilySearch(query: string, includeDomains: string[]): Promise<{ url: string; title: string; }[]> {
  const key = process.env.TAVILY_API_KEY; if (!key) return [];
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      query,
      include_domains: includeDomains,   // precise allow‑list
      include_answer: false,
      max_results: 8,
    })
  });
  if (!resp.ok) { if (RETRIEVER_DEBUG) console.log('[retriever] tavily http', resp.status); return []; }
  const json: any = await resp.json();
  const results = Array.isArray(json.results) ? json.results : [];
  if (RETRIEVER_DEBUG) console.log('[retriever] tavily for', query, '→', results.map((r:any)=>host(r.url)));
  return results.map((r: any) => ({ url: r.url, title: r.title }));
}

function scoreDoc(d: RetrievedDoc, location: string, question: string): number {
  const t = (d.title + ' ' + (d.text?.slice(0, 4000) || '')).toLowerCase();
  const loc = location.toLowerCase();
  let s = 0;
  if (d.tier === 'federal') s += 3;
  if (d.tier === 'state') s += 2;
  if (d.tier === 'local') s += 2;
  if (t.includes(loc)) s += 2;
  if (/boil|do\s*not\s*drink|advisory|notice/.test(t)) s += 2;
  // recency boost
  if (d.publishedAt) {
    const ageDays = (Date.now() - new Date(d.publishedAt).getTime()) / 864e5;
    if (ageDays < 60) s += 2; else if (ageDays < 365) s += 1;
  }
  return s;
}

export async function fetchAuthoritative(location: string, question: string) : Promise<RetrievedDoc[]> {
  const baseAllow = ['epa.gov','cdc.gov'];
  const localAllow = deriveLocalDomains(location);
  const allow = Array.from(new Set([...baseAllow, ...localAllow]));

  // Build targeted queries; avoid super‑broad site:.gov which returns random cities
  const cityQ = `${question} ${location}`.trim();
  const queries = [
    cityQ,
    `${location} Consumer Confidence Report`,
    `${location} drinking water report`,
    `${location} boil water notice`,
  ];

  const seeds = new Set<string>(curatedSeeds(location));

  if (process.env.SEARCH_PROVIDER === 'tavily' && process.env.TAVILY_API_KEY) {
    for (const q of queries) {
      const results = await tavilySearch(q, allow);
      results.forEach(r => seeds.add(r.url));
    }
  }

  // Fetch & parse
  const rawDocs: RetrievedDoc[] = [];
  for (const u of seeds) {
    const doc = await fetchAndParse(u);
    if (doc) rawDocs.push(doc);
  }

  // Filter: require either allowed host OR strong location mention
  const filtered = rawDocs.filter(d => {
    const okHost = hostMatchesAllowed(d.url, allow);
    const okLoc  = strongLocationMatch(d.title, d.text, location);
    const keep = okHost || (!RETRIEVER_STRICT_LOCAL && okLoc);
    if (RETRIEVER_DEBUG && !keep) console.log('[retriever] drop', host(d.url), 'title=', d.title.slice(0,80));
    return keep;
  });

  // Score and pick top N
  function score(d: RetrievedDoc): number {
    let s = 0;
    if (hostMatchesAllowed(d.url, baseAllow)) s += 3;
    if (hostMatchesAllowed(d.url, localAllow)) s += 4; // prefer local/state
    if (strongLocationMatch(d.title, d.text, location)) s += 2;
    if (/(boil|do\s*not\s*drink|advisory|notice)/i.test((d.text||'') + ' ' + d.title)) s += 2;
    if (/(pws(a)?|pgh2o|austin water|dep|deq|ddw)/i.test((d.text||'') + ' ' + d.title)) s += 1;
    if (d.publishedAt) {
      const ageDays = (Date.now() - new Date(d.publishedAt).getTime()) / 864e5;
      if (ageDays < 60) s += 2; else if (ageDays < 365) s += 1;
    }
    return s;
  }

  filtered.forEach(d => d.score = score(d));
  filtered.sort((a,b)=> (b.score||0) - (a.score||0));
  const top = filtered.slice(0, 6);

  if (RETRIEVER_DEBUG) console.log('[retriever] selected=', top.map(d => ({host:host(d.url), title:d.title.slice(0,70), score:d.score})));
  return top;
}