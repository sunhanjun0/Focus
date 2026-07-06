# Focus Ingestion Engine 独立应用方案

**类型：** 立项背书 / 产品方案 / 技术方案  
**日期：** 2026-07-02  
**状态：** 新项目启动参考  
**建议项目名：** Focus Ingestion Engine，简称 FIE  

---

## 1. 一句话定义

Focus Ingestion Engine 是一个面向 Agent、AI 编程工具、自动化系统和协作软件的“注意力摄取与焦点归因引擎”。它通过 hook、webhook、MCP、CLI、SDK 等入口接收对话、工具调用、文件变更和提交事件，自动判断是否形成有效关注信号，并把这些信号归并为可持续观察的 Focus。

它不是 TODO 工具，也不是聊天记录归档系统，而是一个跨工具的注意力操作系统底座。

---

## 2. 为什么值得独立成应用

### 2.1 当前痛点

过去的焦点管理依赖 Agent 在回合末尾主动调用 Skill / MCP，这有明显不稳定性：

- Agent 忙于完成主任务时容易忘记执行 Focus check-in。
- Skill 属于“提示词约束”，不是系统级保证。
- 不同工具对 Skill / MCP 支持程度不一致。
- 多轮对话中的关键进展、阻塞、文件变更和提交往往散落在不同上下文里。
- 用户不应该手动维护注意力记录，否则 Focus 会退化为另一个 TODO 系统。

### 2.2 独立应用的价值

把摄取引擎从 UUUtil 主应用中拆出来，可以带来几个关键收益：

| 维度 | 留在 UUUtil 内 | 独立应用 |
|---|---|---|
| 接入边界 | 主要服务 UUUtil Focus | 可服务所有工具和应用 |
| 数据模型 | 绑定本地个人工具 | 可定义通用 Attention Event 协议 |
| 运行形态 | Electron 附属服务 | 常驻 daemon / server / cloud / edge |
| 扩展方式 | 插件内 API | SDK、Webhook、MCP、Hook Adapter |
| 商业化可能 | 个人工具能力 | 可作为 AgentOps / PersonalOps 基础设施 |
| 可靠性 | 依赖 Agent 主动调用 | Hook 驱动，系统级触发 |

独立应用的本质不是“再做一个 Focus UI”，而是做一个通用的注意力事件管道：采集、去重、脱敏、压缩、归因、写入和分发。

### 2.3 与 UUUtil 的关系

UUUtil 继续作为一个消费者：

- UUUtil Focus 看板负责展示焦点状态。
- FIE 负责从各种工具中提取注意力信号。
- UUUtil 可以通过 MCP / HTTP / SDK 读取 FIE 的结果，或让 FIE 反向写入 UUUtil Focus。

建议边界：

- FIE：摄取、提取、归因、路由、审计、幂等。
- UUUtil：个人桌面展示、轻量交互、与其他个人插件联动。

---

## 3. 产品定位

### 3.1 目标用户

第一阶段目标用户是高频使用 AI 工具的人：

- 使用 Codex、Claude Code、Cursor、Aider、Cline 等工具的开发者。
- 同时在多个 Agent / IDE / 终端中推进工作的个人。
- 需要复盘自己注意力分布、阻塞、上下文切换和持续主题的人。
- 希望让自动化系统帮自己沉淀工作脉络的知识工作者。

后续可扩展到团队：

- 小团队的 Agent 工作流审计。
- AI 研发过程中的任务归因与上下文复用。
- 研发管理中的“真实关注度”观察，而非手动日报。

### 3.2 核心用户故事

1. 作为一个开发者，我希望 AI 编程工具每次完成实质性工作后自动记录关注主题，而不是靠我手动维护。
2. 作为一个长期项目维护者，我希望看到最近注意力集中在哪些方向、哪些方向正在漂移。
3. 作为一个多工具用户，我希望 Codex、Cursor、Claude Code、终端脚本产生的上下文能进入同一套注意力记录。
4. 作为一个重度 Agent 用户，我希望系统自动识别本轮对话是“继续已有焦点”还是“形成新焦点”。
5. 作为一个注重隐私的用户，我希望可以选择只上传摘要、只上传元数据，或完全本地处理。

### 3.3 产品原则

