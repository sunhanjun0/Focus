import path from 'node:path';
import { z } from 'zod';
import type { PrivacyMode } from './shared/types.js';

const privacyModeSchema = z.enum(['metadata', 'summary', 'local_raw']);

// per-source 隐私覆盖：JSON 形如 {"ci":"metadata","codex":"summary"}，
// 校验每个值为合法 privacyMode；非法 JSON 或值类型直接报错，避免静默降级。
const privacyBySourceSchema = z.string().default('{}').transform((raw, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FIE_PRIVACY_BY_SOURCE 必须是合法 JSON' });
    return z.NEVER;
  }
  const result = z.record(privacyModeSchema).safeParse(parsed);
  if (!result.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FIE_PRIVACY_BY_SOURCE 必须是 source→privacyMode 的映射' });
    return z.NEVER;
  }
  return result.data;
});

const envSchema = z.object({
  FIE_PORT: z.coerce.number().int().positive().default(17879),
  FIE_HOST: z.string().default('127.0.0.1'),
  FIE_DB_PATH: z.string().default('./data/fie.sqlite'),
  FIE_PRIVACY_MODE: privacyModeSchema.default('summary'),
  FIE_PRIVACY_BY_SOURCE: privacyBySourceSchema,
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
  privacyBySource: Record<string, PrivacyMode>;
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
    privacyBySource: parsed.FIE_PRIVACY_BY_SOURCE,
    logPath: path.resolve(parsed.FIE_LOG_PATH),
    tMatch,
    tCreate,
    dormantDays: parsed.FIE_DORMANT_DAYS,
  };
}

// 解析某来源实际生效的隐私模式：优先 per-source 覆盖，缺省回退全局默认。
// 覆盖可比全局更宽或更严，按配置直接生效（产品决策 2026-07-08）。
export function resolvePrivacyMode(config: AppConfig, source: string): PrivacyMode {
  return config.privacyBySource[source] ?? config.privacyMode;
}
