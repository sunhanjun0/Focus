import { z } from 'zod';

export const attentionEventSchema = z.object({
  source: z.string().min(1),
  sourceEventId: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  type: z.string().min(1).regex(/^[a-z0-9-]+\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i),
  project: z.string().min(1).optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const batchIngestSchema = z.object({
  events: z.array(attentionEventSchema).min(1).max(100),
});
