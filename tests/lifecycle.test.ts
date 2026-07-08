import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import { archiveFocus, mergeFocuses, sweepDormantFocuses } from '../src/db/repository.js';
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

function newDb() {
  const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-')), 'fie.sqlite');
  const db = openDatabase(dbPath);
  return { db, config: testConfig(dbPath) };
}

function createTwoFocuses(db: ReturnType<typeof newDb>['db'], config: AppConfig) {
  const first = ingestEvent(db, config, {
    source: 'codex',
    sourceEventId: 'alpha-1',
    occurredAt: '2026-07-02T15:00:00+08:00',
    type: 'conversation.finished',
    project: 'Alpha',
    summary: '实现 Alpha 模块',
    metadata: { files: ['alpha/x.ts'] },
  });
  const second = ingestEvent(db, config, {
    source: 'codex',
    sourceEventId: 'beta-1',
    occurredAt: '2026-07-02T15:05:00+08:00',
    type: 'conversation.finished',
    project: 'Beta',
    summary: '实现 Beta 模块',
    metadata: { files: ['beta/y.ts'] },
  });
  return { first, second };
}

describe('Focus 生命周期', () => {
  it('merge：check-in 指针改指目标，源置 merged，写审计', () => {
    const { db, config } = newDb();
    const { first, second } = createTwoFocuses(db, config);
    expect(first.decision).toBe('create_and_check_in');
    expect(second.decision).toBe('create_and_check_in');

    const ok = mergeFocuses(db, second.focusId!, first.focusId!, '同一主题');
    expect(ok).toBe(true);

    const repointed = db.prepare('SELECT COUNT(*) AS count FROM focus_checkins WHERE focus_id = ?').get(first.focusId) as { count: number };
    expect(repointed.count).toBe(2);

    const merged = db.prepare('SELECT status, merged_into FROM focuses WHERE id = ?').get(second.focusId) as { status: string; merged_into: string };
    expect(merged.status).toBe('merged');
    expect(merged.merged_into).toBe(first.focusId);

    const audit = db.prepare("SELECT COUNT(*) AS count FROM focus_events WHERE kind = 'merge' AND from_focus_id = ? AND to_focus_id = ?")
      .get(second.focusId, first.focusId) as { count: number };
    expect(audit.count).toBe(1);
  });

  it('merged Focus 不再参与匹配', () => {
    const { db, config } = newDb();
    const { first, second } = createTwoFocuses(db, config);
    mergeFocuses(db, second.focusId!, first.focusId!);

    // 再摄取一条命中 Beta 路径的事件，不应匹配到已 merged 的 Focus
    const again = ingestEvent(db, config, {
      source: 'ci',
      sourceEventId: 'beta-2',
      occurredAt: '2026-07-02T16:00:00+08:00',
      type: 'automation.completed',
      metadata: { files: ['beta/y.ts', 'beta/z.ts'] },
    });
    expect(again.focusId).not.toBe(second.focusId);
  });

  it('archive：状态置 archived 并写审计', () => {
    const { db, config } = newDb();
    const { first } = createTwoFocuses(db, config);
    const ok = archiveFocus(db, first.focusId!, '不再关注');
    expect(ok).toBe(true);

    const row = db.prepare('SELECT status FROM focuses WHERE id = ?').get(first.focusId) as { status: string };
    expect(row.status).toBe('archived');
    const audit = db.prepare("SELECT COUNT(*) AS count FROM focus_events WHERE kind = 'archive' AND from_focus_id = ?").get(first.focusId) as { count: number };
    expect(audit.count).toBe(1);
  });

  it('archive 不存在的 Focus 返回 false', () => {
    const { db } = newDb();
    expect(archiveFocus(db, 'focus_missing')).toBe(false);
  });

  it('sweep：超期未活跃的 active 置为 dormant', () => {
    const { db, config } = newDb();
    const { first } = createTwoFocuses(db, config);
    // 手动把 first 的活跃时间改到很久以前
    db.prepare('UPDATE focuses SET last_activity_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', first.focusId);

    const changed = sweepDormantFocuses(db, config.dormantDays);
    expect(changed).toBe(1);
    const row = db.prepare('SELECT status FROM focuses WHERE id = ?').get(first.focusId) as { status: string };
    expect(row.status).toBe('dormant');
  });

  it('低置信匹配写入 check-in low_confidence 标记', () => {
    const { db, config } = newDb();
    // 创建一个含单个路径的 Focus
    const base = ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'lc-1',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'conversation.finished',
      project: 'Gamma',
      summary: '实现 Gamma',
      metadata: { files: ['gamma/a.ts'] },
    });
    expect(base.decision).toBe('create_and_check_in');

    // 第二条只共享一个完整路径（+25）+ 近期活跃（+5）= 30，落入 [25,50) 低置信区间
    const low = ingestEvent(db, config, {
      source: 'ci',
      sourceEventId: 'lc-2',
      occurredAt: '2026-07-02T15:10:00+08:00',
      type: 'automation.completed',
      metadata: { files: ['gamma/a.ts'] },
    });
    expect(low.decision).toBe('check_in');
    expect(low.lowConfidence).toBe(true);
    expect(low.focusId).toBe(base.focusId);

    const row = db.prepare('SELECT low_confidence FROM focus_checkins WHERE source_event_id = ?').get('lc-2') as { low_confidence: number };
    expect(row.low_confidence).toBe(1);
  });
});
