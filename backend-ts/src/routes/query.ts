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
