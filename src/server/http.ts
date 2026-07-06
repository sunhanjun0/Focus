import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../shared/logger.js';
import { getRunDetail, listFocusRows, listRuns } from '../db/repository.js';
import { ingestEvent } from '../ingestion/ingest-event.js';
import { attentionEventSchema, batchIngestSchema } from '../ingestion/schema.js';

export function createHttpServer(db: Db, config: AppConfig, logger: Logger) {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({ ok: true, service: 'focus-ingestion-engine' }));

  server.get('/v1/runs', async (request) => {
    const query = request.query as { limit?: string };
    const limit = parseLimit(query.limit);
    return { runs: listRuns(db, limit) };
  });

  server.get('/v1/runs/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const run = getRunDetail(db, params.id);
    if (!run) {
      return reply.code(404).send({ error: { code: 'run_not_found', message: '未找到指定 ingestion run' } });
    }
    return { run };
  });

  server.get('/v1/focuses', async (request) => {
    const query = request.query as { limit?: string };
    const limit = parseLimit(query.limit);
    return { focuses: listFocusRows(db, limit) };
  });

  server.post('/v1/events/ingest', async (request, reply) => {
    try {
      const event = attentionEventSchema.parse(request.body);
      const result = ingestEvent(db, config, event);
      logger.write('info', 'ingestion:api', 'event_ingested', {
        runId: result.runId,
        source: event.source,
        sourceEventId: event.sourceEventId,
        decision: result.decision,
        deduplicated: result.deduplicated,
      });
      return reply.code(result.deduplicated ? 200 : 202).send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: 'invalid_event',
            message: '事件格式无效',
            details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          },
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.write('error', 'ingestion:api', 'event_ingest_failed', { error: message });
      return reply.code(500).send({ error: { code: 'internal_error', message: '事件摄取失败' } });
    }
  });

  server.post('/v1/events/batch', async (request, reply) => {
    try {
      const payload = batchIngestSchema.parse(request.body);
      const results = payload.events.map((event) => {
        const result = ingestEvent(db, config, event);
        logger.write('info', 'ingestion:api', 'event_ingested', {
          runId: result.runId,
          source: event.source,
          sourceEventId: event.sourceEventId,
          decision: result.decision,
          deduplicated: result.deduplicated,
          batch: true,
        });
        return { source: event.source, sourceEventId: event.sourceEventId, ...result };
      });
      const accepted = results.filter((result) => result.status === 'accepted').length;
      const duplicates = results.filter((result) => result.status === 'duplicate').length;
      return reply.code(202).send({ status: 'accepted', accepted, duplicates, results });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: 'invalid_batch',
            message: '批量事件格式无效',
            details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          },
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.write('error', 'ingestion:api', 'batch_ingest_failed', { error: message });
      return reply.code(500).send({ error: { code: 'internal_error', message: '批量事件摄取失败' } });
    }
  });

  return server;
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(Math.trunc(parsed), 200);
}
