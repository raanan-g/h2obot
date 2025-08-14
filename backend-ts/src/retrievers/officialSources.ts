// src/retrievers/officialSources.ts
import * as cheerio from 'cheerio';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { parseDate } from 'chrono-node';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.mjs';

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
  const locQ = encodeURIComponent(location);
  return [
    // EPA CCR portal + search query link for the location
    'https://www.epa.gov/ccr',
    `https://www.epa.gov/ccr/search?query=${locQ}`,
    // CDC advisories overview
    'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html',
  ];
}

// --- Optional: Tavily (simple web search API) -----------------------------
async function tavilySearch(query: string): Promise<{ url: string; title: string; }[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ query, include_domains: ['epa.gov','cdc.gov','.gov','.us'], include_answer: false, max_results: 8 })
  });
  if (!resp.ok) return [];
  const json: any = await resp.json();
  const results = Array.isArray(json.results) ? json.results : [];
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

export async function fetchAuthoritative(location: string, question: string): Promise<RetrievedDoc[]> {
  const queries = [
    `${question} ${location} site:epa.gov`,
    `${location} Consumer Confidence Report site:epa.gov`,
    `${location} boil water notice site:.gov`,
    `${location} water quality report site:.us`,
  ];

  const seeds = new Set<string>(curatedSeeds(location));
  if (process.env.SEARCH_PROVIDER === 'tavily' && process.env.TAVILY_API_KEY) {
    for (const q of queries) {
      const results = await tavilySearch(q);
      results.forEach(r => seeds.add(r.url));
    }
  }

  const docs: RetrievedDoc[] = [];
  for (const u of seeds) {
    const doc = await fetchAndParse(u);
    if (doc) docs.push(doc);
  }

  // Rank and keep top N
  docs.forEach(d => d.score = scoreDoc(d, location, question));
  docs.sort((a,b)=> (b.score||0) - (a.score||0));
  return docs.slice(0, 6);
}