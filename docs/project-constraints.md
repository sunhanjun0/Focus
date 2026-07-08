# Focus Ingestion Engine 项目约束准则

## 1. 适用范围

本文定义 FIE 的开发铁律、模块边界、协议约束、隐私要求和质量门槛。所有代码、文档、测试和后续 Agent 工作都应优先遵守本文；若与临时实现便利冲突，以本文为准。

## 2. 开发铁律

### 2.1 事件摄取与归因解耦

`ingestion` 只负责接收、校验、去重和记录事件，不直接创建 Focus 或写 check-in。归因必须经过 `extraction`、`matching` 和 `decision` 链路。

### 2.2 幂等是强约束

所有外部事件必须携带 `source` 和 `sourceEventId`。数据库必须对 `source + sourceEventId` 建唯一约束。hook 重试、重复提交和客户端超时重发都不能产生重复 check-in。

### 2.3 隐私层不可绕过

任何进入提取、匹配、日志、导出或外部同步的内容，都必须先经过 redaction 层。禁止模块自行把原始事件正文写入日志、输出适配器或调试文件。

### 2.4 决策必须可解释

`Decision Engine` 的输出必须包含 `decision`、`reason`、候选 Focus 信息和关键命中依据。禁止只保存最终结果而丢失判断过程。

### 2.5 输出适配器不得包含业务规则

`outputs` 只负责把已确定的 check-in、Focus 或 export 数据写到目标系统。不要在 JSONL、Webhook 等任一输出适配器中重新实现提取、匹配或创建规则。

## 3. 模块边界

| 模块 | 允许职责 | 禁止事项 |
|---|---|---|
| `server` | HTTP 路由、请求校验、响应封装 | 直接操作 Focus 决策 |
| `ingestion` | 事件标准化、幂等、run 创建 | 执行业务归因 |
| `redaction` | 脱敏、截断、隐私模式处理 | 判断是否写入 Focus |
| `extraction` | 提取主题、进展、阻塞、下一步 | 访问输出系统 |
| `matching` | 计算候选 Focus 和评分 | 写入 check-in |
| `decision` | 选择 skip/check_in/create_and_check_in（update_metadata 规划中） | 发送外部同步请求 |
| `outputs` | JSONL、Webhook 等输出 | 修改核心决策 |
| `cli` | 本地调试和运维命令 | 绕过核心服务写库 |

跨模块调用应沿主流程单向前进，避免环形依赖。

## 4. 协议与数据约束

标准事件最少包含：

```json
{
  "source": "codex",
  "sourceEventId": "evt_123",
  "occurredAt": "2026-07-02T12:00:00+08:00",
  "type": "conversation.finished"
}
```

协议字段使用英文 camelCase。用户可见文档、错误解释和提交说明使用中文。事件类型建议使用 `domain.action` 命名，例如 `conversation.finished`、`git.commit.created`、`automation.completed`。

## 5. 数据库约束

- 表名使用 snake_case，例如 `attention_events`、`ingestion_runs`。
- 写操作必须记录 `created_at`，状态变化记录 `updated_at`。
- `ingestion_runs` 必须能追溯对应事件、决策与错误原因（`error`）。当前为 pull-only 输出，无重试状态字段；重试状态随 push 输出一并引入（规划中）。
- 不要删除原始 run 记录；需要隐藏时使用状态字段表达。
- migration 必须可重复执行，不依赖人工手动改库。

## 6. 日志约束

日志使用 JSON Lines。每条日志至少包含 `timestamp`、`level`、`scope`、`event`。推荐记录 `runId`、`source`、`sourceEventId`、耗时、决策和错误摘要。

禁止记录：

- API Key、Token、Cookie、完整请求头。
- 完整用户对话、附件正文、base64 内容。
- 未脱敏文件路径、邮箱、私有 URL 或个人身份信息。

## 7. 隐私与安全约束

默认隐私模式为 `summary`。任何新增 Adapter、CLI 或调试命令都必须说明它读取、保存和输出哪些数据。外部同步失败时，错误信息应脱敏后保存。`.env`、本地数据库、日志目录和样例中的真实用户数据不得提交。

## 8. 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| TypeScript 文件 | kebab-case | `focus-matcher.ts` |
| 测试文件 | `*.test.ts` | `ingestion.test.ts` |
| 数据库表 | snake_case | `focus_checkins` |
| 事件类型 | `domain.action` | `conversation.finished` |
| 日志 scope | 小写冒号分层 | `ingestion:api` |
| 文档文件 | kebab-case | `project-constraints.md` |

代码标识和协议字段使用英文；文档、注释、错误说明和提交描述默认使用中文。

## 9. 测试约束

核心链路必须有测试覆盖：

- 事件 schema 校验。
- 幂等去重。
- redaction 脱敏。
- trivial/substantive 判定。
- Focus 候选排序。
- decision 输出与 reason 保存。
- 输出适配器失败后的 run 状态。

没有测试覆盖时，不要重构核心决策逻辑。修复 bug 时应优先补回归测试。

## 10. 错误处理约束

HTTP 边界返回稳定错误结构，不暴露未处理异常：

```json
{
  "error": {
    "code": "invalid_event",
    "message": "事件缺少 sourceEventId",
    "runId": "run_123"
  }
}
```

内部错误必须记录到 run 和日志。可重试错误与不可重试错误的区分（如输出目标不可达属可重试、事件 schema 无效属不可重试）随 push 输出状态机一并落地（规划中）；当前 pull-only 输出下，run 失败仅落 `failed` 状态与 `error` 原因。

## 11. Adapter 扩展流程

新增来源 Adapter 时必须同时提交：

1. 事件类型说明和样例 JSON。
2. 隐私影响说明。
3. 幂等 ID 生成规则。
4. 至少一个成功摄取测试。
5. 文档中对应的接入说明。

新增输出 Adapter 时必须复用核心决策结果，不得重新判断 Focus 归属。

## 12. Agent 工作约束

Agent 修改本项目时应遵守：

- 先读 `AGENTS.md`、本文和相关设计文档。
- 不为短期方便绕过 redaction、idempotency 或 decision 记录。
- 不把任一外部工具（如 Codex）的特殊逻辑硬编码进核心模块。
- 修改协议、数据库或决策规则时，同步更新开发文档和产品设计书。
- 默认中文沟通和中文文档，必要英文术语保持原文。

## 13. MVP 阶段边界

MVP 只证明本地摄取、幂等、规则归因和输出同步可行。以下能力后置：团队账号、云同步、完整 Web 管理台、多租户权限、向量数据库和强依赖 LLM 的自动归因。任何新增需求若影响 MVP 交付，应先写入设计文档并明确取舍理由。
