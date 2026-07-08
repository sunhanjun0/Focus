import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolvePrivacyMode } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';

const baseEnv = {
  FIE_DB_PATH: './data/x.sqlite',
  FIE_LOG_PATH: './logs/x.jsonl',
};

describe('config per-source 隐私（D5）', () => {
  it('解析 FIE_PRIVACY_BY_SOURCE 映射', () => {
    const config = loadConfig({ ...baseEnv, FIE_PRIVACY_BY_SOURCE: '{"ci":"metadata","codex":"local_raw"}' });
    expect(config.privacyBySource).toEqual({ ci: 'metadata', codex: 'local_raw' });
  });

  it('缺省时映射为空对象', () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.privacyBySource).toEqual({});
  });

  it('非法 JSON 报错', () => {
    expect(() => loadConfig({ ...baseEnv, FIE_PRIVACY_BY_SOURCE: 'not-json' })).toThrow();
  });

  it('非法 privacyMode 值报错', () => {
    expect(() => loadConfig({ ...baseEnv, FIE_PRIVACY_BY_SOURCE: '{"ci":"bogus"}' })).toThrow();
  });

  it('resolvePrivacyMode：有覆盖用覆盖，无覆盖回退全局', () => {
    const config = loadConfig({ ...baseEnv, FIE_PRIVACY_MODE: 'summary', FIE_PRIVACY_BY_SOURCE: '{"ci":"metadata"}' });
    expect(resolvePrivacyMode(config, 'ci')).toBe('metadata');
    expect(resolvePrivacyMode(config, 'codex')).toBe('summary');
  });

  it('覆盖比全局更宽松也按配置生效（全局 metadata，某来源 local_raw）', () => {
    const config = loadConfig({ ...baseEnv, FIE_PRIVACY_MODE: 'metadata', FIE_PRIVACY_BY_SOURCE: '{"agent":"local_raw"}' });
    expect(resolvePrivacyMode(config, 'agent')).toBe('local_raw');
  });

  it('per-source 覆盖影响实际摄取脱敏结果', () => {
    const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
    const db = openDatabase(dbPath);
    // 全局 local_raw 会保留脱敏正文，但对 ci 覆盖为 metadata：不写摘要/正文
    const config = loadConfig({
      FIE_DB_PATH: dbPath,
      FIE_LOG_PATH: path.join(path.dirname(dbPath), 'x.jsonl'),
      FIE_PRIVACY_MODE: 'local_raw',
      FIE_PRIVACY_BY_SOURCE: '{"ci":"metadata"}',
    });

    const result = ingestEvent(db, config, {
      source: 'ci',
      sourceEventId: 'privacy-1',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'automation.completed',
      summary: '这是摘要',
      content: '这是正文',
    });

    const row = db.prepare('SELECT redacted_summary, content FROM attention_events WHERE id = (SELECT event_id FROM ingestion_runs WHERE id = ?)')
      .get(result.runId) as { redacted_summary: string | null; content: string | null };
    expect(row.redacted_summary).toBeNull();
    expect(row.content).toBeNull();
  });
});
