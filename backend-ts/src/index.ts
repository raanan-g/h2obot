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