- Hook 优先，不依赖 Agent 自觉。
- 事件优先，不直接存完整对话。
- 摘要优先，原文可选保留。
- 幂等优先，重复 hook 不应重复写焦点。
- 本地优先，云同步和团队能力后置。
- 解释优先，任何归因、合并和创建都应留下可审计理由。
- 开放协议优先，避免只服务某一个工具。

---

## 4. 核心概念

### 4.1 Attention Event

Attention Event 是外部系统传入 FIE 的原始事件。它不等同于 Focus check-in，而是待处理信号。

典型来源：

- 对话结束事件。
- 工具调用事件。
- 文件变更事件。
- Git commit / PR / branch 事件。
- 自动化任务完成事件。
- 用户手动标记的关键片段。

### 4.2 Focus

Focus 是被系统归纳出来的稳定关注对象，代表一个项目、问题、风险、产品方向、调查线索或长期主题。

Focus 不是任务，因此不需要完成状态。它通过权重、健康度、最近检视、阻塞和趋势来表达注意力状态。

### 4.3 Check-in

Check-in 是对某个 Focus 的一次归因结果。它可以来自 Agent 主动调用，也可以由 FIE 从 Attention Event 中自动提取。

### 4.4 Ingestion Run

Ingestion Run 是一次摄取处理过程，用于记录：

- 输入事件。
- 去重结果。
- 脱敏结果。
- 摘要结果。
- Focus 匹配候选。
- 最终写入动作。
- 失败与重试信息。

---

## 5. 系统架构

### 5.1 总体架构

```text
Codex / Cursor / Claude Code / CLI / Git / Webhook
          ↓
   Adapters & Hooks
          ↓
   Ingestion API Gateway
          ↓
   Event Store + Idempotency
          ↓
   Privacy & Redaction Layer
          ↓
   Summarizer / Extractor
          ↓
   Focus Matcher
          ↓
   Decision Engine
          ↓
   Focus Store + Check-in Store
          ↓
   Outputs: MCP / HTTP API / Web UI / UUUtil Sync
```

### 5.2 模块拆分

| 模块 | 职责 | MVP 是否需要 |
|---|---|---|
| API Gateway | 接收 HTTP、MCP、CLI、SDK 事件 | 需要 |
| Adapter Layer | Codex、Cursor、Claude Code、Git 等适配 | 先做 Codex/通用 webhook |
| Event Store | 保存原始或摘要事件，支持回放 | 需要 |
| Idempotency | 根据 source + eventId 去重 | 需要 |
| Redaction | 脱敏、截断、隐私模式控制 | 需要 |
| Extractor | 从事件中提取主题、进展、阻塞、下一步 | 需要，先规则后 LLM |
| Focus Matcher | 匹配已有 Focus 或建议新建 | 需要 |
| Decision Engine | 决定 skip / check-in / create+check-in / update metadata | 需要 |
| Focus Store | 保存 Focus 和 Check-in | 需要 |
| Review UI | 查看事件、归因和焦点 | MVP 可轻量 |
| Sync Outputs | 写入 UUUtil、导出 JSON、MCP 查询 | 需要 UUUtil sync |

### 5.3 推荐技术栈

独立应用建议优先做成本低、易部署的本地服务：

- Runtime：Node.js + TypeScript。
- API：Fastify 或 Hono。
- DB：SQLite + better-sqlite3，后续可迁移 Postgres。
- Queue：MVP 使用内存队列 + SQLite 状态；后续换 BullMQ / pg-boss。
- MCP：`@modelcontextprotocol/sdk`。
- UI：React + Vite，或先无 UI 只提供 API。
- SDK：先提供 TypeScript SDK。
- Packaging：本地 daemon + CLI，后续再做 Electron 托盘或 Docker。

不建议 MVP 一开始做重 Electron。独立引擎的重点是稳定摄取和协议，不是桌面 UI。

---

## 6. 数据模型建议

### 6.1 attention_events

```sql
CREATE TABLE attention_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  privacy_mode TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(source, source_event_id)
);
```

### 6.2 ingestion_runs

```sql
CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  reason TEXT,
  extractor_version TEXT,
  matcher_version TEXT,
  error TEXT,
  result_json TEXT
);
```

### 6.3 focuses

```sql
CREATE TABLE focuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  attention_mode TEXT NOT NULL,
  weight REAL NOT NULL,
  expected_exit TEXT,
  tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_decay_at TEXT NOT NULL
);
```

