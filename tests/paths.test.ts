import { describe, expect, it } from 'vitest';
import { baseOf, dirOf, extractPaths, mergePaths, normalizePath } from '../src/shared/paths.js';
import { matchFocuses } from '../src/matching/focus-matcher.js';
import type { AttentionEventInput, ExtractionResult } from '../src/shared/types.js';

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    substantive: true,
    topic: null,
    progress: null,
    blocker: null,
    nextAction: null,
    reason: 'test',
    keywords: [],
    ...overrides,
  };
}

describe('path helpers', () => {
  it('normalizePath 统一分隔符、去前导 ./ 和尾部斜杠', () => {
    expect(normalizePath('.\\src\\a.ts')).toBe('src/a.ts');
    expect(normalizePath('./docs/dev.md')).toBe('docs/dev.md');
    expect(normalizePath('src//nested///b.ts')).toBe('src/nested/b.ts');
    expect(normalizePath('src/dir/')).toBe('src/dir');
  });

  it('extractPaths 只取 files 字符串、去重、上限 50', () => {
    expect(extractPaths({ files: ['a.ts', './a.ts', 'b.ts', 1, null] })).toEqual(['a.ts', 'b.ts']);
    expect(extractPaths({})).toEqual([]);
    expect(extractPaths(undefined)).toEqual([]);
  });

  it('dirOf / baseOf 分级', () => {
    expect(dirOf('src/db/repo.ts')).toBe('src/db');
    expect(dirOf('top.ts')).toBe('');
    expect(baseOf('src/db/repo.ts')).toBe('repo.ts');
  });

  it('mergePaths 新路径在前、去重、上限 50', () => {
    expect(mergePaths(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c', 'a']);
  });
});

describe('matchFocuses 文件维度', () => {
  const event: AttentionEventInput = {
    source: 'ci',
    sourceEventId: 'run-1',
    occurredAt: '2026-07-02T16:00:00+08:00',
    type: 'automation.completed',
  };

  it('完整路径重合给出最强加分，实现跨工具收敛', () => {
    const candidates = matchFocuses(
      event,
      extraction(),
      ['src/db/repository.ts'],
      [
        {
          id: 'focus_1',
          name: 'Focus 摄取引擎',
          project: null,
          keywords: [],
          paths: ['src/db/repository.ts', 'src/db/schema.sql'],
          lastActivityAt: '2020-01-01T00:00:00Z',
        },
      ],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBeGreaterThanOrEqual(25);
    expect(candidates[0].reason).toContain('文件路径重合');
  });

  it('仅同目录时给次级加分', () => {
    const candidates = matchFocuses(
      event,
      extraction(),
      ['src/db/other.ts'],
      [
        {
          id: 'focus_1',
          name: 'Focus 摄取引擎',
          project: null,
          keywords: [],
          paths: ['src/db/repository.ts'],
          lastActivityAt: '2020-01-01T00:00:00Z',
        },
      ],
    );
    expect(candidates[0].score).toBe(8);
    expect(candidates[0].reason).toContain('同目录');
  });

  it('通用名（等于事件 type）不触发名称命中加分，降低噪音', () => {
    const candidates = matchFocuses(
      { ...event, project: 'Focus' },
      extraction({ topic: 'automation.completed' }),
      [],
      [
        {
          id: 'focus_generic',
          name: 'automation.completed',
          project: null,
          keywords: [],
          paths: [],
          lastActivityAt: '2020-01-01T00:00:00Z',
        },
      ],
    );
    // 名称等于事件 type，视为通用名，不应命中 +30；无其他信号则被过滤
    expect(candidates).toHaveLength(0);
  });
});
