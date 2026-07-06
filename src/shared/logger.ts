import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  write: (level: LogLevel, scope: string, event: string, meta?: Record<string, unknown>) => void;
}

export function createJsonlLogger(logPath: string): Logger {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return {
    write(level, scope, event, meta = {}) {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), level, scope, event, ...meta });
      fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    },
  };
}
