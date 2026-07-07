# 通用 Adapter 接入说明

## 1. 设计目标

FIE 面向绝大部分工具，而不是绑定某一个应用。任何能发送 HTTP、执行 CLI、写入文件或触发 webhook 的系统，都应能以标准事件格式接入 FIE。

## 2. 标准事件

最小事件结构：

```json
{
  "source": "generic-webhook",
  "sourceEventId": "webhook-20260702-001",
  "occurredAt": "2026-07-02T15:30:00+08:00",
  "type": "automation.completed"
}
```

推荐补充：

- `project`：项目或工作区名称。
- `summary`：脱敏后的事件摘要。
- `metadata.files`：相关文件路径。这是跨工具归因的强信号——改动同一批文件的不同来源事件会据此收敛到同一 Focus，Adapter 应尽量准确提供。
- `metadata.labels`：来源工具提供的标签。
- `metadata.url`：可选的外部详情链接，必须避免包含 token。

## 3. 来源接入方式

### 3.1 HTTP Webhook

```bash
curl -X POST http://127.0.0.1:17879/v1/events/ingest \
  -H 'content-type: application/json' \
  --data @samples/generic-webhook-event.json
```

适用于 CI、自动化平台、Git hook、脚本任务和支持 webhook 的协作工具。

### 3.2 批量 HTTP Webhook

```bash
curl -X POST http://127.0.0.1:17879/v1/events/batch \
  -H 'content-type: application/json' \
  --data @samples/batch-events.json
```

适用于 CI 汇总、批量导入历史事件和一次任务产生多条关注信号的场景。

### 3.3 CLI

```bash
npm run cli -- ingest samples/generic-webhook-event.json
```

适用于本地脚本、一次性导入和调试场景。

## 4. 幂等规则

每个 Adapter 必须稳定生成 `sourceEventId`。推荐使用来源系统的原始事件 ID；如果没有，可使用 `source + 时间窗口 + 关键对象 ID` 组合生成。禁止使用随机 ID 作为重试事件的唯一标识，否则会破坏幂等。

## 5. 隐私要求

Adapter 发送事件前应尽量生成摘要，不发送完整对话或附件正文。FIE 会再次执行 redaction，但来源侧仍应避免传入密钥、Cookie、完整请求头和个人敏感信息。FIE 支持按来源配置隐私模式，高敏来源可只上传来源、时间、类型和标签（见 `docs/product-design.md` 第 13 节）。

## 6. 通用输出

MVP 提供 JSONL 导出（pull 模式），供任意下游系统消费：

```bash
npm run cli -- export jsonl --output exports/checkins.jsonl
```

导出格式为 `fie.checkin.v1`，包含 Focus、run、事件来源、notes、blocker、nextAction 和 decisionReason，不包含原始完整事件正文。push 模式输出（Webhook、MCP、数据库同步）及其失败重试状态机为规划中，届时与对应输出能力同时引入。

## 7. 示例脚本

仓库提供两个来源侧 Adapter 示例：

- `scripts/adapters/ci-webhook-example.mjs`：从常见 CI 环境变量生成 `automation.completed` 或 `automation.failed` 事件。
- `scripts/adapters/git-hook-example.mjs`：从当前 Git 仓库生成 `git.commit.created` 事件。

使用示例：

```bash
FIE_ENDPOINT=http://127.0.0.1:17879/v1/events/ingest node scripts/adapters/ci-webhook-example.mjs
FIE_ENDPOINT=http://127.0.0.1:17879/v1/events/ingest node scripts/adapters/git-hook-example.mjs
```

示例脚本只负责生成标准事件和发送 HTTP 请求，不参与 Focus 匹配或决策。