### 6.4 focus_checkins

```sql
CREATE TABLE focus_checkins (
  id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  event_id TEXT,
  timestamp TEXT NOT NULL,
  energy TEXT NOT NULL,
  blocker TEXT,
  next_action TEXT,
  notes TEXT,
  confidence REAL NOT NULL,
  extraction_json TEXT,
  FOREIGN KEY (focus_id) REFERENCES focuses(id),
  FOREIGN KEY (event_id) REFERENCES attention_events(id)
);
```

### 6.5 focus_links

用于记录事件、文件、提交、PR、外部 URL 与 Focus 的关联。

```sql
CREATE TABLE focus_links (
  id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  title TEXT,
  url TEXT,
  ref TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
```

---

## 7. 标准摄取协议

### 7.1 HTTP API

```http
POST /v1/events/ingest
Content-Type: application/json
```

请求示例：

```json
{
  "source": "codex",
  "sourceEventId": "thread-123:turn-456",
  "eventType": "conversation.turn.completed",
  "occurredAt": "2026-07-02T10:00:00+08:00",
  "privacyMode": "summary-only",
  "actor": {
    "type": "agent",
    "name": "Codex"
  },
  "context": {
    "workspace": "/Users/hanjun/UUUtil",
    "project": "UUUtil",
    "branch": "main"
  },
  "summary": "讨论将 Focus 摄取引擎独立成应用，用 hook 替代 Skill 自觉触发。",
  "messages": [],
  "toolCalls": [
    { "name": "git status", "status": "success" }
  ],
  "filesChanged": [
    "report/focus-ingestion-engine-independent-app-proposal.md"
  ],
  "commit": null,
  "metadata": {
    "conversationUrl": null,
    "model": "codex"
  }
}
```

返回示例：

```json
{
  "eventId": "evt_...",
  "runId": "run_...",
  "status": "processed",
  "decision": "check_in",
  "focusId": "foc_...",
  "checkInId": "chk_...",
  "confidence": 0.86,
  "reason": "Matched existing focus by project, topic and recent MCP discussion."
}
```

### 7.2 MCP Tools

MVP 建议提供：

- `attention_ingest_event`：摄取标准 Attention Event。
- `attention_ingest_conversation`：便捷摄取对话摘要和消息。
- `attention_get_event`：查看事件和处理结果。
- `attention_list_runs`：查看最近摄取运行。
- `focus_list` / `focus_get` / `focus_checkins`：读取焦点状态。
- `focus_review_pending`：查看低置信度待确认归因。
- `focus_confirm_decision`：人工确认或纠正低置信度归因。

注意：MVP 不建议让每个外部 Agent 直接调用 `focus_create` 和 `focus_check_in`。外部系统只提交事件，决策由 FIE 完成。

### 7.3 CLI

```bash
fie ingest --source codex --event-id thread:turn --summary "..."
fie status
fie focus list
fie runs tail
```

CLI 主要服务本地 hook 和调试。

---

## 8. 提取与归因引擎

### 8.1 决策类型

一次事件处理后只能产生以下决策之一：

| decision | 含义 |
|---|---|
| `skip` | 非实质工作，不写入 Focus |
| `check_in` | 匹配已有 Focus，追加 check-in |
| `create_and_check_in` | 新建 Focus 并追加 check-in |
| `update_metadata` | 修正 Focus 元数据，通常伴随 check-in |
| `needs_review` | 低置信度，等待人工确认 |

### 8.2 规则提取 MVP

MVP 不必依赖 LLM，可以先用规则处理：

- 如果包含文件修改、构建、测试、提交、MCP 调用、设计决策，则视为实质事件。
- 如果只有寒暄、简单确认、纯浏览无结论，则 skip。
- 从 `workspace`、`project`、`filesChanged`、`commit message`、`summary` 中提取候选主题。
- 使用最近 Focus、标签、项目名、文件路径相似度匹配已有 Focus。
- 匹配置信度不足时写入 `needs_review`，不自动创建新 Focus。

### 8.3 LLM 提取增强

当规则不足时，再引入 LLM 提取：

