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

  it('脱敏 GitHub/AWS/Slack token、IP、家目录与手机号', () => {
    const ghp = `ghp_${'a'.repeat(36)}`;
    const text = `${ghp} AKIA1234567890ABCDEF xoxb-123456789012-abcdef path /home/hanjun/x ip 192.168.1.1 tel 13800138000`;
    const redacted = redactText(text);
    expect(redacted).not.toContain(ghp);
    expect(redacted).toContain('[REDACTED_TOKEN]');
    expect(redacted).toContain('[REDACTED_AWS_KEY]');
    expect(redacted).toContain('/home/[REDACTED_USER]');
    expect(redacted).toContain('[REDACTED_IP]');
    expect(redacted).toContain('[REDACTED_PHONE]');
    expect(redacted).not.toContain('AKIA1234567890ABCDEF');
    expect(redacted).not.toContain('192.168.1.1');
    expect(redacted).not.toContain('13800138000');
  });

  it('脱敏私钥块', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----';
    const redacted = redactText(key);
    expect(redacted).toContain('[REDACTED_PRIVATE_KEY]');
    expect(redacted).not.toContain('MIIEabc');
  });

  it('metadata 模式不保留摘要和正文', () => {
    const redacted = redactEvent({ ...baseEvent, summary: '实现功能', content: '完整正文' }, 'metadata');
    expect(redacted.summary).toBeNull();
    expect(redacted.content).toBeNull();
  });

  it('metadata 模式只保留白名单键，丢弃其余元数据', () => {
    const redacted = redactEvent(
      { ...baseEvent, metadata: { files: ['src/a.ts'], branch: 'main', apiKey: 'sk-should-be-dropped', note: '任意备注' } },
      'metadata',
    );
    expect(redacted.metadata.files).toEqual(['src/a.ts']);
    expect(redacted.metadata.branch).toBe('main');
    expect(redacted.metadata).not.toHaveProperty('apiKey');
    expect(redacted.metadata).not.toHaveProperty('note');
  });

  it('summary 模式保留全部元数据键（仅脱敏值）', () => {
    const redacted = redactEvent(
      { ...baseEvent, summary: '摘要', metadata: { files: ['src/a.ts'], note: '保留但脱敏 test@example.com' } },
      'summary',
    );
    expect(redacted.metadata).toHaveProperty('note');
    expect(redacted.metadata.note).toContain('[REDACTED_EMAIL]');
  });
});
