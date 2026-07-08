import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import { getActivityTrend, listRuns, dropCheckin } from '../src/db/repository.js';
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

// 用「今天附近」的日期，保证落在默认 30 天窗口内
function isoDaysAgo(days: number, time = '10:00:00'): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const date = d.toISOString().slice(0, 10);
  return `${date}T${time}+08:00`;
}

describe('D6 活跃度趋势与 runs 排序', () => {
  it('趋势按 occurredAt 的日历日聚合 check-in 与 Focus 数', () => {
    const { db, config } = newDb();
    const day1 = isoDaysAgo(2);
    const day2 = isoDaysAgo(1);

    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 't1',
      occurredAt: day1,
      type: 'conversation.finished',
      project: 'Alpha',
      summary: '实现 Alpha',
      metadata: { files: ['alpha/x.ts'] },
    });
    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 't2',
      occurredAt: day2,
      type: 'conversation.finished',
      project: 'Beta',
      summary: '实现 Beta',
      metadata: { files: ['beta/y.ts'] },
    });

    const trend = getActivityTrend(db, { days: 30 });
    expect(trend.length).toBe(2);
    // ORDER BY date DESC：较新的一天在前
    expect(trend[0].date).toBe(day2.slice(0, 10));
    expect(trend[1].date).toBe(day1.slice(0, 10));
    expect(trend[0].checkins).toBe(1);
    expect(trend[0].focuses).toBe(1);
  });

  it('dropped 的 check-in 不计入趋势', () => {
    const { db, config } = newDb();
    const result = ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'd1',
      occurredAt: isoDaysAgo(1),
      type: 'conversation.finished',
      project: 'Gamma',
      summary: '实现 Gamma',
      metadata: { files: ['gamma/a.ts'] },
    });
    const checkin = db.prepare('SELECT id FROM focus_checkins WHERE run_id = ?').get(result.runId) as { id: string };
    dropCheckin(db, checkin.id);

    const trend = getActivityTrend(db, { days: 30 });
    expect(trend.length).toBe(0);
  });

  it('窗口外（超过 days）的事件被排除', () => {
    const { db, config } = newDb();
    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'old-1',
      occurredAt: isoDaysAgo(100),
      type: 'conversation.finished',
      project: 'Old',
      summary: '很久以前',
      metadata: { files: ['old/a.ts'] },
    });
    const trend = getActivityTrend(db, { days: 30 });
    expect(trend.length).toBe(0);
  });

  it('runs 按 occurredAt 倒序：乱序回填的旧事件排在后面', () => {
    const { db, config } = newDb();
    // 先摄取一个「较新」的事件，再摄取一个 occurredAt 更早的事件（回填）
    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'r-new',
      occurredAt: '2026-07-05T10:00:00+08:00',
      type: 'conversation.finished',
      summary: '新事件',
    });
    ingestEvent(db, config, {
      source: 'codex',
      sourceEventId: 'r-old',
      occurredAt: '2026-07-01T10:00:00+08:00',
      type: 'conversation.finished',
      summary: '回填旧事件',
    });

    const runs = listRuns(db, 10);
    expect(runs.length).toBe(2);
    // 尽管 r-old 后摄取，但 occurredAt 更早，应排在后面
    expect(runs[0].source_event_id).toBe('r-new');
    expect(runs[1].source_event_id).toBe('r-old');
    expect(runs[0].occurred_at).toBe('2026-07-05T10:00:00+08:00');
  });
});
