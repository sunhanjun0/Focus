import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../shared/logger.js';
import { getActivityTrend, getRunDetail, listFocusRows, listRuns } from '../db/repository.js';
import { ingestEvent } from '../ingestion/ingest-event.js';
import { attentionEventSchema, batchIngestSchema } from '../ingestion/schema.js';

export function createHttpServer(db: Db, config: AppConfig, logger: Logger) {
  const server = Fastify({ logger: false });

  // 本地测试页面跨源支持：仅对本机来源（localhost/127.0.0.1/[::1] 及 file:// 的 "null" 源）
  // 放行并处理浏览器预检 OPTIONS。网络暴露面仍由 FIE_HOST 绑定地址控制，CORS 不扩大暴露。
  server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && isLocalOrigin(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('access-control-max-age', '600');
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  // 静态页托管：测试控制台与接口文档随服务分发，浏览器可直接访问（同源，无需 CORS）。
  // 路由为固定白名单、不接受用户提供的文件名，故无路径遍历风险。
  const publicDir = path.resolve('public');
  const staticPages: Array<{ route: string; file: string }> = [
    { route: '/', file: 'test-console.html' },
    { route: '/console', file: 'test-console.html' },
    { route: '/docs', file: 'api-docs.html' },
  ];
  for (const page of staticPages) {
    server.get(page.route, async (_request, reply) => {
      try {
        const html = fs.readFileSync(path.join(publicDir, page.file), 'utf8');
        return reply.type('text/html; charset=utf-8').send(html);
      } catch {
        return reply.code(404).send({ error: { code: 'page_not_found', message: '静态页面缺失' } });
      }
    });
  }

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
    const query = request.query as { limit?: string; includeArchived?: string };
    const limit = parseLimit(query.limit);
    const includeArchived = query.includeArchived === 'true' || query.includeArchived === '1';
    return { focuses: listFocusRows(db, limit, { includeArchived }) };
  });

  server.get('/v1/trend', async (request) => {
    const query = request.query as { days?: string; focusId?: string };
    const days = parseDays(query.days);
    return { trend: getActivityTrend(db, { days, focusId: query.focusId }) };
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
      // 逐条隔离：任一条摄取失败不影响其余已成功项，失败计入结果（code-review #7）。
      const results = payload.events.map((event) => {
        try {
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.write('error', 'ingestion:api', 'event_ingest_failed', {
            source: event.source,
            sourceEventId: event.sourceEventId,
            batch: true,
            error: message,
          });
          return { source: event.source, sourceEventId: event.sourceEventId, status: 'failed' as const, error: '事件摄取失败' };
        }
      });
      const accepted = results.filter((result) => result.status === 'accepted').length;
      const duplicates = results.filter((result) => result.status === 'duplicate').length;
      const failed = results.filter((result) => result.status === 'failed').length;
      return reply.code(202).send({ status: 'accepted', accepted, duplicates, failed, results });
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

function parseDays(value: string | undefined): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(Math.trunc(parsed), 365);
}

function isLocalOrigin(origin: string): boolean {
  if (origin === 'null') return true; // file:// 打开的本地页面，Origin 为字符串 "null"
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}
