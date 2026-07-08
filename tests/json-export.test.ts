import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import { exportCheckinsToJsonl } from '../src/outputs/json-export.js';
import type { AppConfig } from '../src/config.js';

function testConfig(dbPath: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 17879,
    dbPath,
    privacyMode: 'summary',
    privacyBySource: {},
    logPath: path.join(path.dirname(dbPath), 'test.jsonl'),
    tMatch: 50,
    tCreate: 25,
    dormantDays: 30,
  };
}

describe('json export', () => {
  it('导出通用 check-in JSONL，不包含原始正文', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fie-'));
    const dbPath = path.join(tempDir, 'fie.sqlite');
    const db = openDatabase(dbPath);
    ingestEvent(db, testConfig(dbPath), {
      source: 'generic-webhook',
      sourceEventId: 'evt-export',
      occurredAt: '2026-07-02T15:30:00+08:00',
      type: 'automation.completed',
      project: 'Focus',
      summary: '实现 JSONL 导出测试',
      content: '这段原始正文不应被导出',
      metadata: { files: ['src/outputs/json-export.ts'] },
    });

    const outputPath = path.join(tempDir, 'checkins.jsonl');
    const result = exportCheckinsToJsonl(db, { outputPath, limit: 10 });
    const content = readFileSync(outputPath, 'utf8');
    const firstLine = JSON.parse(content.trim().split('\n')[0] || '{}') as { schemaVersion: string; notes: string };

    expect(result.count).toBe(1);
    expect(firstLine.schemaVersion).toBe('fie.checkin.v1');
    expect(firstLine.notes).toContain('JSONL');
    expect(content).not.toContain('这段原始正文不应被导出');
  });
});
