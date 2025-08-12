#!/usr/bin/env bash
set -euo pipefail

# H2obot — Backend TypeScript scaffolder (Fastify + Zod + SSE)
# NOTE: uses fastify-sse-v2 (unscoped) to avoid @fastify/sse-v2 404s.
# Usage:
#   bash bootstrap_h2obot_backend_ts.sh        # creates ./backend-ts
#   bash bootstrap_h2obot_backend_ts.sh api    # creates ./api (custom dir)

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: missing $1"; exit 1; }; }
need node
need npm

ROOT_DIR=${1:-backend-ts}
SRC_DIR="$ROOT_DIR/src"

mkdir -p "$SRC_DIR"/{routes,core,retrievers,llm}

###############################################################################
# package.json — uses fastify-sse-v2
###############################################################################
cat > "$ROOT_DIR/package.json" << 'JSON'
{
  "name": "h2obot-backend-ts",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@fastify/cors": "^9.0.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "fastify-sse-v2": "^3.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "tsx": "^4.19.1",
    "typescript": "^5.5.4"
  }
}
JSON

###############################################################################
# tsconfig.json
###############################################################################
cat > "$ROOT_DIR/tsconfig.json" << 'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
JSON

###############################################################################
# .env.sample and .gitignore
###############################################################################
cat > "$ROOT_DIR/.env.sample" << 'ENV'
PORT=8787
# Optional (Phase 2): local LLM via Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b-instruct
ENV

cat > "$ROOT_DIR/.gitignore" << 'GIT'
node_modules
.env
/dist
.DS_Store
GIT

###############################################################################
# src/schema.ts — Zod schemas & types
###############################################################################
cat > "$SRC_DIR/schema.ts" << 'TS'
import { z } from 'zod';

