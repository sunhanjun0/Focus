# Focus Ingestion Engine 开发文档

## 1. 文档目标

本文面向 FIE 的实现者，说明本地开发方式、推荐技术栈、模块边界、核心流程、接口约定、测试重点和交付标准。当前仓库尚处于方案阶段，本文作为后续初始化代码仓库和 MVP 开发的执行基准。

## 2. 技术栈建议

MVP 优先选择低复杂度、易本地运行的技术组合：

- Runtime：Node.js + TypeScript。
- API 框架：Fastify 或 Hono，优先选择团队更熟悉者。
- 数据库：SQLite + `better-sqlite3`，后续可迁移 Postgres。
- MCP：`@modelcontextprotocol/sdk`。
- CLI：`commander` 或 `cac`。
- 日志：JSON Lines，便于 tail、grep 和后续导入。
- 测试：Vitest，覆盖核心决策链路。

MVP 不建议一开始引入重型 Electron、复杂队列或向量数据库。第一阶段目标是证明摄取、归因和同步链路稳定可用。

## 3. 推荐目录结构

```text
focus-ingestion-engine/
├── package.json
├── README.md
├── .env.example
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── server/
│   ├── db/
│   ├── ingestion/
│   ├── extraction/
│   ├── matching/
│   ├── decision/
│   ├── outputs/
│   ├── mcp/
│   └── cli/
├── docs/
└── tests/
```

各目录职责应保持单一：`ingestion` 只处理事件摄取和幂等，`extraction` 只提取主题、进展、阻塞和下一步，`matching` 只计算 Focus 候选，`decision` 只决定写入动作，`outputs` 只负责外部同步。

## 4. 本地开发命令

代码仓库初始化后，应提供以下命令：

```bash
npm install
npm run dev
npm test
npm run build
npm run lint
npm run typecheck
```

建议含义如下：

- `npm run dev`：启动本地 HTTP 服务和必要的后台处理。
- `npm test`：运行 Vitest 单元测试。
- `npm run build`：编译 TypeScript。
- `npm run lint`：检查代码风格。
- `npm run typecheck`：执行 TypeScript 类型检查。

仅修改 Markdown 文档时，可使用 `git diff --check` 检查空白字符问题。

## 5. 配置约定

使用 `.env` 保存本地配置，但不要提交真实 `.env`。提交 `.env.example` 说明字段：

```bash
FIE_PORT=17879
FIE_DB_PATH=./data/fie.sqlite
FIE_PRIVACY_MODE=summary
UUUTIL_MCP_URL=http://127.0.0.1:17878/mcp
FIE_LOG_PATH=./logs/fie.jsonl
```

`FIE_PRIVACY_MODE` 至少支持：

- `metadata`：只保存来源、时间、类型和少量标签。
- `summary`：保存脱敏摘要，推荐默认值。
- `local_raw`：本地保存原文，不上传外部服务。

## 6. 核心处理流程

```text
外部事件
  ↓
Ingestion API
  ↓
Idempotency 检查
  ↓
Redaction 脱敏
  ↓
Extractor 提取信号
  ↓
Focus Matcher 匹配候选
  ↓
Decision Engine 决策
  ↓
Focus/Check-in 写入
  ↓
通用 JSONL、Webhook 或其他输出适配器
```

每次处理都应生成 `ingestion_runs` 记录，保留输入摘要、脱敏结果、候选 Focus、最终决策、失败原因和重试状态。

## 7. HTTP API 约定

MVP 必须实现事件摄取接口：

```http
POST /v1/events/ingest
Content-Type: application/json
```

请求体建议结构：

```json
{
  "source": "codex",
  "sourceEventId": "evt_123",
  "occurredAt": "2026-07-02T12:00:00+08:00",
  "type": "conversation.finished",
  "project": "Focus",
  "summary": "补充摄取引擎方案",
  "metadata": {
    "threadId": "abc",
    "files": ["docs/development-guide.md"]
  }
}
```

响应应返回处理状态、幂等结果、决策和写入目标：

```json
{
  "status": "accepted",
  "deduplicated": false,
  "decision": "check_in",
  "focusId": "focus_123",
  "runId": "run_123"
}
```

## 8. 数据模型要点

MVP 至少包含以下表：

- `attention_events`：保存外部事件的来源、ID、类型、时间、摘要和元数据。
- `ingestion_runs`：保存每次处理过程、决策、错误和重试信息。
- `focuses`：保存稳定关注对象、标签、权重、最近活动时间。
- `focus_checkins`：保存一次关注归因的摘要、阻塞、下一步和来源。
- `focus_links`：保存事件、运行、Focus 和 Check-in 之间的关联。

`source + sourceEventId` 必须具备唯一约束，确保 hook 重试不会重复写入 Focus。

## 9. 决策规则

`Decision Engine` 输出必须可审计，至少支持：

- `skip`：事件无实质关注信号，只记录运行结果。
- `check_in`：匹配到已有 Focus，写入一次 check-in。
- `create_and_check_in`：没有合适 Focus，创建后写入 check-in。
- `update_metadata`：只更新 Focus 名称、标签或描述等元数据。

每个决策都应保存理由，例如关键词命中、项目路径匹配、最近活跃度或规则判定结果。

## 10. 测试重点

优先编写单元测试和少量集成测试：

- 摄取接口能接受合法事件并拒绝缺失必填字段的事件。
- 幂等逻辑能正确处理重复 `sourceEventId`。
- 脱敏规则能移除 token、邮箱、路径中的敏感片段和长原文。
- 提取器能区分 trivial 与 substantive 事件。
- Matcher 能基于项目名、文件路径、关键词和最近活跃度排序候选 Focus。
- 输出适配器失败时不会丢失 run 状态，可重试。

测试文件放在 `tests/` 下，并使用 `*.test.ts` 命名。

## 11. 日志与调试

日志使用 JSON Lines，每行包含 `timestamp`、`level`、`event`、`runId` 和必要上下文。不要在日志中输出未脱敏原文、密钥或完整用户对话。

CLI 应至少提供：

```bash
fie ingest ./sample-event.json
fie runs tail
fie focus list
```

这些命令用于本地验证 hook、查看决策链路和排查同步失败。

## 12. 安全与隐私要求

隐私保护是核心功能。默认只保存脱敏摘要，原文保留必须显式开启。任何外部输出，包括 HTTP 回调、JSON export 和第三方工具适配器，都必须经过同一套 redaction 层。配置文件、数据库和日志目录应加入 `.gitignore`。

## 13. MVP 交付标准

第一版完成时，应满足：

- 本地服务可启动并接收 `POST /v1/events/ingest`。
- SQLite 表结构和迁移可重复初始化。
- 重复事件不会重复写入 check-in。
- 至少一条 Codex 或通用 webhook 样例可以完成端到端处理。
- CLI 可以查看最近 ingestion run。
- 核心链路测试通过，失败原因可从日志定位。
