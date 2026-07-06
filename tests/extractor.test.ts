import { describe, expect, it } from 'vitest';
import { extractEventSignal } from '../src/extraction/rule-extractor.js';

describe('rule extractor', () => {
  it('识别实质工作事件', () => {
    const result = extractEventSignal({
      source: 'codex',
      sourceEventId: 'evt-1',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'conversation.finished',
      project: 'Focus',
      summary: '实现摄取 API 并补充测试',
    }, '实现摄取 API 并补充测试');
    expect(result.substantive).toBe(true);
    expect(result.keywords).toContain('实现');
  });

  it('跳过轻量回应', () => {
    const result = extractEventSignal({
      source: 'codex',
      sourceEventId: 'evt-2',
      occurredAt: '2026-07-02T15:00:00+08:00',
      type: 'chat.message',
      summary: '好的',
    }, '好的');
    expect(result.substantive).toBe(false);
  });
});
