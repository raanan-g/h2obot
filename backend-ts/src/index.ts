import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sse from 'fastify-sse-v2';
import queryRoute from './routes/query';
import streamRoute from './routes/stream';
import * as dotenv from 'dotenv';
dotenv.config();

console.log('[H2OBOT] LLM provider=%s model=%s base=%s',
  (process.env.LLM_PROVIDER || 'ollama'),
  (process.env.LLM_PROVIDER || '').toLowerCase() === 'openai'
    ? (process.env.OPENAI_MODEL || 'gpt-3.5-turbo')
    : (process.env.OLLAMA_MODEL || 'llama3:8b-instruct'),
  (process.env.LLM_PROVIDER || '').toLowerCase() === 'openai'
    ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
);

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
