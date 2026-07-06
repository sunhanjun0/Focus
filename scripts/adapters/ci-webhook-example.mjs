#!/usr/bin/env node
const endpoint = process.env.FIE_ENDPOINT || 'http://127.0.0.1:17879/v1/events/ingest';
const source = process.env.FIE_SOURCE || 'ci';
const runId = process.env.CI_RUN_ID || process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const project = process.env.FIE_PROJECT || process.env.GITHUB_REPOSITORY || 'unknown-project';
const status = process.env.CI_STATUS || 'completed';
const branch = process.env.GITHUB_REF_NAME || process.env.CI_BRANCH || undefined;
const commitSha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || undefined;

const event = {
  source,
  sourceEventId: `${source}-run-${runId}`,
  occurredAt: new Date().toISOString(),
  type: status === 'failed' ? 'automation.failed' : 'automation.completed',
  project,
  summary: `自动化运行 ${runId} ${status}，项目 ${project}${branch ? `，分支 ${branch}` : ''}。`,
  metadata: {
    runId,
    status,
    branch,
    commitSha,
    labels: ['ci', 'automation'],
  },
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
