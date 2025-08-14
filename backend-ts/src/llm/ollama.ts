// src/llm/ollama.ts
export interface ChatOpts { system?: string; temperature?: number; }

export async function summarizeWithOllamaJSON(prompt: string, opts: ChatOpts = {}) {
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
  const content: string = json?.message?.content || '';

  // try to parse JSON block from the model output
  const match = content.match(/\{[\s\S]*\}$/);
  let parsed: any = null;
  try { parsed = match ? JSON.parse(match[0]) : JSON.parse(content); } catch {}
  return { raw: content, json: parsed };
}