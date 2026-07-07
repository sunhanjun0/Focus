#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { getRunDetail, listRuns, archiveFocus, mergeFocuses, sweepDormantFocuses } from '../db/repository.js';
import { ingestEvent } from '../ingestion/ingest-event.js';
import { attentionEventSchema } from '../ingestion/schema.js';
import { exportCheckinsToJsonl } from '../outputs/json-export.js';

export function createCliProgram(): Command {
  const program = new Command();
  program.name('fie').description('Focus Ingestion Engine 本地调试 CLI').version('0.1.0');

  program
    .command('ingest')
    .description('摄取一个本地事件 JSON 文件')
    .argument('<file>', '事件 JSON 文件路径')
    .action((file: string) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      const event = attentionEventSchema.parse(raw);
      const result = ingestEvent(db, config, event);
      console.log(JSON.stringify(result, null, 2));
    });

  const runs = program.command('runs').description('查看 ingestion runs');

  runs
    .command('tail')
    .description('查看最近 ingestion runs')
    .option('-n, --limit <number>', '显示条数', '10')
    .action((options: { limit: string }) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      console.table(listRuns(db, Number(options.limit)));
    });

  runs
    .command('show')
    .description('查看单次 ingestion run 详情')
    .argument('<runId>', 'run ID')
    .action((runId: string) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const detail = getRunDetail(db, runId);
      if (!detail) {
        console.error(`未找到 ingestion run：${runId}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(detail, null, 2));
    });

  const focus = program.command('focus').description('查看与维护 Focus');

  focus
    .command('list', { isDefault: true })
    .description('查看 Focus 列表（默认折叠 archived/merged）')
    .option('--all', '包含 archived/merged', false)
    .action((options: { all?: boolean }) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const whereClause = options.all ? '' : "WHERE status IN ('active', 'dormant')";
      const rows = db.prepare(`
        SELECT id, name, project, status, last_activity_at
        FROM focuses
        ${whereClause}
        ORDER BY last_activity_at DESC
      `).all();
      console.table(rows);
    });

  focus
    .command('merge')
    .description('把一个 Focus 合并进另一个（check-in 指针改指目标）')
    .argument('<fromId>', '被合并的 Focus ID')
    .argument('<intoId>', '合并目标 Focus ID')
    .option('-r, --reason <text>', '合并理由')
    .action((fromId: string, intoId: string, options: { reason?: string }) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const ok = mergeFocuses(db, fromId, intoId, options.reason);
      if (!ok) {
        console.error('合并失败：Focus 不存在或源与目标相同');
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ merged: fromId, into: intoId }, null, 2));
    });

  focus
    .command('archive')
    .description('归档 Focus（不再参与匹配，仍可查询）')
    .argument('<focusId>', 'Focus ID')
    .option('-r, --reason <text>', '归档理由')
    .action((focusId: string, options: { reason?: string }) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const ok = archiveFocus(db, focusId, options.reason);
      if (!ok) {
        console.error(`归档失败：未找到 Focus ${focusId}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ archived: focusId }, null, 2));
    });

  focus
    .command('sweep')
    .description('把超过 dormant 天数未活跃的 active Focus 置为 dormant')
    .action(() => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const changed = sweepDormantFocuses(db, config.dormantDays);
      console.log(JSON.stringify({ dormantDays: config.dormantDays, transitioned: changed }, null, 2));
    });

  const exportCommand = program.command('export').description('导出通用格式数据');

  exportCommand
    .command('jsonl')
    .description('导出 check-in 为通用 JSONL 文件')
    .option('-o, --output <file>', '输出文件路径', './exports/checkins.jsonl')
    .option('-n, --limit <number>', '导出条数', '100')
    .action((options: { output: string; limit: string }) => {
      const config = loadConfig();
      const db = openDatabase(config.dbPath);
      const outputPath = path.resolve(options.output);
      const result = exportCheckinsToJsonl(db, { outputPath, limit: Number(options.limit) });
      console.log(JSON.stringify(result, null, 2));
    });

  return program;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  createCliProgram().parse();
}