```json
{
  "substantive": true,
  "focusName": "Focus Ingestion Engine 独立应用",
  "description": "围绕将焦点摄取能力从 UUUtil 拆为独立应用的产品和架构设计。",
  "energy": "engaged",
  "notes": "形成独立应用方案，包含定位、架构、协议和 MVP 路线图。",
  "blocker": null,
  "nextAction": "另起项目并搭建本地 daemon + HTTP ingest API。",
  "tags": ["focus", "ingestion", "agentops", "mcp"],
  "confidence": 0.88
}
```

LLM 输出必须经过 schema 校验，且只作为建议；最终写入仍由 Decision Engine 执行。

---

## 9. 隐私与安全

FIE 处理的是对话和工作上下文，隐私策略必须前置设计。

### 9.1 隐私模式

| 模式 | 行为 | 适用场景 |
|---|---|---|
| `metadata-only` | 只保存 source、事件类型、文件名、提交号等元数据 | 高敏感环境 |
| `summary-only` | 保存外部系统传入摘要，不保存完整消息 | 默认推荐 |
| `redacted` | 保存脱敏后的消息片段 | 需要审计和回放 |
| `raw` | 保存完整原文 | 仅本地、明确授权 |

### 9.2 脱敏规则

默认应过滤：

- API Key、Token、Cookie、Authorization header。
- 私钥、证书、`.env` 内容。
- 大体积附件正文和 base64。
- 完整用户隐私输入。
- 明确标记为 secret 的字段。

### 9.3 安全边界

- 本地服务默认只监听 `127.0.0.1`。
- 远程访问必须开启 token 或 mTLS。
- Webhook 入口支持签名校验。
- 所有写入事件必须记录来源和幂等 key。
- LLM 提取器不得默认接收 raw 模式内容，除非用户显式开启。

---

## 10. Adapter 策略

### 10.1 通用 Webhook Adapter

所有工具都可以先通过 HTTP hook 接入：

```bash
curl -X POST http://127.0.0.1:18787/v1/events/ingest \
  -H 'Content-Type: application/json' \
  -d @event.json
```

这是 MVP 最重要的入口。

### 10.2 Codex Adapter

Codex 侧如果支持 hook，建议在以下时机发送事件：

- 用户消息进入后。
- assistant 回合结束后。
- 工具调用完成后。
- 文件修改完成后。
- git commit 成功后。

若 hook 只能执行命令，则使用 `fie ingest` CLI。

### 10.3 Git Adapter

Git hook 可以补充非对话来源的工作信号：

- `post-commit`：发送 commit message、changed files、diff stat。
- `post-checkout`：记录上下文切换。
- `pre-push` / `post-push`：记录发布或同步动作。

### 10.4 UUUtil Adapter

UUUtil 作为消费者，建议有两种模式：

1. Pull：UUUtil 从 FIE 读取 Focus 和 Check-in。
2. Push：FIE 决策后调用 UUUtil MCP 写入现有 Focus 看板。

MVP 推荐 Push，复用现在已有的 UUUtil Focus UI。

---

## 11. MVP 范围

### 11.1 MVP 目标

用最小成本证明：hook 比 Skill 更稳定，FIE 可以把外部事件自动归因为 Focus check-in。

### 11.2 MVP 必做

- 本地 HTTP 服务：`POST /v1/events/ingest`。
- SQLite 存储：events、runs、focuses、checkins。
- 幂等：`source + sourceEventId` 去重。
- 规则提取器：判断 skip / substantive。
- 简单 Focus Matcher：项目名、文件路径、关键词、最近活跃度。
- UUUtil Push Adapter：调用 UUUtil MCP 写入焦点。
- CLI：`fie ingest`、`fie runs tail`、`fie focus list`。
- 日志：JSON Lines，记录 ingest、decision、sync。
- 基础配置：端口、隐私模式、UUUtil MCP URL。

### 11.3 MVP 暂不做

- 团队账号和云同步。
- 完整 Web 管理台。
- 多租户权限系统。
- 复杂向量数据库。
- 自动读取 IDE 内部私有状态。
- 强依赖 LLM 的归因能力。

### 11.4 里程碑

