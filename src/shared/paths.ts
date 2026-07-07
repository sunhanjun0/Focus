/**
 * 路径信号工具：在 redaction 之后、matching 之前，对 metadata.files 做规范化，
 * 供 Focus 匹配的“完整路径 / 目录 / 文件名”三级分级命中。
 * 输入应为已脱敏的 metadata，本模块不做脱敏，只做结构归一化。
 */

const MAX_PATHS = 50;

export function normalizePath(input: string): string {
  let value = input.trim().replace(/\\/g, '/');
  value = value.replace(/\/{2,}/g, '/');
  value = value.replace(/^\.\//, '');
  value = value.replace(/\/+$/, '');
  return value;
}

export function extractPaths(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.files;
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .filter((item): item is string => typeof item === 'string')
    .map(normalizePath)
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized)).slice(0, MAX_PATHS);
}

export function dirOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

export function baseOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

export function mergePaths(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...incoming, ...existing])).slice(0, MAX_PATHS);
}
