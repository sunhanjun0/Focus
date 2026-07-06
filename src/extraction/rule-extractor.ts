import type { AttentionEventInput, ExtractionResult } from '../shared/types.js';

const TRIVIAL_PATTERNS = [/^ok$/i, /^好的$/, /^收到$/, /^thanks?$/i, /^谢谢$/];
const SUBSTANTIVE_KEYWORDS = ['实现', '修复', '排查', '设计', '文档', '测试', '重构', '初始化', '新增', '验证', 'debug', 'fix', 'implement', 'test', 'design'];

export function extractEventSignal(event: AttentionEventInput, redactedSummary: string | null): ExtractionResult {
  const text = [event.project, event.type, redactedSummary, metadataText(event.metadata)].filter(Boolean).join(' ');
  const compact = text.trim();

  if (!compact || TRIVIAL_PATTERNS.some((pattern) => pattern.test(compact))) {
    return emptyExtraction('事件内容为空或仅包含轻量回应');
  }

  const lowerText = compact.toLowerCase();
  const keywords = SUBSTANTIVE_KEYWORDS.filter((keyword) => lowerText.includes(keyword.toLowerCase()));
  const hasFiles = Array.isArray(event.metadata?.files) && event.metadata.files.length > 0;
  const substantive = keywords.length > 0 || hasFiles || event.type.includes('finished') || event.type.includes('commit');

  if (!substantive) {
    return emptyExtraction('未命中实质工作关键词、文件变更或完成类事件');
  }

  return {
    substantive: true,
    topic: event.project || firstSentence(redactedSummary) || event.type,
    progress: redactedSummary || `收到 ${event.type} 事件`,
    blocker: extractLine(redactedSummary, ['阻塞', 'blocker', 'blocked']),
    nextAction: extractLine(redactedSummary, ['下一步', 'next']),
    reason: hasFiles ? '事件包含文件变更或实质工作信号' : `命中关键词：${keywords.join(', ')}`,
    keywords,
  };
}

function emptyExtraction(reason: string): ExtractionResult {
  return {
    substantive: false,
    topic: null,
    progress: null,
    blocker: null,
    nextAction: null,
    reason,
    keywords: [],
  };
}

function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '';
  return JSON.stringify(metadata);
}

function firstSentence(value: string | null): string | null {
  if (!value) return null;
  return value.split(/[。.!?\n]/)[0]?.trim() || null;
}

function extractLine(value: string | null, markers: string[]): string | null {
  if (!value) return null;
  const line = value.split('\n').find((item) => markers.some((marker) => item.toLowerCase().includes(marker.toLowerCase())));
  return line?.trim() || null;
}