| 阶段 | 时间 | 目标 | 产出 |
|---|---|---|---|
| M0 | 0.5 天 | 新项目脚手架 | TypeScript、SQLite、配置、日志 |
| M1 | 1 天 | Ingest API | HTTP endpoint、事件表、幂等 |
| M2 | 1 天 | 规则归因 | Extractor、Matcher、Decision Engine |
| M3 | 0.5 天 | UUUtil 同步 | 调用现有 MCP 写入 Focus |
| M4 | 0.5 天 | CLI 和调试 | ingest/status/runs 命令 |
| M5 | 1 天 | Hook 验证 | Codex/通用 hook 真实跑通 |

建议第一版控制在 4-5 天内完成。

---

## 12. 新项目建议结构

```text
focus-ingestion-engine/
├── package.json
├── README.md
├── .env.example
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── server/
│   │   ├── http.ts
│   │   └── routes.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── migrations.ts
│   │   └── schema.sql
│   ├── ingestion/
│   │   ├── ingest-event.ts
│   │   ├── idempotency.ts
│   │   └── redaction.ts
│   ├── extraction/
│   │   ├── rule-extractor.ts
│   │   ├── llm-extractor.ts
│   │   └── schema.ts
│   ├── matching/
│   │   ├── focus-matcher.ts
│   │   └── scoring.ts
│   ├── decision/
│   │   └── decision-engine.ts
│   ├── outputs/
│   │   ├── uuutil-mcp.ts
│   │   └── json-export.ts
│   ├── mcp/
│   │   └── server.ts
│   └── cli/
│       └── index.ts
├── docs/
│   ├── protocol.md
│   ├── adapters.md
│   └── privacy.md
└── tests/
    ├── ingestion.test.ts
    ├── extractor.test.ts
    └── matcher.test.ts
```

---

## 13. 风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 事件过多 | 每个小动作都写入，Focus 噪声变大 | 严格 skip 规则、批处理、低置信度 review |
| 隐私担忧 | 用户不愿发送完整对话 | 默认 `summary-only`，raw 必须显式开启 |
| 归因错误 | 新建重复 Focus 或写错主题 | 幂等、候选解释、低置信度人工确认 |
| Hook 差异大 | 各工具 hook 格式不同 | 定义标准 Attention Event，Adapter 只做格式转换 |
| 过早复杂化 | 一开始做 UI、云、向量库导致失焦 | MVP 只做本地 ingest + UUUtil sync |
| LLM 成本 | 每个事件都调用模型成本高 | 规则优先，LLM 只处理长对话或低置信度事件 |
| 与 UUUtil 耦合 | 独立项目又被 UUUtil 绑定 | FIE 定义通用协议，UUUtil 只是一个 output adapter |

---

## 14. 立项背书结论

建议独立立项。

理由：

1. **问题真实。** Skill 触发不及时不是提示词问题，而是机制问题；Hook/事件驱动才是更可靠的系统边界。
2. **边界清晰。** 摄取、提取、归因和同步可以成为独立引擎；UUUtil 只需要消费结果。
3. **复用价值高。** 一旦协议确定，Codex、Cursor、Claude Code、Git hook、CI、自动化脚本都能接入。
4. **MVP 可控。** 不需要先做复杂 UI 或云服务，本地 HTTP + SQLite + 规则引擎即可验证核心假设。
5. **扩展空间大。** 后续可演进为个人 AgentOps、注意力分析、上下文记忆、团队 AI 工作流审计。

建议新项目的第一阶段目标不是“做完整 Focus 产品”，而是验证一个核心闭环：

```text
Hook 发送事件 → FIE 去重和提取 → 匹配 Focus → 写入 UUUtil → 看板出现可信变化
```

只要这个闭环稳定，后续才值得继续做 UI、LLM 提取、更多 Adapter 和团队能力。

---

## 15. 下一步行动清单

1. 新建 `focus-ingestion-engine` 仓库。
2. 复制本方案中的数据模型和标准摄取协议到新项目 `docs/`。
3. 搭建 Node.js + TypeScript + SQLite 本地服务。
4. 实现 `POST /v1/events/ingest` 和 `attention_events` 幂等写入。
5. 实现规则版 Extractor / Matcher / Decision Engine。
6. 实现 UUUtil MCP Output Adapter。
7. 写一个 Codex hook 或 CLI 模拟器发真实事件。
8. 用 1-2 天真实工作流验证误判率、漏判率和重复率。
9. 再决定是否引入 LLM 提取器和轻量 Review UI。

