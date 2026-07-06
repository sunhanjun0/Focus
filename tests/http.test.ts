import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { createHttpServer } from '../src/server/http.js';
import type { AppConfig } from '../src/config.js';
import type { Logger } from '../src/shared/logger.js';

function testConfig(dbPath: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 17879,
    dbPath,
    privacyMode: 'summary',
    logPath: path.join(path.dirname(dbPath), 'test.jsonl'),
  };
}

const silentLogger: Logger = { write: () => undefined };

describe('http server', () => {
  it('拒绝缺少必填字段的事件', async () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const server = createHttpServer(openDatabase(dbPath), testConfig(dbPath), silentLogger);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      payload: { source: 'codex' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_event');
  });

  it('支持批量摄取并统计重复事件', async () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const server = createHttpServer(openDatabase(dbPath), testConfig(dbPath), silentLogger);
    const payload = {
      events: [
        {
          source: 'ci',
          sourceEventId: 'batch-1',
          occurredAt: '2026-07-02T16:00:00+08:00',
          type: 'automation.completed',
          project: 'Focus',
          summary: '实现批量摄取测试',
        },
        {
          source: 'ci',
          sourceEventId: 'batch-1',
          occurredAt: '2026-07-02T16:00:00+08:00',
          type: 'automation.completed',
          project: 'Focus',
          summary: '实现批量摄取测试',
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().accepted).toBe(1);
    expect(response.json().duplicates).toBe(1);
  });

  it('提供 runs 和 focuses 查询接口', async () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const server = createHttpServer(openDatabase(dbPath), testConfig(dbPath), silentLogger);
    await server.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      payload: {
        source: 'agent',
        sourceEventId: 'query-1',
        occurredAt: '2026-07-02T16:30:00+08:00',
        type: 'conversation.finished',
        project: 'Focus',
        summary: '实现查询 API 测试',
      },
    });

    const runsResponse = await server.inject({ method: 'GET', url: '/v1/runs?limit=5' });
    const focusesResponse = await server.inject({ method: 'GET', url: '/v1/focuses?limit=5' });

    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json().runs).toHaveLength(1);
    expect(focusesResponse.statusCode).toBe(200);
    expect(focusesResponse.json().focuses).toHaveLength(1);
  });

  it('提供 run 详情且不暴露原始正文', async () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const server = createHttpServer(openDatabase(dbPath), testConfig(dbPath), silentLogger);
    const ingestResponse = await server.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      payload: {
        source: 'agent',
        sourceEventId: 'detail-1',
        occurredAt: '2026-07-02T16:45:00+08:00',
        type: 'conversation.finished',
        project: 'Focus',
        summary: '实现 run 详情接口测试',
        content: '这段原始正文不能出现在详情响应中',
      },
    });
    const runId = ingestResponse.json().runId as string;

    const detailResponse = await server.inject({ method: 'GET', url: `/v1/runs/${runId}` });
    const detailText = detailResponse.body;

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().run.event.sourceEventId).toBe('detail-1');
    expect(detailResponse.json().run.checkin.notes).toContain('run 详情接口');
    expect(detailText).not.toContain('这段原始正文不能出现在详情响应中');
  });

  it('run 详情不存在时返回 404', async () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const server = createHttpServer(openDatabase(dbPath), testConfig(dbPath), silentLogger);
    const response = await server.inject({ method: 'GET', url: '/v1/runs/run_missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('run_not_found');
  });
});
