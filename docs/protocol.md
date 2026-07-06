# FIE 通用协议

## 1. 协议目标

FIE 协议用于把不同工具产生的工作事件转为统一 Attention Event。协议不绑定特定工具，适用于 Agent、CI、Git hook、自动化平台、脚本、MCP 网关和协作系统。

## 2. Attention Event

最小事件结构：

```json
{
  "source": "generic-webhook",
  "sourceEventId": "webhook-20260702-001",
  "occurredAt": "2026-07-02T15:30:00+08:00",
  "type": "automation.completed"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `source` | 是 | 来源工具或 Adapter 名称，例如 `ci`、`git-hook`、`agent`。 |
| `sourceEventId` | 是 | 来源侧稳定事件 ID，用于幂等。 |
| `occurredAt` | 是 | ISO 8601 时间，必须包含时区。 |
| `type` | 是 | 事件类型，使用 `domain.action` 或 `domain.action.detail`。 |
| `project` | 否 | 项目、仓库或工作区名称。 |
| `summary` | 否 | 已脱敏的人类可读摘要。 |
| `content` | 否 | 可选原文，仅本地隐私模式允许保存。 |
| `metadata` | 否 | 来源工具附加信息，必须可 JSON 序列化。 |

## 3. 事件类型命名

事件类型使用英文小写点分命名：

- `conversation.finished`
- `automation.completed`
- `git.commit.created`
- `test.run.finished`
- `deploy.failed`

不要把工具名写进 `type`；工具名应放在 `source`。

## 4. 单条摄取

```http
POST /v1/events/ingest
Content-Type: application/json
```

成功响应：

```json
{
  "status": "accepted",
  "deduplicated": false,
  "decision": "create_and_check_in",
  "focusId": "focus_123",
  "runId": "run_123",
  "reason": "没有候选 Focus，创建新 Focus"
}
```

重复事件响应仍为成功，但 `deduplicated` 为 `true`。

## 5. 批量摄取

```http
POST /v1/events/batch
Content-Type: application/json
```

请求结构：

```json
{
  "events": [
    { "source": "ci", "sourceEventId": "run-1", "occurredAt": "2026-07-02T16:00:00+08:00", "type": "automation.completed" }
  ]
}
```

限制：单次最多 100 条事件。批量摄取逐条复用单条摄取链路，因此幂等、脱敏、提取、匹配和决策规则完全一致。

## 6. 错误格式

错误响应使用稳定结构：

```json
{
  "error": {
    "code": "invalid_event",
    "message": "事件格式无效",
    "details": []
  }
}
```

常见错误码：

| 错误码 | 说明 |
|---|---|
| `invalid_event` | 单条事件格式无效。 |
| `invalid_batch` | 批量请求格式无效。 |
| `internal_error` | 服务内部错误。 |
| `run_not_found` | 指定 run 不存在。 |

## 7. 查询接口

只读查询接口用于外部工具检查摄取结果，不应承担业务决策。

```http
GET /v1/runs?limit=50
GET /v1/runs/{runId}
GET /v1/focuses?limit=50
```

`limit` 可选，默认 50，最大 200。

`GET /v1/runs/{runId}` 返回单次摄取详情，包括 run 状态、决策、候选、脱敏事件摘要、metadata、关联 check-in 和 Focus。该接口不返回原始 `content`。

## 8. JSONL 导出协议

导出命令：

```bash
npm run cli -- export jsonl --output exports/checkins.jsonl
```

每行是一个 `fie.checkin.v1` 对象，包含 Focus、run、事件来源、notes、blocker、nextAction 和 decisionReason。导出不包含原始完整正文。

示例：

```json
{
  "schemaVersion": "fie.checkin.v1",
  "focus": { "id": "focus_123", "name": "Focus Ingestion Engine" },
  "event": { "source": "ci", "sourceEventId": "run-1", "type": "automation.completed" },
  "notes": "CI 完成构建、测试和 lint 验证。",
  "blocker": null,
  "nextAction": null,
  "decisionReason": "匹配已有 Focus：项目名匹配"
}
```

## 9. 幂等要求

`source + sourceEventId` 是全局幂等键。来源侧重试时必须复用相同 `sourceEventId`。禁止使用随机 ID 作为同一事件的重试标识。

## 10. 隐私要求

来源侧应优先发送摘要而不是完整正文。FIE 会执行 redaction，但 Adapter 仍应避免传入 API Key、Token、Cookie、完整请求头、附件正文和未脱敏个人信息。
