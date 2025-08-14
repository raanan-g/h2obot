// Replace your current adapter with this
export interface ChatOpts { system?: string; temperature?: number; }

const SCHEMA = {
  name: "H2oBotResponse",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            publisher: { type: "string" }
          },
          required: ["title", "url"]
        }
      },
      safety: {
        type: "object",
        additionalProperties: false,
        properties: {
          confidence: { type: "string", enum: ["low","medium","high","unknown"] },
          advisories: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                level: { type: "string", enum: ["info","advisory","boil","do-not-drink"] },
                title: { type: "string" },
                body:  { type: "string" }
              },
              required: ["level","title"]
            }
          },
          last_updated: { type: "string", format: "date-time" }
        }
      },
      suggestions: { type: "array", items: { type: "string" } }
    },
    required: ["answer"]
  },
  strict: true
} as const;

async function chatCompletionsJSON(prompt: string, opts: ChatOpts) {
  const base   = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model  = process.env.OPENAI_MODEL    || 'gpt-3.5-turbo';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  // Try Structured Outputs first (Chat Completions supports this via response_format)
  let res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.2,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [
        opts.system ? { role:'system', content: opts.system } : null,
        { role:'user', content: prompt }
      ].filter(Boolean)
    })
  });

  // If the model / account snapshot doesn’t support structured outputs, fall back to JSON mode
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    // 400s like: "Invalid/Unknown parameter: response_format ..." on some snapshots
    if (res.status === 400) {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          response_format: { type: 'json_object' }, // JSON mode fallback
          messages: [
            opts.system ? { role:'system', content: opts.system } : null,
            // Nudge the model to the shape you want (helps JSON mode)
            { role:'user', content: `${prompt}\n\nReturn a JSON object with keys: answer, sources[], safety, suggestions[].` }
          ].filter(Boolean)
        })
      });
    } else {
      console.error('[OpenAI] HTTP', res.status, text.slice(0,200));
      throw new Error(`OpenAI error ${res.status}: ${text.slice(0,200)}`);
    }
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch {}
  return { raw: content, json: parsed };
}

export async function summarizeWithOpenAIJSON(prompt: string, opts: ChatOpts = {}) {
  return chatCompletionsJSON(prompt, opts);
}
