# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Focus Ingestion Engine（FIE）是一个本地注意力摄取与焦点归因引擎。它接收来自 Agent、CLI、Git、自动化系统等来源的事件，经过幂等、脱敏、提取、匹配和决策后，将实质关注信号归并为 Focus 与 check-in。技术栈为 Node.js + TypeScript（ESM）、Fastify、better-sqlite3、Zod、Commander、Vitest。

## 常用命令

```bash
npm run dev          # tsx 启动本地 HTTP 服务（默认 127.0.0.1:17879）
npm test             # 运行全部 Vitest 测试
npm run build        # tsc 编译 src/ 到 dist/，再由 copy-assets.mjs 复制 schema.sql
npm run start        # 运行编译产物 dist/index.js
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit 类型检查
npm run cli -- <cmd> # tsx 运行 CLI（如 npm run cli -- ingest samples/codex-event.json）
npm run calibrate -- <corpus.json>  # 阈值校准：对阈值网格重放语料，输出分数/决策分布
```

运行单个测试文件或用例：

```bash
npx vitest run tests/ingestion.test.ts
npx vitest run -t "幂等"          # 按用例名过滤
npx vitest tests/ingestion.test.ts  # watch 模式
```

容器化：`docker compose build && docker compose up -d`，然后 `curl http://127.0.0.1:17879/health`。容器监听 `0.0.0.0:17879`，数据与日志写入 `/data` 卷。

## 架构：单向摄取流水线

> 本节描述当前实现。**续做时先读 `docs/progress-notes.md`**：记录增量重构进度与恢复指引。截至 2026-07-09：P0（D1 生命周期/D2 文件匹配/D3 纠正闭环）与 P1/P2（D5 per-source 隐私、D6 时间序、D7 文档对齐 pull-only、D8 宣称标注）均已落地；D4 Focus 层级经需求验证暂不建（见 `design-review-notes.md §5c`）；实现层 code-review #1-#12 全部闭合。设计缺口方案见 `docs/design-review-notes.md`，实现层记录见 `docs/code-review-notes.md`。

核心是一条严格单向的处理链路，由 `src/ingestion/ingest-event.ts` 中的 `ingestEvent()` 编排，每个阶段职责单一、不得越界：

```
HTTP/CLI 入口 → redaction 脱敏 → 写入 attention_events（幂等）→ 创建 ingestion_run
  → extraction 提取信号 → matching 匹配候选 Focus → decision 决策 → 写 Focus/check-in → 更新 run
```

各模块及其边界（详见 `docs/project-constraints.md` 第 3 节）：

- `src/server/http.ts`：Fastify 路由与请求校验。`POST /v1/events/ingest`、`POST /v1/events/batch`、`GET /v1/runs`、`GET /v1/runs/:id`、`GET /v1/focuses`、`GET /v1/trend`、`GET /health`。只做 HTTP 边界，不做业务决策。
- `src/ingestion/`：`schema.ts`（Zod 事件 schema）+ `ingest-event.ts`（流水线编排 + 幂等）。**只负责摄取和幂等，不做业务归因**。
- `src/redaction/redact.ts`：脱敏层。所有进入提取/匹配/日志/导出的内容必须先经过此层。按生效 `privacyMode`（`metadata` / `summary` / `local_raw`，由 `resolvePrivacyMode` 解析 per-source 覆盖后确定）决定保留多少内容；`metadata` 模式按键白名单最小化；正则移除 token、私钥、GitHub/Slack/AWS 凭据、邮箱、Bearer、`/Users/` 与 `/home/` 家目录路径、IP、手机号等。
- `src/extraction/rule-extractor.ts`：基于规则判定 trivial vs substantive，提取 topic/progress/blocker/nextAction。命中 `SUBSTANTIVE_KEYWORDS`、有文件变更、或事件类型含 `finished`/`commit` 视为实质。
- `src/matching/focus-matcher.ts`：为候选 Focus 打分（项目名 +50；Focus 名命中 +30，通用词/等于 project/type 时不加；每关键词 +10；文件路径完整重合 +25/命中上限 +50、同目录 +8、同文件名 +4；活跃度 ≤7d +5 / ≤30d +2，参考时间用事件 `occurredAt`），返回前 5 名。仅 `active`/`dormant` 参与匹配。
- `src/decision/decision-engine.ts`：双阈值输出 `skip` / `check_in` / `create_and_check_in`。分数 `>= tMatch` 高置信 check_in；`[tCreate, tMatch)` 归入最高候选并标 `lowConfidence`；`< tCreate` 才新建。阈值来自 `config.tMatch`/`tCreate`。
- `src/outputs/json-export.ts`：JSONL 导出（pull-only）。**输出适配器不得包含业务规则**，只写已确定的数据。
- `src/db/`：`index.ts`（打开 SQLite、开启 WAL、执行迁移）+ `repository.ts`（全部 SQL）+ `migrations.ts`（幂等增量迁移）+ `schema.sql`（基础表结构）。
- `src/cli/index.ts`：Commander CLI（`ingest` / `runs tail|show` / `focus list|merge|archive|sweep` / `checkin reassign|confirm|drop` / `stats` / `trend` / `export jsonl`）。**不得绕过核心服务直接写库**。
- `src/shared/`：`types.ts`、`id.ts`、`paths.ts`（路径规范化）、`logger.ts`（流式 JSON Lines 日志，支持优雅关闭）。
- `scripts/calibrate.ts`：阈值校准工具（非用户 CLI），用真实流水线对阈值网格重放语料。

