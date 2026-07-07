import path from 'node:path';
import { z } from 'zod';
import type { PrivacyMode } from './shared/types.js';

const envSchema = z.object({
  FIE_PORT: z.coerce.number().int().positive().default(17879),
  FIE_HOST: z.string().default('127.0.0.1'),
  FIE_DB_PATH: z.string().default('./data/fie.sqlite'),
  FIE_PRIVACY_MODE: z.enum(['metadata', 'summary', 'local_raw']).default('summary'),
  FIE_LOG_PATH: z.string().default('./logs/fie.jsonl'),
  FIE_T_MATCH: z.coerce.number().int().nonnegative().default(50),
  FIE_T_CREATE: z.coerce.number().int().nonnegative().default(25),
  FIE_DORMANT_DAYS: z.coerce.number().int().positive().default(30),
});

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  privacyMode: PrivacyMode;
  logPath: string;
  tMatch: number;
  tCreate: number;
  dormantDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  // T_create 不应高于 T_match，否则低置信区间为空；异常配置时收敛到相等。
  const tMatch = parsed.FIE_T_MATCH;
  const tCreate = Math.min(parsed.FIE_T_CREATE, tMatch);
  return {
    host: parsed.FIE_HOST,
    port: parsed.FIE_PORT,
    dbPath: path.resolve(parsed.FIE_DB_PATH),
    privacyMode: parsed.FIE_PRIVACY_MODE,
    logPath: path.resolve(parsed.FIE_LOG_PATH),
    tMatch,
    tCreate,
    dormantDays: parsed.FIE_DORMANT_DAYS,
  };
}
