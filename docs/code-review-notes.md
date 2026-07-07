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

### 5. 活跃度/排序用摄取时间而非 occurredAt
- 位置：`src/db/repository.ts:96`（`nowIso()`）、`listRuns` 按 `created_at`
- 影响：历史回填 / 乱序到达事件污染 Focus 活跃度与“7 天内 +5”匹配加分。

### 6. 先查后插在多进程共享 DB 下非原子
- 位置：`src/db/repository.ts:18-41`
- 现象：SELECT-then-INSERT。单进程同步执行无碍；多副本共享同一 sqlite 时竞态，第二个 INSERT 撞 UNIQUE 抛异常 → 500。
- 建议：`INSERT ... ON CONFLICT DO NOTHING` 或捕获约束错误当重复处理。

### 7. 批量接口无逐条隔离
- 位置：`src/server/http.ts:64-96`
- 现象：`events.map(ingestEvent)` 中任一条抛错 → 整个 batch 500，已写库项响应丢失。
- 建议：逐条 try/catch，把失败项计入结果。

## P2

### 8. privacyMode='metadata' 未真正最小化
- 位置：`src/redaction/redact.ts:28-30, 37-45`
- 现象：该模式仍原样存整个 metadata，仅做 120 字符截断，无键白名单。
- 影响：与“只保存来源/时间/类型和少量标签”语义不符。

### 9. 脱敏规则覆盖窄
- 位置：`src/redaction/redact.ts:3-9`
- 现象：仅覆盖 sk-、Bearer、email、/Users/。漏 ghp_/AWS key、/home/ 路径、IP、手机号等。

### 10. Focus 名称匹配噪音大 — 已修复（2026-07-07）
- 位置：`src/matching/focus-matcher.ts:29-32`
- 现象：`text.includes(focus.name)` 子串命中即 +30；新 Focus name 常为通用词（project/type），易误命中。
- 处理：加通用名门槛——name 长度 < 4、或等于事件 project、或等于事件 type 时不加 +30。

### 11. 日志同步写盘
- 位置：`src/shared/logger.ts:15`
- 现象：`appendFileSync` 每条同步落盘，batch 高吞吐阻塞事件循环。

## 配置

### 12. .env.example 含真实部署信息 — 已修复（2026-07-07）
- 位置：`.env.example:8-11`
- 现象：真实 endpoint `congrong.online:18789`、路径 `/home/hanjun/focus`、含具体部署指令的 prompt。
- 处理：删除未被任何代码引用的 OPENCLAW 部署块及 README 对应残留段落，`.env.example` 只保留 FIE 配置与新增双阈值/dormant 变量。
