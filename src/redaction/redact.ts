import type { AttentionEventInput, PrivacyMode } from '../shared/types.js';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, '[REDACTED_TOKEN]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'],
  [/token\s*[:=]\s*['"]?[A-Za-z0-9._-]+['"]?/gi, 'token=[REDACTED]'],
  [/\/Users\/[^\s/]+/g, '/Users/[REDACTED_USER]'],
];

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
  const safeEntries = Object.entries(metadata).map(([key, value]) => {
    if (typeof value === 'string') return [key, redactText(value, privacyMode === 'metadata' ? 120 : 500)] as const;
    if (Array.isArray(value)) {
      return [key, value.map((item) => typeof item === 'string' ? redactText(item, 160) : item)] as const;
    }
    return [key, value] as const;
  });
  return Object.fromEntries(safeEntries);
}
