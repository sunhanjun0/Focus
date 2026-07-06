import path from 'node:path';
import { z } from 'zod';
import type { PrivacyMode } from './shared/types.js';

const envSchema = z.object({
  FIE_PORT: z.coerce.number().int().positive().default(17879),
  FIE_HOST: z.string().default('127.0.0.1'),
  FIE_DB_PATH: z.string().default('./data/fie.sqlite'),
  FIE_PRIVACY_MODE: z.enum(['metadata', 'summary', 'local_raw']).default('summary'),
  FIE_LOG_PATH: z.string().default('./logs/fie.jsonl'),
});

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  privacyMode: PrivacyMode;
  logPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    host: parsed.FIE_HOST,
    port: parsed.FIE_PORT,
    dbPath: path.resolve(parsed.FIE_DB_PATH),
    privacyMode: parsed.FIE_PRIVACY_MODE,
    logPath: path.resolve(parsed.FIE_LOG_PATH),
  };
}
