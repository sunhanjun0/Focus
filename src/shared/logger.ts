import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  write: (level: LogLevel, scope: string, event: string, meta?: Record<string, unknown>) => void;
  close?: () => Promise<void>;
}

export function createJsonlLogger(logPath: string): Logger {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  // 追加模式写入流：Node 内部缓冲并按写入顺序异步落盘，避免每条同步 appendFileSync
  // 阻塞事件循环（code-review #11）。写入顺序由流保序，进程退出前须 close 以冲刷缓冲。
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  return {
    write(level, scope, event, meta = {}) {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), level, scope, event, ...meta });
      stream.write(`${line}\n`);
    },
    close() {
      return new Promise((resolve) => stream.end(() => resolve()));
    },
  };
}
