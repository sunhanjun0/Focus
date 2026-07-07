import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import type { AppConfig } from '../src/config.js';

function testConfig(dbPath: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 17879,
    dbPath,
    privacyMode: 'summary',
    logPath: path.join(path.dirname(dbPath), 'test.jsonl'),
    tMatch: 50,
    tCreate: 25,
    dormantDays: 30,
  };
}

describe('ingest event', () => {
  it('首次摄取创建 Focus，重复摄取返回 duplicate', () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const db = openDatabase(dbPath);
    const config = testConfig(dbPath);
    const event = {
      source: 'codex',
      sourceEventId: 'evt-idempotency',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'conversation.finished',
      project: 'Focus',
      summary: '实现 ingestion 幂等测试',
      metadata: { files: ['src/ingestion/ingest-event.ts'] },
    };

    const first = ingestEvent(db, config, event);
    const second = ingestEvent(db, config, event);

    expect(first.status).toBe('accepted');
    expect(first.decision).toBe('create_and_check_in');
    expect(first.focusId).toBeTruthy();
    expect(second.status).toBe('duplicate');
    expect(second.deduplicated).toBe(true);

    const checkinCount = db.prepare('SELECT COUNT(*) as count FROM focus_checkins').get() as { count: number };
    expect(checkinCount.count).toBe(1);
  });

  it('不同来源改动同一批文件收敛到同一 Focus（跨工具归因）', () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const db = openDatabase(dbPath);
    const config = testConfig(dbPath);

    const files = ['src/db/repository.ts', 'src/db/schema.sql'];
    const codexEvent = {
      source: 'codex',
      sourceEventId: 'codex-1',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'conversation.finished',
      project: 'Focus',
      summary: '实现仓库层文件路径写入',
      metadata: { files },
    };
    const ciEvent = {
      source: 'ci',
      sourceEventId: 'ci-1',
      occurredAt: '2026-07-02T15:10:00+08:00',
      type: 'automation.completed',
      metadata: { files },
    };

    const first = ingestEvent(db, config, codexEvent);
    const second = ingestEvent(db, config, ciEvent);

    expect(first.decision).toBe('create_and_check_in');
    expect(second.decision).toBe('check_in');
    expect(second.focusId).toBe(first.focusId);

    const focusCount = db.prepare('SELECT COUNT(*) as count FROM focuses').get() as { count: number };
    expect(focusCount.count).toBe(1);
    const checkinCount = db.prepare('SELECT COUNT(*) as count FROM focus_checkins').get() as { count: number };
    expect(checkinCount.count).toBe(2);
  });
});
