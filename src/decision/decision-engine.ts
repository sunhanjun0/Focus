import type { DecisionResult, ExtractionResult, FocusCandidate } from '../shared/types.js';

export interface DecisionThresholds {
  tMatch: number;
  tCreate: number;
}

export function decideFocusAction(
  extraction: ExtractionResult,
  candidates: FocusCandidate[],
  thresholds: DecisionThresholds,
): DecisionResult {
  if (!extraction.substantive) {
    return {
      decision: 'skip',
      reason: extraction.reason,
      focusId: null,
      focusName: null,
      lowConfidence: false,
      candidates,
    };
  }

  const best = candidates[0];

  if (best && best.score >= thresholds.tMatch) {
    return {
      decision: 'check_in',
      reason: `匹配已有 Focus：${best.reason}`,
      focusId: best.id,
      focusName: best.name,
      lowConfidence: false,
      candidates,
    };
  }

  if (best && best.score >= thresholds.tCreate) {
    return {
      decision: 'check_in',
      reason: `低置信匹配（分数 ${best.score} 处于复核区间 [${thresholds.tCreate}, ${thresholds.tMatch})）：${best.reason}`,
      focusId: best.id,
      focusName: best.name,
      lowConfidence: true,
      candidates,
    };
  }

  return {
    decision: 'create_and_check_in',
    reason: candidates.length > 0 ? '候选分数低于新建阈值，创建新 Focus' : '没有候选 Focus，创建新 Focus',
    focusId: null,
    focusName: extraction.topic,
    lowConfidence: false,
    candidates,
  };
}