export const RoleZ = z.enum(['user', 'assistant']);
export const MessageZ = z.object({ role: RoleZ, content: z.string().min(1) });
export const SourceZ = z.object({ title: z.string(), url: z.string().url(), publisher: z.string().optional() });
export const AdvisoryZ = z.object({ level: z.enum(['info', 'advisory', 'boil', 'do-not-drink']), title: z.string(), body: z.string().optional() });
export const SafetyZ = z.object({
  confidence: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
  advisories: z.array(AdvisoryZ).default([]).optional(),
  last_updated: z.string().datetime().optional(),
});
export const MetricsZ = z.object({
  latency_ms: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export const QueryRequestZ = z.object({ messages: z.array(MessageZ).min(1), location: z.string().min(1).nullable().optional() });
export const QueryResponseZ = z.object({
  answer: z.string(),
  sources: z.array(SourceZ).default([]).optional(),
  safety: SafetyZ.optional(),
  suggestions: z.array(z.string()).default([]).optional(),
  metrics: MetricsZ.optional(),
});

export type Message = z.infer<typeof MessageZ>;
export type QueryRequest = z.infer<typeof QueryRequestZ>;
export type QueryResponse = z.infer<typeof QueryResponseZ>;
export type Safety = z.infer<typeof SafetyZ>;
export type Advisory = z.infer<typeof AdvisoryZ>;
export type Source = z.infer<typeof SourceZ>;
TS

###############################################################################
# src/core/demo.ts — demo answers
###############################################################################
cat > "$SRC_DIR/core/demo.ts" << 'TS'
import type { QueryResponse } from '../schema';

const now = () => new Date().toISOString();

export function demoFor(text: string): QueryResponse {
  const t = text.toLowerCase();
  if (t.includes('new york') || t.includes('nyc')) {
    return {
      answer: 'Yes — NYC tap water generally meets or exceeds federal/state standards. Use cold water and run the tap ~30 seconds if unused for hours. Older buildings may have lead; a certified lead‑removing filter is prudent for infants and pregnant people.',
      sources: [
        { title: 'NYC 2024 Water Quality Report', url: 'https://www.nyc.gov/site/dep/water/drinking-water-quality-reports.page', publisher: 'NYC DEP' },
        { title: 'Lead in Drinking Water Basics', url: 'https://www.epa.gov/ground-water-and-drinking-water/lead-drinking-water-basic-information', publisher: 'US EPA' },
      ],
      safety: { confidence: 'high', advisories: [], last_updated: now() },
      suggestions: ['How do I get a free lead test kit in NYC?', 'Are PFAS detected in my borough?'],
    };
  }
  if (t.includes('flint')) {
    return {
      answer: 'Caution. Flint has replaced many lead service lines and recent samples are often below action levels, but premise plumbing can still leach lead. Use a certified lead‑removing filter and follow city notices.',
      sources: [
        { title: 'City of Flint Water Quality Updates', url: 'https://www.cityofflint.com/updates/water/', publisher: 'City of Flint' },
        { title: 'Lead and Copper Rule', url: 'https://www.epa.gov/dwreginfo/lead-and-copper-rule', publisher: 'US EPA' },
      ],
      safety: { confidence: 'medium', advisories: [{ level: 'advisory', title: 'Use certified lead‑removing filter' }], last_updated: now() },
      suggestions: ['Where can I pick up replacement filter cartridges?'],
    };
  }
  if (t.includes('jackson')) {
    return {
      answer: 'Mixed. Jackson, MS has faced intermittent system issues and advisories. Check current notices. If none are active, properly treated water may be safe; consider a point‑of‑use filter and keep emergency water on hand.',
      sources: [
        { title: 'City of Jackson Water Updates', url: 'https://www.jacksonms.gov/', publisher: 'City of Jackson' },
        { title: 'CDC Boil Water Advisories', url: 'https://www.cdc.gov/healthywater/emergency/drinking/drinking-water-advisories.html', publisher: 'CDC' },
      ],
      safety: { confidence: 'low', advisories: [{ level: 'boil', title: 'Monitor boil‑water notices' }], last_updated: now() },
      suggestions: ['Is there a boil‑water notice today?'],
    };
  }
  return {
    answer: 'I couldn’t find specifics for that location in the demo. Try the nearest city/county and state.',
    sources: [{ title: 'Consumer Confidence Reports (CCR)', url: 'https://www.epa.gov/ccr', publisher: 'US EPA' }],
    safety: { confidence: 'unknown', advisories: [], last_updated: now() },
    suggestions: ['Where do I find my city’s CCR?', 'How to test my tap for lead?'],
  };
}
TS

###############################################################################
# src/core/confidence.ts — simple rubric
###############################################################################
cat > "$SRC_DIR/core/confidence.ts" << 'TS'
import type { Safety } from '../schema';

export function computeConfidence(inputs: { sourceCount: number; newestIso?: string | null }): Safety['confidence'] {
  const { sourceCount } = inputs;
  if (sourceCount >= 2) return 'high';
  if (sourceCount === 1) return 'medium';
  return 'unknown';
}
TS

###############################################################################
# src/core/orchestrator.ts — main handler
###############################################################################
cat > "$SRC_DIR/core/orchestrator.ts" << 'TS'
import { QueryRequestZ, QueryResponseZ, type QueryResponse } from '../schema';
import { demoFor } from './demo';

export type { QueryResponse };

export async function handleQuery(reqBody: unknown): Promise<QueryResponse> {
  const { messages, location } = QueryRequestZ.parse(reqBody);
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = `${location ?? ''} ${lastUser?.content ?? ''}`.trim();

  // TODO: plug in retriever + LLM summarizer in Phase 2
  const response = demoFor(text);
  return QueryResponseZ.parse(response);
}
TS

###############################################################################
# src/routes/query.ts — POST /api/h2obot/query
###############################################################################
cat > "$SRC_DIR/routes/query.ts" << 'TS'
import { FastifyInstance } from 'fastify';
import { handleQuery } from '../core/orchestrator';

export default async function route(app: FastifyInstance) {
  app.post('/api/h2obot/query', async (req, reply) => {
    try {
      const data = await handleQuery(req.body);
      return reply.send({ ...data, metrics: { latency_ms: Math.floor(Math.random()*200)+200, tokens_in: 400, tokens_out: 180 } });
    } catch (err: any) {
      req.log.error(err);
      return reply.status(400).send({ title: 'Bad Request', detail: err?.message ?? 'Validation error' });
    }
  });
}
TS

###############################################################################
# src/routes/stream.ts — GET /api/h2obot/stream (SSE)
###############################################################################
cat > "$SRC_DIR/routes/stream.ts" << 'TS'
import { FastifyInstance } from 'fastify';
import sse from 'fastify-sse-v2';
import { demoFor } from '../core/demo';

export default async function route(app: FastifyInstance) {
  if (!(app as any).sse) await app.register(sse);

  app.get('/api/h2obot/stream', (req, reply) => {
    const { q = '' } = (req.query as any) || {};
    reply.sse({ data: JSON.stringify({ type: 'start' }) });

    const data = demoFor(String(q));
    const chunks = data.answer.match(/.{1,60}(\s|$)/g) || [data.answer];

    let i = 0;
    const timer = setInterval(() => {
      if (i < chunks.length) {
        reply.sse({ data: JSON.stringify({ type: 'delta', text: chunks[i] }) });
        i++;
      } else {
        reply.sse({ data: JSON.stringify({ type: 'sources', sources: data.sources }) });
        reply.sse({ data: JSON.stringify({ type: 'safety', safety: data.safety }) });
        reply.sse({ data: JSON.stringify({ type: 'suggestions', suggestions: data.suggestions }) });
        reply.sse({ data: JSON.stringify({ type: 'done' }) });
        clearInterval(timer);
      }
    }, 80);

    req.raw.on('close', () => clearInterval(timer));
  });
}
TS

###############################################################################
# src/retrievers/officialSources.ts — stub for Phase 2
###############################################################################
cat > "$SRC_DIR/retrievers/officialSources.ts" << 'TS'
export interface RetrievedDoc { url: string; title: string; publisher?: string; publishedAt?: string; excerpt?: string; }

export async function fetchAuthoritative(location: string, question: string): Promise<RetrievedDoc[]> {
  // TODO: implement real fetching + parsing of EPA/CDC/state DEQ/utility pages
  return [];
}
TS

###############################################################################
# src/llm/ollama.ts — optional local LLM adapter
###############################################################################
cat > "$SRC_DIR/llm/ollama.ts" << 'TS'
export interface ChatOpts { system?: string; temperature?: number; }

export async function summarizeWithOllama(prompt: string, opts: ChatOpts = {}) {
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct';

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        opts.system ? { role: 'system', content: opts.system } : null,
        { role: 'user', content: prompt }
      ].filter(Boolean),
      stream: false,
      options: { temperature: opts.temperature ?? 0.2 }
    })
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const json = await res.json();
  return (json?.message?.content as string) || '';
}
TS

