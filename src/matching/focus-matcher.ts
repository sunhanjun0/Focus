import type { AttentionEventInput, ExtractionResult, FocusCandidate } from '../shared/types.js';

interface StoredFocusCandidate {
  id: string;
  name: string;
  project: string | null;
  keywords: string[];
  lastActivityAt: string;
}

export function matchFocuses(event: AttentionEventInput, extraction: ExtractionResult, focuses: StoredFocusCandidate[]): FocusCandidate[] {
  return focuses
    .map((focus) => scoreFocus(event, extraction, focus))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function scoreFocus(event: AttentionEventInput, extraction: ExtractionResult, focus: StoredFocusCandidate): FocusCandidate {
  let score = 0;
  const reasons: string[] = [];
  const text = [event.project, event.type, extraction.topic, extraction.progress, extraction.keywords.join(' ')].join(' ').toLowerCase();

  if (event.project && focus.project && event.project.toLowerCase() === focus.project.toLowerCase()) {
    score += 50;
    reasons.push('项目名匹配');
  }

  if (text.includes(focus.name.toLowerCase())) {
    score += 30;
    reasons.push('Focus 名称命中');
  }

  const keywordHits = focus.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  if (keywordHits.length > 0) {
    score += keywordHits.length * 10;
    reasons.push(`关键词命中：${keywordHits.join(', ')}`);
  }

  const lastActivityMs = new Date(focus.lastActivityAt).getTime();
  if (Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs < 7 * 24 * 60 * 60 * 1000) {
    score += 5;
    reasons.push('最近活跃');
  }

  return {
    id: focus.id,
    name: focus.name,
    score,
    reason: reasons.join('；') || '无明显匹配依据',
  };
}
