#!/usr/bin/env node
import { execSync } from 'node:child_process';

const endpoint = process.env.FIE_ENDPOINT || 'http://127.0.0.1:17879/v1/events/ingest';
const commitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const project = execSync('basename "$(git rev-parse --show-toplevel)"', { encoding: 'utf8', shell: '/bin/bash' }).trim();
const files = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { encoding: 'utf8' })
  .split('\n')
  .map((item) => item.trim())
  .filter(Boolean);
const message = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
const occurredAt = new Date().toISOString();

const event = {
  source: 'git-hook',
  sourceEventId: `commit-${commitSha}`,
  occurredAt,
  type: 'git.commit.created',
  project,
  summary: `提交 ${commitSha.slice(0, 8)}：${message}`,
  metadata: { commitSha, files },
};

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(event),
});

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

console.log(await response.text());
