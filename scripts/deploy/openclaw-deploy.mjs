#!/usr/bin/env node
import fs from 'node:fs';

const endpoint = process.env.OPENCLAW_ENDPOINT || 'https://congrong.online:18789/v1/chat/completions';
const token = process.env.OPENCLAW_API_TOKEN;
const model = process.env.OPENCLAW_MODEL || 'openclaw/default';
const user = process.env.OPENCLAW_USER || 'focus-deploy';
const dryRun = process.argv.includes('--dry-run');
const prompt = resolvePrompt();

const payload = {
  model,
  user,
  messages: [
    {
      role: 'user',
      content: prompt,
    },
  ],
};

if (dryRun) {
  console.log(JSON.stringify({ endpoint, payload }, null, 2));
  process.exit(0);
}

if (!token) {
  console.error('缺少 OPENCLAW_API_TOKEN。请在本地环境变量中设置，不要写入仓库文件。');
  process.exit(1);
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);

function resolvePrompt() {
  const promptIndex = process.argv.indexOf('--prompt');
  if (promptIndex >= 0 && process.argv[promptIndex + 1]) return process.argv[promptIndex + 1];

  const promptFileIndex = process.argv.indexOf('--prompt-file');
  if (promptFileIndex >= 0 && process.argv[promptFileIndex + 1]) {
    return fs.readFileSync(process.argv[promptFileIndex + 1], 'utf8').trim();
  }

  if (process.env.OPENCLAW_TASK_PROMPT) return process.env.OPENCLAW_TASK_PROMPT;

  if (process.env.FIE_DEPLOY_COMMAND) {
    return `在树莓派上部署项目: ${process.env.FIE_DEPLOY_COMMAND}`;
  }

  return '在树莓派上部署 Focus Ingestion Engine：进入 /home/hanjun/focus，拉取 main 最新代码，并用 docker compose 重新构建和启动服务。部署后检查服务是否正常运行。';
}
