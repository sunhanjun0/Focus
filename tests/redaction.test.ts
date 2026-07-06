import { describe, expect, it } from 'vitest';
import { redactEvent, redactText } from '../src/redaction/redact.js';

const baseEvent = {
  source: 'codex',
  sourceEventId: 'evt-redact',
  occurredAt: '2026-07-02T15:00:00+08:00',
  type: 'conversation.finished',
};

describe('redaction', () => {
  it('脱敏 token、邮箱和用户路径', () => {
    const text = 'token=abc123def456 contact test@example.com path /Users/hanjun/private';
    expect(redactText(text)).toContain('token=[REDACTED]');
    expect(redactText(text)).toContain('[REDACTED_EMAIL]');
    expect(redactText(text)).toContain('/Users/[REDACTED_USER]');
  });

  it('metadata 模式不保留摘要和正文', () => {
    const redacted = redactEvent({ ...baseEvent, summary: '实现功能', content: '完整正文' }, 'metadata');
    expect(redacted.summary).toBeNull();
    expect(redacted.content).toBeNull();
  });
});
