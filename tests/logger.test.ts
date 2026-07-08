import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { createJsonlLogger } from '../src/shared/logger.js';

describe('jsonl logger', () => {
  it('异步流写入并保序，close 后可读出完整 JSONL', async () => {
    const logPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-log-')), 'app.jsonl');
    const logger = createJsonlLogger(logPath);

    logger.write('info', 'app', 'first', { seq: 1 });
    logger.write('warn', 'app', 'second', { seq: 2 });
    await logger.close?.();

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as { level: string; event: string; seq: number; timestamp: string };
    const second = JSON.parse(lines[1]) as { event: string; seq: number };
    expect(first.level).toBe('info');
    expect(first.event).toBe('first');
    expect(first.seq).toBe(1);
    expect(first.timestamp).toBeTruthy();
    expect(second.seq).toBe(2);
  });

  it('追加模式：新 logger 续写而非覆盖既有日志', async () => {
    const logPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'fie-log-')), 'app.jsonl');

    const first = createJsonlLogger(logPath);
    first.write('info', 'app', 'a');
    await first.close?.();

    const second = createJsonlLogger(logPath);
    second.write('info', 'app', 'b');
    await second.close?.();

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
