# Focus Ingestion Engine

Focus Ingestion Engine（FIE）是一个本地注意力摄取与焦点归因引擎。它接收 Agent、CLI、Git、自动化系统等来源的事件，经过幂等、脱敏、提取、匹配和决策后，将实质关注信号归并为 Focus 与 check-in。

## 本地开发

```bash
npm install
npm run dev
npm test
npm run build
```

默认服务地址为 `http://127.0.0.1:17879`。配置项见 `.env.example`。

## 容器化运行

```bash
docker compose build
docker compose up -d
curl http://127.0.0.1:17879/health
```

容器默认监听 `0.0.0.0:17879`，数据库和日志写入 `/data` 卷。

## 摄取事件

启动服务后调用：

```bash
curl -X POST http://127.0.0.1:17879/v1/events/ingest \
  -H 'content-type: application/json' \
  --data @samples/codex-event.json

curl -X POST http://127.0.0.1:17879/v1/events/batch \
  -H 'content-type: application/json' \
  --data @samples/batch-events.json
```

也可以通过 CLI 本地摄取：

```bash
npm run cli -- ingest samples/codex-event.json
npm run cli -- runs tail
npm run cli -- runs show <runId>
npm run cli -- focus
npm run cli -- export jsonl --output exports/checkins.jsonl
```

## 查询结果

```bash
curl http://127.0.0.1:17879/v1/runs?limit=10
curl http://127.0.0.1:17879/v1/runs/{runId}
curl http://127.0.0.1:17879/v1/focuses?limit=10
```

## Adapter 示例

```bash
node scripts/adapters/ci-webhook-example.mjs
node scripts/adapters/git-hook-example.mjs
```

这些脚本只演示标准事件生成和 HTTP 发送方式，不包含任何特定下游系统逻辑。

## 部署

```bash
npm run deploy:dry-run
export OPENCLAW_API_TOKEN
npm run deploy:openclaw
npm run deploy:openclaw -- --prompt "在树莓派上检查服务状态并返回摘要。"
```

部署说明见 `docs/deployment.md`。OpenClaw 对端是 Agent，部署脚本发送任务提示而不是固定命令；真实 token 只放本地环境变量，不写入仓库。

## 项目文档

- `docs/project-constraints.md`：项目约束准则，定义铁律和模块边界。
- `docs/development-guide.md`：开发文档，说明技术栈、接口、数据模型和测试重点。
- `docs/product-design.md`：产品设计书，说明目标用户、MVP 范围和里程碑。
- `docs/adapters.md`：通用 Adapter 接入说明，面向 webhook、CLI、自动化和下游输出。
- `docs/protocol.md`：通用协议，说明事件格式、批量摄取、错误码和 JSONL 导出。
