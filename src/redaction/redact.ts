import type { AttentionEventInput, PrivacyMode } from '../shared/types.js';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // 私钥块（多行）
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  // OpenAI 风格 token
  [/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, '[REDACTED_TOKEN]'],
  // GitHub token（ghp_/gho_/ghu_/ghs_/ghr_ 与细粒度 PAT）
  [/\b(gh[posru]_[A-Za-z0-9]{20,})\b/g, '[REDACTED_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]'],
  // Slack token
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_TOKEN]'],
  // AWS Access Key ID
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  // 邮箱
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
  // Authorization: Bearer
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'],
  // 通用 token=xxx / token: xxx
  [/token\s*[:=]\s*['"]?[A-Za-z0-9._-]+['"]?/gi, 'token=[REDACTED]'],
  // 家目录路径（macOS / Linux）
  [/\/Users\/[^\s/]+/g, '/Users/[REDACTED_USER]'],
  [/\/home\/[^\s/]+/g, '/home/[REDACTED_USER]'],
  // IPv4 地址
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]'],
  // 中国大陆手机号
  [/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]'],
];

// metadata 模式下允许保留的元数据键（只留来源/结构性标签与路径信号，其余丢弃）。
const METADATA_MODE_ALLOWED_KEYS = new Set(['files', 'tags', 'labels', 'branch', 'repo', 'project']);

export interface RedactedEvent {
  summary: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
}

export function redactText(value: string, maxLength = 1200): string {
  const redacted = SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

export function redactEvent(event: AttentionEventInput, privacyMode: PrivacyMode): RedactedEvent {
  const metadata = sanitizeMetadata(event.metadata || {}, privacyMode);

  if (privacyMode === 'metadata') {
    return { summary: null, content: null, metadata };
  }

  const summary = event.summary ? redactText(event.summary, 500) : null;
  const content = privacyMode === 'local_raw' && event.content ? redactText(event.content) : null;
  return { summary, content, metadata };
}

function sanitizeMetadata(metadata: Record<string, unknown>, privacyMode: PrivacyMode): Record<string, unknown> {
  // metadata 模式做键白名单最小化，只保留结构性标签与路径信号，丢弃其余键。
  const entries =
    privacyMode === 'metadata'
      ? Object.entries(metadata).filter(([key]) => METADATA_MODE_ALLOWED_KEYS.has(key))
      : Object.entries(metadata);

  const safeEntries = entries.map(([key, value]) => {
    if (typeof value === 'string') return [key, redactText(value, privacyMode === 'metadata' ? 120 : 500)] as const;
    if (Array.isArray(value)) {
      return [key, value.map((item) => typeof item === 'string' ? redactText(item, 160) : item)] as const;
    }
    return [key, value] as const;
  });
  return Object.fromEntries(safeEntries);
}
