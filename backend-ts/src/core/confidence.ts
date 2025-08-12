import type { Safety } from '../schema';

export function computeConfidence(inputs: { sourceCount: number; newestIso?: string | null }): Safety['confidence'] {
  const { sourceCount } = inputs;
  if (sourceCount >= 2) return 'high';
  if (sourceCount === 1) return 'medium';
  return 'unknown';
}
