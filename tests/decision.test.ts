import { describe, expect, it } from 'vitest';
import { decideFocusAction } from '../src/decision/decision-engine.js';
import type { ExtractionResult, FocusCandidate } from '../src/shared/types.js';

const thresholds = { tMatch: 50, tCreate: 25 };

function substantive(): ExtractionResult {
  return {
    substantive: true,
    topic: '主题',
    progress: null,
    blocker: null,
    nextAction: null,
    reason: 'test',
    keywords: [],
  };
}

function candidate(score: number): FocusCandidate {
  return { id: 'focus_1', name: 'Focus', score, reason: '路径重合' };
}

describe('decideFocusAction 双阈值', () => {
  it('非实质事件跳过', () => {
    const result = decideFocusAction({ ...substantive(), substantive: false, reason: '空' }, [], thresholds);
    expect(result.decision).toBe('skip');
    expect(result.lowConfidence).toBe(false);
  });

  it('分数 >= T_match：高置信 check_in', () => {
    const result = decideFocusAction(substantive(), [candidate(60)], thresholds);
    expect(result.decision).toBe('check_in');
    expect(result.lowConfidence).toBe(false);
    expect(result.focusId).toBe('focus_1');
  });

  it('T_create <= 分 < T_match：低置信 check_in', () => {
    const result = decideFocusAction(substantive(), [candidate(30)], thresholds);
    expect(result.decision).toBe('check_in');
    expect(result.lowConfidence).toBe(true);
    expect(result.focusId).toBe('focus_1');
  });

  it('分数 < T_create：新建', () => {
    const result = decideFocusAction(substantive(), [candidate(10)], thresholds);
    expect(result.decision).toBe('create_and_check_in');
    expect(result.lowConfidence).toBe(false);
    expect(result.focusId).toBeNull();
  });

  it('无候选：新建', () => {
    const result = decideFocusAction(substantive(), [], thresholds);
    expect(result.decision).toBe('create_and_check_in');
  });
});