## 关键约束（不可绕过）

这些是项目铁律，来自 `docs/project-constraints.md`，优先级高于实现便利：

- **幂等**：所有事件必须带 `source` + `sourceEventId`；数据库对二者建 `UNIQUE` 约束。重复事件返回 `duplicate` 且不写 check-in。
- **脱敏不可绕过**：任何写入日志、输出或调试文件的内容都必须先经 redaction 层。禁止记录 API Key、Token、Cookie、完整对话、未脱敏路径/邮箱。
- **决策可解释**：decision 输出必须含 `decision`、`reason`、候选信息，全部持久化到 `ingestion_runs`（`candidates_json`、`reason`）。
- **run 不可删**：`ingestion_runs` 原始记录不删除，需隐藏时用状态字段表达。
- **不硬编码外部工具逻辑**：不要把某个具体下游系统的特殊逻辑写进核心模块。

## 数据模型

SQLite 表（基础表见 `src/db/schema.sql`，snake_case 命名）：

- `attention_events`：外部事件（`source` + `source_event_id` UNIQUE、`occurred_at`、`type`、脱敏摘要、metadata）。
- `ingestion_runs`：每次处理的 `status`（processing/duplicate/accepted/failed）、`decision`、`reason`、`candidates_json`、`error`（pull-only，无重试字段）。
- `focuses`：稳定关注对象。基础列 + 迁移追加 `status`（active/dormant/archived/merged）、`merged_into`、`last_decayed_at`、`paths_json`。
- `focus_checkins`：一次归因的摘要/阻塞/下一步/来源。基础列 + 迁移追加 `paths_json`、`low_confidence`、`corrected`、`dropped`。
- `focus_events`：纠正与生命周期操作审计（`kind` = reassign/merge/archive/delete_checkin/confirm，from/to focus、checkin_id、actor、reason）。

启动时 `applyMigrations` 先执行整份 `schema.sql`（全部 `CREATE TABLE IF NOT EXISTS` 建基础表），再跑 `src/db/migrations.ts` 的幂等增量迁移通道（`schema_migrations` 记录 + `columnExists`/`addColumn` 守卫，当前含 `0001_focus_paths` → `0005_checkin_corrected`）。**新增列/表一律追加到 `migrations` 列表，禁止裸 `ALTER TABLE ADD COLUMN`。**

## 约定

- 代码标识、协议字段、事件类型（`domain.action` 如 `conversation.finished`）用英文 camelCase；文档、注释、提交信息、错误说明用中文。
- 文件名 kebab-case，命名导出，2 空格缩进。测试放 `tests/`，命名 `*.test.ts`。
- 提交遵循中文 Conventional Commit（如 `feat: 初始化摄取 API`、`docs: 补充适配器说明`）。
- 配置通过 `.env`（见 `.env.example`）读取，由 `src/config.ts` 用 Zod 校验。**禁止提交** `.env`、本地数据库、日志和真实用户数据。
- 新增来源/输出 Adapter 时须同时提供样例 JSON、隐私影响说明、幂等 ID 规则、成功摄取测试和文档（`docs/adapters.md`）。

## 构建注意事项

`schema.sql` 不是 TS 文件，`tsc` 不会复制它。`npm run build` 后由 `scripts/copy-assets.mjs` 复制到 `dist/db/`；Docker 构建单独 `COPY src/db/schema.sql ./dist/db/schema.sql`。`src/db/index.ts` 的 `applyMigrations` 会在 dist 路径缺失时回退到 `src/db/schema.sql`。

## 参考文档

- `docs/project-constraints.md`：项目铁律与模块边界（最高优先级）。
- `docs/development-guide.md`：技术栈、流程、接口、数据模型、测试重点。
- `docs/product-design.md`：正式设计基准（目标用户、Focus 生命周期、归因、纠正闭环、隐私模型等，含 D1–D8）。
- `docs/design-review-notes.md`：设计缺口 D1–D8 方案、D4 需求验证（§5c）与阈值校准方法（§7a）。
- `docs/progress-notes.md`：增量重构进度与恢复指引（续做时先读）。
- `docs/adapters.md` / `docs/protocol.md`：Adapter 接入与事件协议。
- `AGENTS.md`：仓库贡献规范。
