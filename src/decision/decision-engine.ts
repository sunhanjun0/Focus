import type { DecisionResult, ExtractionResult, FocusCandidate } from '../shared/types.js';

const MATCH_THRESHOLD = 50;

export function decideFocusAction(extraction: ExtractionResult, candidates: FocusCandidate[]): DecisionResult {
  if (!extraction.substantive) {
    return {
      decision: 'skip',
      reason: extraction.reason,
      focusId: null,
      focusName: null,
      candidates,
    };
  }

  const best = candidates[0];
  if (best && best.score >= MATCH_THRESHOLD) {
    return {
      decision: 'check_in',
      reason: `匹配已有 Focus：${best.reason}`,
      focusId: best.id,
      focusName: best.name,
      candidates,
    };
  }

  return {
    decision: 'create_and_check_in',
    reason: candidates.length > 0 ? '候选分数不足，创建新 Focus' : '没有候选 Focus，创建新 Focus',
    focusId: null,
    focusName: extraction.topic,
    candidates,
  };
}