###############################################################################
# src/index.ts — server bootstrap
###############################################################################
cat > "$SRC_DIR/index.ts" << 'TS'
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sse from 'fastify-sse-v2';
import queryRoute from './routes/query';
import streamRoute from './routes/stream';

const PORT = Number(process.env.PORT || 8787);

async function main() {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: true });
  await app.register(sse);

  await app.register(queryRoute);
  await app.register(streamRoute);

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`H2obot backend running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
TS

###############################################################################
# Install dependencies
###############################################################################
(
  cd "$ROOT_DIR" && npm install
)

if [ ! -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env.sample" "$ROOT_DIR/.env"
fi

cat << 'NEXT'

✅ H2obot backend (TypeScript) scaffolded at ./'"$ROOT_DIR"'

Run it locally:
  cd '"$ROOT_DIR"'
  npm run dev

If you previously attempted @fastify/sse-v2 and got E404, clear any partial installs:
  rm -rf node_modules package-lock.json && npm cache verify && npm install

Test JSON endpoint:
  curl -s http://localhost:8787/api/h2obot/query \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"Should I drink the water in New York City?"}],"location":"New York, NY"}' | jq .

Test SSE endpoint:
  curl -N 'http://localhost:8787/api/h2obot/stream?session=dev&q=Flint'

Point the frontend to this backend:
  // in the browser console
  window.H2OBOT_MODE = 'JSON'   // or 'SSE'
  window.H2OBOT_API_BASE = 'http://localhost:8787'
  window.location.reload()

NEXT
