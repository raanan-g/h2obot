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
