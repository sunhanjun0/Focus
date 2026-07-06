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
});
