#!/usr/bin/env node
// 阈值校准工具（回填 open question #3）。
//
// 给定一份事件语料（JSON），对一组候选阈值 (T_match, T_create) 分别用真实摄取
// 流水线重放整份语料到临时库，统计各档决策分布与新建 Focus 数，帮助在有真实数据
// 时选择默认阈值，避免拍脑袋。不修改任何持久化数据（每次跑在独立临时库）。
//
// 用法：
//   npm run calibrate -- <corpus.json> [--tmatch 40,50,60] [--tcreate 20,25,30]
//
// 语料格式：可为事件数组 `[...]`，或批量对象 `{ "events": [...] }`。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { ingestEvent } from '../src/ingestion/ingest-event.js';
import { attentionEventSchema } from '../src/ingestion/schema.js';
import type { AppConfig } from '../src/config.js';
import type { AttentionEventInput } from '../src/shared/types.js';

interface CliArgs {
  corpusPath: string;
  tMatchGrid: number[];
  tCreateGrid: number[];
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let tMatchGrid = [40, 50, 60];
  let tCreateGrid = [20, 25, 30];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tmatch') {
      tMatchGrid = parseNumberList(argv[(i += 1)]);
    } else if (arg === '--tcreate') {
      tCreateGrid = parseNumberList(argv[(i += 1)]);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) {
    throw new Error('缺少语料文件路径。用法：npm run calibrate -- <corpus.json> [--tmatch a,b] [--tcreate a,b]');
  }
  return { corpusPath: path.resolve(positional[0]), tMatchGrid, tCreateGrid };
}

function parseNumberList(raw: string | undefined): number[] {
  if (!raw) throw new Error('--tmatch/--tcreate 需要逗号分隔的数值');
  return raw.split(',').map((part) => {
    const value = Number(part.trim());
    if (!Number.isFinite(value) || value < 0) throw new Error(`非法阈值：${part}`);
    return Math.trunc(value);
  });
}

function loadCorpus(corpusPath: string): AttentionEventInput[] {
  const raw = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { events?: unknown[] }).events;
  if (!Array.isArray(list)) {
    throw new Error('语料必须是事件数组或 { "events": [...] } 对象');
  }
  return list.map((item, index) => {
    const result = attentionEventSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`语料第 ${index} 条事件格式无效：${result.error.issues.map((i) => i.message).join('; ')}`);
    }
    return result.data;
  });
}

function tempConfig(tMatch: number, tCreate: number): AppConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fie-calib-'));
  return {
    host: '127.0.0.1',
    port: 0,
    dbPath: path.join(dir, 'fie.sqlite'),
    privacyMode: 'summary',
    privacyBySource: {},
    logPath: path.join(dir, 'calib.jsonl'),
    tMatch,
    tCreate: Math.min(tCreate, tMatch),
    dormantDays: 30,
  };
}

interface RunOutcome {
  skip: number;
  checkInHigh: number;
  checkInLow: number;
  create: number;
  duplicate: number;
  focuses: number;
}

function replay(events: AttentionEventInput[], config: AppConfig): RunOutcome {
  const db = openDatabase(config.dbPath);
  const outcome: RunOutcome = { skip: 0, checkInHigh: 0, checkInLow: 0, create: 0, duplicate: 0, focuses: 0 };
  for (const event of events) {
    const result = ingestEvent(db, config, event);
    if (result.deduplicated) {
      outcome.duplicate += 1;
    } else if (result.decision === 'skip') {
      outcome.skip += 1;
    } else if (result.decision === 'create_and_check_in') {
      outcome.create += 1;
    } else if (result.decision === 'check_in') {
      if (result.lowConfidence) outcome.checkInLow += 1;
      else outcome.checkInHigh += 1;
    }
  }
  const focusRow = db.prepare("SELECT COUNT(*) AS count FROM focuses WHERE status != 'merged'").get() as { count: number };
  outcome.focuses = focusRow.count;
  db.close();
  return outcome;
}

// 用基准阈值重放一次，收集实质事件的最佳候选分数，输出分数分布，
// 辅助判断阈值该落在哪些分数带之间。
function scoreHistogram(events: AttentionEventInput[]): { scores: number[]; buckets: Map<string, number> } {
  const config = tempConfig(50, 25);
  const db = openDatabase(config.dbPath);
  const scores: number[] = [];
  for (const event of events) {
    const result = ingestEvent(db, config, event);
    if (result.deduplicated || result.decision === 'skip' || !result.runId) continue;
    const row = db.prepare('SELECT candidates_json FROM ingestion_runs WHERE id = ?').get(result.runId) as
      | { candidates_json: string }
      | undefined;
    if (!row) continue;
    const candidates = JSON.parse(row.candidates_json) as Array<{ score: number }>;
    scores.push(candidates[0]?.score ?? 0);
  }
  db.close();

  const buckets = new Map<string, number>();
  for (const score of scores) {
    const low = Math.floor(score / 10) * 10;
    const key = `${low}-${low + 9}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return { scores, buckets };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const events = loadCorpus(args.corpusPath);
  console.log(`语料：${args.corpusPath}`);
  console.log(`事件数：${events.length}`);
  console.log('');

  const { scores, buckets } = scoreHistogram(events);
  console.log('== 实质事件最佳候选分数分布（基准阈值 50/25 重放）==');
  if (scores.length === 0) {
    console.log('（无实质候选分数：语料多为首次出现或 trivial 事件）');
  } else {
    const sortedKeys = [...buckets.keys()].sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]));
    for (const key of sortedKeys) {
      const count = buckets.get(key) ?? 0;
      console.log(`  ${key.padStart(7)} | ${'#'.repeat(count)} ${count}`);
    }
  }
  console.log('');

  console.log('== 阈值扫描：各组 (T_match, T_create) 的决策分布 ==');
  const header = ['T_match', 'T_create', 'skip', 'checkIn(高)', 'checkIn(低)', 'create', 'dup', 'Focus 数'];
  const rows: string[][] = [header];
  for (const tMatch of args.tMatchGrid) {
    for (const tCreate of args.tCreateGrid) {
      if (tCreate > tMatch) continue;
      const outcome = replay(events, tempConfig(tMatch, tCreate));
      rows.push([
        String(tMatch),
        String(tCreate),
        String(outcome.skip),
        String(outcome.checkInHigh),
        String(outcome.checkInLow),
        String(outcome.create),
        String(outcome.duplicate),
        String(outcome.focuses),
      ]);
    }
  }
  printTable(rows);
  console.log('');
  console.log('解读：Focus 数越小说明越收敛（碎片化越低）；checkIn(低) 是进复核队列的量。');
  console.log('目标：在不误并（checkIn 高置信合理）与不碎片化（create/Focus 数受控）间取平衡。');
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  for (const row of rows) {
    console.log(row.map((cell, col) => cell.padStart(widths[col])).join('  '));
  }
}

main();
