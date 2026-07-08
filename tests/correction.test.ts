import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import { reassignCheckin, confirmCheckin, dropCheckin, getCorrectionStats } from '../src/db/repository.js';
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

function checkinIdOf(db: ReturnType<typeof newDb>['db'], sourceEventId: string): string {
  const row = db.prepare('SELECT id FROM focus_checkins WHERE source_event_id = ?').get(sourceEventId) as { id: string };
  return row.id;
}

describe('D3 纠正闭环', () => {
  it('reassign：指针改指目标、置 corrected、写审计、合并目标路径', () => {
    const { db, config } = newDb();
    const { first, second } = createTwoFocuses(db, config);
    const checkinId = checkinIdOf(db, 'beta-1');

    const ok = reassignCheckin(db, checkinId, first.focusId!, '归错了');
    expect(ok).toBe(true);

    const row = db.prepare('SELECT focus_id, corrected FROM focus_checkins WHERE id = ?').get(checkinId) as {
      focus_id: string;
      corrected: number;
    };
    expect(row.focus_id).toBe(first.focusId);
    expect(row.corrected).toBe(1);

    const audit = db
      .prepare("SELECT COUNT(*) AS count FROM focus_events WHERE kind = 'reassign' AND checkin_id = ? AND from_focus_id = ? AND to_focus_id = ?")
      .get(checkinId, second.focusId, first.focusId) as { count: number };
    expect(audit.count).toBe(1);

    // 目标 Focus 应并入被改归 check-in 的路径
    const focus = db.prepare('SELECT paths_json FROM focuses WHERE id = ?').get(first.focusId) as { paths_json: string };
    const paths = JSON.parse(focus.paths_json) as string[];
    expect(paths).toContain('beta/y.ts');
  });

  it('reassign：check-in 不存在或目标非法返回 false', () => {
    const { db, config } = newDb();
    const { first } = createTwoFocuses(db, config);
    const checkinId = checkinIdOf(db, 'alpha-1');
    expect(reassignCheckin(db, 'chk_missing', first.focusId!)).toBe(false);
    expect(reassignCheckin(db, checkinId, 'focus_missing')).toBe(false);
    // 改归到自身归属应失败
    expect(reassignCheckin(db, checkinId, first.focusId!)).toBe(false);
  });

  it('confirm：清除 low_confidence 并写审计', () => {
    const { db, config } = newDb();
    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'lc-1',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'conversation.finished',
      project: 'Gamma',
      summary: '实现 Gamma',
      metadata: { files: ['gamma/a.ts'] },
    });
    const low = ingestEvent(db, config, {
      source: 'ci',
      sourceEventId: 'lc-2',
      occurredAt: '2026-07-02T15:10:00+08:00',
      type: 'automation.completed',
      metadata: { files: ['gamma/a.ts'] },
    });
    expect(low.lowConfidence).toBe(true);

    const checkinId = checkinIdOf(db, 'lc-2');
    const ok = confirmCheckin(db, checkinId, '归对了');
    expect(ok).toBe(true);

    const row = db.prepare('SELECT low_confidence FROM focus_checkins WHERE id = ?').get(checkinId) as { low_confidence: number };
    expect(row.low_confidence).toBe(0);
    const audit = db.prepare("SELECT COUNT(*) AS count FROM focus_events WHERE kind = 'confirm' AND checkin_id = ?").get(checkinId) as {
      count: number;
    };
    expect(audit.count).toBe(1);
  });

  it('drop：软删除标记 dropped 且写审计，不物理删除', () => {
    const { db, config } = newDb();
    createTwoFocuses(db, config);
    const checkinId = checkinIdOf(db, 'alpha-1');

    const ok = dropCheckin(db, checkinId, '误记录');
    expect(ok).toBe(true);

    const row = db.prepare('SELECT dropped FROM focus_checkins WHERE id = ?').get(checkinId) as { dropped: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.dropped).toBe(1);
    const audit = db.prepare("SELECT COUNT(*) AS count FROM focus_events WHERE kind = 'delete_checkin' AND checkin_id = ?").get(checkinId) as {
      count: number;
    };
    expect(audit.count).toBe(1);
  });

  it('getCorrectionStats：修正率与低置信占比计算正确', () => {
    const { db, config } = newDb();
    const { first, second } = createTwoFocuses(db, config);
    // 再加一条低置信 check-in（共 3 条）
    ingestEvent(db, config, {
      source: 'ci',
      sourceEventId: 'alpha-2',
      occurredAt: '2026-07-02T15:20:00+08:00',
      type: 'automation.completed',
      metadata: { files: ['alpha/x.ts'] },
    });

    const reassignId = checkinIdOf(db, 'beta-1');
    reassignCheckin(db, reassignId, first.focusId!);

    const stats = getCorrectionStats(db);
    expect(stats.totalCheckins).toBe(3);
    expect(stats.correctedCheckins).toBe(1);
    expect(stats.lowConfidenceCheckins).toBe(1);
    // 修正事件 1（reassign），总 check-in 3
    expect(stats.correctionEvents).toBe(1);
    expect(stats.correctionRate).toBeCloseTo(1 / 3);
    expect(stats.lowConfidenceRate).toBeCloseTo(1 / 3);
    expect(second.focusId).toBeDefined();
  });
});
