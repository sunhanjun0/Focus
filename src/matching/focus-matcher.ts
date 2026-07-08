import type { AttentionEventInput, ExtractionResult, FocusCandidate } from '../shared/types.js';
import { baseOf, dirOf } from '../shared/paths.js';

interface StoredFocusCandidate {
  id: string;
  name: string;
  project: string | null;
  keywords: string[];
  paths: string[];
  lastActivityAt: string;
}

export function matchFocuses(
  event: AttentionEventInput,
  extraction: ExtractionResult,
  eventPaths: string[],
  focuses: StoredFocusCandidate[],
): FocusCandidate[] {
  return focuses
    .map((focus) => scoreFocus(event, extraction, eventPaths, focus))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function scoreFocus(
  event: AttentionEventInput,
  extraction: ExtractionResult,
  eventPaths: string[],
  focus: StoredFocusCandidate,
): FocusCandidate {
  let score = 0;
  const reasons: string[] = [];
  const text = [event.project, event.type, extraction.topic, extraction.progress, extraction.keywords.join(' ')].join(' ').toLowerCase();

  if (event.project && focus.project && event.project.toLowerCase() === focus.project.toLowerCase()) {
    score += 50;
    reasons.push('项目名匹配');
  }

  const focusName = focus.name.toLowerCase();
  const isGenericName =
    focusName.length < 4 ||
    focusName === (event.project || '').toLowerCase() ||
    focusName === event.type.toLowerCase();
  if (!isGenericName && text.includes(focusName)) {
    score += 30;
    reasons.push('Focus 名称命中');
  }

  const keywordHits = focus.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  if (keywordHits.length > 0) {
    score += keywordHits.length * 10;
    reasons.push(`关键词命中：${keywordHits.join(', ')}`);
  }

  const pathScore = scorePaths(eventPaths, focus.paths);
  score += pathScore.score;
  reasons.push(...pathScore.reasons);

  const activityBonus = recentActivityBonus(focus.lastActivityAt, event.occurredAt);
  if (activityBonus.score > 0) {
    score += activityBonus.score;
    reasons.push(activityBonus.reason);
  }

  return {
    id: focus.id,
    name: focus.name,
    score,
    reason: reasons.join('；') || '无明显匹配依据',
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 分段活跃度加分：≤7 天 +5，≤30 天 +2，更久（含 dormant）0。
// 参考时间用当前事件的 occurredAt 而非墙上时钟，保证回填/乱序批次自洽（code-review #5）。
function recentActivityBonus(lastActivityAt: string, referenceAt: string): { score: number; reason: string } {
  const lastActivityMs = new Date(lastActivityAt).getTime();
  const referenceMs = new Date(referenceAt).getTime();
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(referenceMs)) return { score: 0, reason: '' };
  const age = referenceMs - lastActivityMs;
  if (age <= 7 * DAY_MS) return { score: 5, reason: '最近活跃（7 天内）' };
  if (age <= 30 * DAY_MS) return { score: 2, reason: '较近活跃（30 天内）' };
  return { score: 0, reason: '' };
}

function scorePaths(eventPaths: string[], focusPaths: string[]): { score: number; reasons: string[] } {
  if (eventPaths.length === 0 || focusPaths.length === 0) return { score: 0, reasons: [] };

  const fullSet = new Set(focusPaths);
  const dirSet = new Set(focusPaths.map(dirOf).filter(Boolean));
  const baseSet = new Set(focusPaths.map(baseOf));

  let fullHits = 0;
  let dirHits = 0;
  let baseHits = 0;
  for (const path of eventPaths) {
    if (fullSet.has(path)) {
      fullHits += 1;
      continue;
    }
    const dir = dirOf(path);
    if (dir && dirSet.has(dir)) {
      dirHits += 1;
      continue;
    }
    if (baseSet.has(baseOf(path))) {
      baseHits += 1;
    }
  }

  let score = 0;
  const reasons: string[] = [];
  if (fullHits > 0) {
    score += Math.min(fullHits * 25, 50);
    reasons.push(`文件路径重合 ×${fullHits}`);
  }
  if (dirHits > 0) {
    score += dirHits * 8;
    reasons.push(`同目录 ×${dirHits}`);
  }
  if (baseHits > 0) {
    score += baseHits * 4;
    reasons.push(`同文件名 ×${baseHits}`);
  }
  return { score, reasons };
}
