import { FastifyInstance } from 'fastify';
import { handleQuery } from '../core/orchestrator';

// Small helpers for a pleasant streaming UX
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function chunkByWords(text: string, max = 60): string[] {
  if (!text) return [];
  const parts: string[] = [];
  let buf = '';
  for (const token of text.split(/(\s+)/)) { // keep spaces as tokens
    if ((buf + token).length > max && buf.trim().length) {
      parts.push(buf);
      buf = token.trimStart();
    } else {
      buf += token;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

export default async function route(app: FastifyInstance) {
  // NOTE: fastify-sse-v2 is registered in src/index.ts
  app.get('/api/h2obot/stream', async (req, reply) => {
    // Build the same shape the JSON route expects
    const { q = '', location = null } = (req.query as any) || {};
    const body = {
      messages: [{ role: 'user', content: String(q) }],
      location: (location ?? null) as string | null,
    };

    // Track early disconnects
    let cancelled = false;
    const onClose = () => { cancelled = true; };
    req.raw.on('close', onClose);

    try {
      // Always send an opening event so the client knows the stream is alive
      reply.sse({ data: JSON.stringify({ type: 'start' }) });

      // Reuse the orchestrator pipeline (retrieval + LLM JSON summary or fallback)
      let result;
      try {
        result = await handleQuery(body);
      } catch (err: any) {
        reply.sse({ data: JSON.stringify({ type: 'delta', text: 'Sorry — I hit an issue fetching results.\n' }) });
        reply.sse({ data: JSON.stringify({ type: 'done' }) });
        return;
      }

      if (cancelled) return;

      // Stream the final answer text in small word-boundary chunks
      const answer = String(result.answer || '');
      const chunks = chunkByWords(answer, 64);
      for (const ch of chunks) {
        if (cancelled) return;
        reply.sse({ data: JSON.stringify({ type: 'delta', text: ch }) });
        // tiny delay improves perceived streaming in browsers
        await sleep(35);
      }

      if (cancelled) return;

      // Then send the metadata events expected by the frontend
      reply.sse({ data: JSON.stringify({ type: 'sources', sources: result.sources || [] }) });
      reply.sse({ data: JSON.stringify({ type: 'safety', safety: result.safety || {} }) });
      reply.sse({ data: JSON.stringify({ type: 'suggestions', suggestions: result.suggestions || [] }) });

      // Finish the stream
      reply.sse({ data: JSON.stringify({ type: 'done' }) });
    } finally {
      req.raw.off('close', onClose);
    }
  });
}
