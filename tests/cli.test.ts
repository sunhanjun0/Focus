import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';

function runCli(args: string[], env: Record<string, string>): string {
  return execFileSync('npx', ['tsx', 'src/cli/index.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('cli', () => {
  it('runs show 输出单次摄取详情', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fie-cli-'));
    const dbPath = path.join(tempDir, 'fie.sqlite');
    const eventPath = path.join(tempDir, 'event.json');
    writeFileSync(eventPath, JSON.stringify({
      source: 'cli-test',
      sourceEventId: 'cli-run-show-1',
      occurredAt: '2026-07-02T17:00:00+08:00',
      type: 'conversation.finished',
      project: 'Focus',
      summary: '实现 CLI run 详情命令',
    }), 'utf8');

    const env = { FIE_DB_PATH: dbPath, FIE_LOG_PATH: path.join(tempDir, 'fie.jsonl') };
    const ingestOutput = runCli(['ingest', eventPath], env);
    const runId = (JSON.parse(ingestOutput) as { runId: string }).runId;
    const showOutput = runCli(['runs', 'show', runId], env);
    const detail = JSON.parse(showOutput) as { id: string; event: { sourceEventId: string }; checkin: { notes: string } };

    expect(detail.id).toBe(runId);
    expect(detail.event.sourceEventId).toBe('cli-run-show-1');
    expect(detail.checkin.notes).toContain('CLI run 详情命令');
  });

  it('runs show 找不到 run 时返回非零退出码', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fie-cli-'));
    const result = spawnSync('npx', ['tsx', 'src/cli/index.ts', 'runs', 'show', 'run_missing'], {
      cwd: process.cwd(),
      env: { ...process.env, FIE_DB_PATH: path.join(tempDir, 'fie.sqlite') },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('未找到 ingestion run');
  });
});
