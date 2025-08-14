// src/core/orchestrator.ts
import { QueryRequestZ, QueryResponseZ, type QueryResponse } from '../schema';
import { fetchAuthoritative } from '../retrievers/officialSources';
import { summarizeWithOpenAIJSON } from '../llm/openai';
import { summarizeWithOllamaJSON } from '../llm/ollama'; // keep existing

const SYSTEM_PROMPT = `You are H2obot, a careful assistant for public water guidance.
Summarize findings for a general audience. Prefer official sources (EPA, CDC, state DEQ, municipal utilities).
NEVER invent facts or citations. If uncertain, say so and suggest how to verify.
Output STRICT JSON with this shape:
{
  "answer": string,
  "sources": {"title": string, "url": string, "publisher"?: string}[],
  "safety": {"confidence"?: "low"|"medium"|"high"|"unknown", "advisories"?: {"level": "info"|"advisory"|"boil"|"do-not-drink", "title": string}[], "last_updated"?: string},
  "suggestions": string[]
}`;

function contextFromDocs(docs: {url:string; title:string; text?:string; publishedAt?:string; }[]): string {
  return docs.map((d,i)=>`[${i+1}] ${d.title}\nURL: ${d.url}\nUpdated: ${d.publishedAt ?? 'unknown'}\nExcerpt: ${(d.text||'').slice(0,800)}\n`).join('\n');
}

export async function handleQuery(reqBody: unknown): Promise<QueryResponse> {
  const { messages, location } = QueryRequestZ.parse(reqBody);
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const question = lastUser?.content ?? '';
  const loc = location ?? '';

  // Retrieve
  const docs = await fetchAuthoritative(loc, question);

  // If no docs at all, fallback to a minimal safe answer
  if (!docs.length) {
    const fallback: QueryResponse = {
      answer: "I couldn't find authoritative documents for that location just now. Try your city/county utility site or the EPA CCR locator.",
      sources: [{ title: 'EPA Consumer Confidence Reports (CCR)', url: 'https://www.epa.gov/ccr', publisher: 'US EPA' }],
      safety: { confidence: 'unknown', advisories: [], last_updated: new Date().toISOString() },
      suggestions: ['Where do I find my city’s CCR?', 'Is there a boil-water notice today?']
    };
    return QueryResponseZ.parse(fallback);
  }

  // Summarize with LLM
  const ctx = contextFromDocs(docs);
  const prompt = `${SYSTEM_PROMPT}\n\nUser question: ${question}\nLocation hint: ${loc}\n\nSources:\n${ctx}\n\nRespond in strict JSON.`;

  let llm;
  try {
      if ((process.env.LLM_PROVIDER || '').toLowerCase() === 'openai') {
        llm = await summarizeWithOpenAIJSON(prompt, { temperature: 0.1, system: SYSTEM_PROMPT });
      } else {
        llm = await summarizeWithOllamaJSON(prompt, { temperature: 0.1, system: SYSTEM_PROMPT });
      }
  } catch (e) {
    // LLM unavailable -> construct a basic answer from top doc
    const top = docs[0];
    const minimal: QueryResponse = {
      answer: `Based on ${top.title}, here is the latest we found. (Model offline: using heuristic summary)`,
      sources: docs.map(d=>({ title: d.title, url: d.url, publisher: d.publisher || new URL(d.url).hostname })),
      safety: { confidence: 'medium', advisories: [], last_updated: top.publishedAt },
      suggestions: ['Check your utility’s CCR', 'Ask: Are there PFAS advisories near me?']
    };
    return QueryResponseZ.parse(minimal);
  }

  if (llm.json) {
    // Use model JSON but keep our sources canonical
    const resp: QueryResponse = {
      answer: String(llm.json.answer || '').trim() || '(No answer)',
      sources: docs.map(d=>({ title: d.title, url: d.url, publisher: d.publisher || new URL(d.url).hostname })),
      safety: llm.json.safety || { confidence: 'unknown', advisories: [], last_updated: docs[0]?.publishedAt },
      suggestions: Array.isArray(llm.json.suggestions) ? llm.json.suggestions.slice(0,4) : []
    };
    return QueryResponseZ.parse(resp);
  }

  // If parsing failed, return a conservative fallback
  const top = docs[0];
  const fallback: QueryResponse = {
    answer: (llm.raw || '').slice(0, 800) || 'No answer. Please try again.',
    sources: docs.map(d=>({ title: d.title, url: d.url, publisher: d.publisher || new URL(d.url).hostname })),
    safety: { confidence: 'unknown', advisories: [], last_updated: top?.publishedAt },
    suggestions: ['Where do I find my city’s CCR?']
  };
  return QueryResponseZ.parse(fallback);
}