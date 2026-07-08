# 代码问题记录（Code Review Notes）

记录时间：2026-07-07
范围：Focus Ingestion Engine MVP 实现层问题（非产品设计问题，设计问题另评）。
优先级：P0 一致性/可观测性硬伤，P1 健壮性，P2 优化/一致性。

## P0

### 1. 缺事务，中途崩溃导致数据不一致 — 已修复（2026-07-07）
- 位置：`src/ingestion/ingest-event.ts:17-49`
- 现象：`insertAttentionEvent → createIngestionRun → createFocus/appendCheckin → updateRunDecision` 是多次独立写，未包在 `db.transaction()` 里。
- 影响：任一步之后崩溃会留下脏状态（如 focus/checkin 已写但 run 无 decision）。
- 处理：event/run 落库后，将 extraction→matching→decision→写 focus/checkin→updateRunDecision 包进 `db.transaction()`；失败时事务回滚，run 单独置 `failed`。

### 2. 失败 run 永远写不进 failed/error — 已修复（2026-07-07）
- 位置：`src/server/http.ts:58-61`、`src/db/repository.ts:44-60`
- 现象：`createIngestionRun` 支持 `'failed'` 但只以 `'accepted'` 调用；`updateRunDecision` 硬编码 `status='accepted'`。捕获非 Zod 异常时只 log + 返回 500，未回写 run。
- 影响：`ingestion_runs.error` 与 `status='failed'` 从未被使用，违反铁律 2.4 / 约束第 10 节“内部错误必须记录到 run”。
- 处理：新增 `markRunFailed(db, runId, error)`，`ingestEvent` 捕获异常后置 run 为 `failed` 并写入截断后的 error（500 字符）再重抛；HTTP 层维持 500 响应。

### 3. run 初始状态语义错误 — 已修复（2026-07-07）
- 位置：`src/db/repository.ts:44-52`
- 现象：决策前就标 `accepted`，应为 `processing`/`pending`。
- 影响：配合 1、2 条，崩溃后残留记录会伪装成“成功”。
- 处理：`createIngestionRun` 初始态改 `processing`（重复事件为 `duplicate`），成功后由 `updateRunDecision` 转 `accepted`，失败转 `failed`。

## P1

### 4. focus_links 表与 focuses.weight 是死代码 — 已修复（2026-07-07）
- 位置：`src/db/schema.sql:33, 54-64`
- 现象：`focus_links` 无任何 INSERT；`weight` 从不更新、matcher 不读。
- 影响：与 `docs/development-guide.md` 第 8 节声明不符。
- 处理：删除 `focus_links` 表与 `focuses.weight` 列，同步清理 `repository.ts`、`cli/index.ts` 引用；关联改为依赖外键。文档（product-design §19、development-guide §8、CLAUDE.md）同步更新。

### 5. 活跃度/排序用摄取时间而非 occurredAt — 已修复（2026-07-08）
- 位置：`src/db/repository.ts`（`createFocusWithCheckin`/`appendCheckin`）、`src/matching/focus-matcher.ts`
- 影响：历史回填 / 乱序到达事件污染 Focus 活跃度与“7 天内 +5”匹配加分。
- 处理：`last_activity_at` 改用 `event.occurredAt`；`appendCheckin` 取 `max(existing, occurredAt)` 防乱序回退；matcher 活跃度加分的参考时间改用当前事件 `occurredAt` 而非 `Date.now()`，保证回填/乱序批次自洽。测试见 `tests/ingestion.test.ts`（“活跃度以 occurredAt 为准…”）。listRuns 仍按 `created_at`（摄取处理顺序，对 run 视图语义合理，未改）。

### 6. 先查后插在多进程共享 DB 下非原子 — 已修复（2026-07-08）
- 位置：`src/db/repository.ts`（`insertAttentionEvent`）
- 现象：SELECT-then-INSERT。单进程同步执行无碍；多副本共享同一 sqlite 时竞态，第二个 INSERT 撞 UNIQUE 抛异常 → 500。
- 处理：改为 `INSERT ... ON CONFLICT(source, source_event_id) DO NOTHING`；`changes===0` 时按重复处理并查回既有 id，插入本身原子，杜绝竞态 500。

### 7. 批量接口无逐条隔离 — 已修复（2026-07-08）
- 位置：`src/server/http.ts`（`POST /v1/events/batch`）
- 现象：`events.map(ingestEvent)` 中任一条抛错 → 整个 batch 500，已写库项响应丢失。
- 处理：逐条 try/catch，失败项计 `status='failed'` 并写日志，响应新增 `failed` 计数，成功项不受影响。测试见 `tests/http.test.ts`（批量结果含 `failed` 字段）。

## P2

### 8. privacyMode='metadata' 未真正最小化 — 已修复（2026-07-08）
- 位置：`src/redaction/redact.ts`（`sanitizeMetadata`）
- 现象：该模式仍原样存整个 metadata，仅做 120 字符截断，无键白名单。
- 处理：metadata 模式按键白名单 `METADATA_MODE_ALLOWED_KEYS`（files/tags/labels/branch/repo/project）过滤，丢弃其余键；保留 `files` 以维持路径匹配。summary/local_raw 模式仍保留全部键（仅脱敏值）。测试见 `tests/redaction.test.ts`。

### 9. 脱敏规则覆盖窄 — 已修复（2026-07-08）
- 位置：`src/redaction/redact.ts`（`SECRET_PATTERNS`）
- 现象：仅覆盖 sk-、Bearer、email、/Users/。漏 ghp_/AWS key、/home/ 路径、IP、手机号等。
- 处理：新增私钥块、GitHub token（gh?_/github_pat_）、Slack token（xox?-）、AWS AKIA/ASIA、/home/ 路径、IPv4、中国大陆手机号规则。测试见 `tests/redaction.test.ts`。

### 10. Focus 名称匹配噪音大 — 已修复（2026-07-07）
- 位置：`src/matching/focus-matcher.ts:29-32`
- 现象：`text.includes(focus.name)` 子串命中即 +30；新 Focus name 常为通用词（project/type），易误命中。
- 处理：加通用名门槛——name 长度 < 4、或等于事件 project、或等于事件 type 时不加 +30。

### 11. 日志同步写盘 — 已修复（2026-07-08）
- 位置：`src/shared/logger.ts`
- 现象：`appendFileSync` 每条同步落盘，batch 高吞吐阻塞事件循环。
- 处理：改用 `fs.createWriteStream`（append 模式，Node 内部缓冲、按写入顺序异步落盘）；`Logger` 加可选 `close()` 冲刷缓冲，`src/index.ts` 在 SIGINT/SIGTERM 优雅关闭时先停服务器再 close 日志。测试见 `tests/logger.test.ts`。

## 配置

### 12. .env.example 含真实部署信息 — 已修复（2026-07-07）
- 位置：`.env.example:8-11`
- 现象：真实 endpoint `congrong.online:18789`、路径 `/home/hanjun/focus`、含具体部署指令的 prompt。
- 处理：删除未被任何代码引用的 OPENCLAW 部署块及 README 对应残留段落，`.env.example` 只保留 FIE 配置与新增双阈值/dormant 变量。
