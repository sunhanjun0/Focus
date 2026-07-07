# 进度与交接记录（Progress Notes）

更新时间：2026-07-07
用途：记录增量重构进度，方便下次直接续上。配合 `docs/code-review-notes.md`（实现层问题）与 `docs/design-review-notes.md`（设计缺口 D1-D8 方案）阅读。

## 1. 总体策略

对现有 MVP 采用**增量重构（非重写）**。骨架（事件→run→归因→Focus、幂等、脱敏、可解释）保留，按下述 5 步逐步补齐设计缺口与修复实现问题。每步都保持 `typecheck` / `lint` / `test` 全绿。

## 2. 增量路线与进度

| 步骤 | 内容 | 状态 |
|---|---|---|
| 1 | 清理死代码 + 修 P0 一致性 | ✅ 已完成 |
| 2 | 幂等迁移通道 | ✅ 已完成 |
| 3 | D2 文件维度匹配 | ✅ 已完成 |
| 4 | D1 双阈值 + Focus 生命周期 | ✅ 已完成 |
| 5 | D3 纠正闭环 + 统计 | ⬜ 待开始（下次从这里继续） |

当前测试：**36 passed**（10 个测试文件）。`typecheck` / `lint` / `test` 均通过。

## 3. 已完成内容摘要

### 步骤 1：清理死代码 + 修 P0
- 删 `focuses.weight` 列、`focus_links` 表（关联改依赖外键）。
- `ingest-event` 把 extraction→decision→写库包进 `db.transaction()`；失败经 `markRunFailed` 落 `failed` 再重抛。
- run 初始态 `processing`，成功转 `accepted`、失败转 `failed`。
- 对应 `code-review-notes.md` 问题 1/2/3/4。

### 步骤 2：幂等迁移通道
- 新增 `src/db/migrations.ts`：有序 `migrations` + `runMigrations`（`schema_migrations` 记录、事务执行、失败回滚）+ `columnExists`/`addColumn` 守卫。
- `applyMigrations` 先 exec 基础 `schema.sql`，再跑增量迁移。
- **约束：新增列/表一律追加到 `migrations`，禁止裸 `ALTER TABLE ADD COLUMN`。**

### 步骤 3：D2 文件维度匹配
- 新增 `src/shared/paths.ts`（normalize/extract/dirOf/baseOf/mergePaths）。
- 迁移 `0001_focus_paths`：`focuses`/`focus_checkins` 加 `paths_json`。
- matcher 路径三级打分（完整路径 +25/命中上限 +50、同目录 +8、同文件名 +4）；修名称匹配噪音（问题 #10）。
- 从**脱敏后**的 metadata 提取路径，写 check-in 并维护 Focus 路径并集。

### 步骤 4：D1 双阈值 + 生命周期
- 迁移 `0002_focus_lifecycle`（status/merged_into/last_decayed_at）、`0003_checkin_low_confidence`、`0004_focus_events`。
- 决策改双阈值（`FIE_T_MATCH`/`FIE_T_CREATE`），中间区间标 `lowConfidence`。
- 活跃度分段衰减（≤7d +5 / ≤30d +2 / 更久 0）。
- 仓库层：`mergeFocuses`/`archiveFocus`/`sweepDormantFocuses`/`insertFocusEvent`；候选排除 archived/merged。
- CLI：`fie focus list|merge|archive|sweep`；HTTP：`GET /v1/focuses?includeArchived=1`。
- 顺带修 `code-review-notes.md` 问题 #10、#12（删 `.env.example`/README 泄露的部署信息）。

## 4. 下一步：步骤 5（D3 纠正闭环）详细计划

方案见 `docs/design-review-notes.md` 第 5 节。基础设施已就绪（`focus_events` 表已建）。待办：

1. **迁移**：`focus_checkins` 加 `corrected INTEGER NOT NULL DEFAULT 0`（追加 `0005_checkin_corrected` 到 `migrations`）。
2. **仓库层**（`src/db/repository.ts`）新增：
   - `reassignCheckin(db, checkinId, toFocusId, reason?)`：改 check-in 的 `focus_id`，置 `corrected=1`，写 `focus_events`(kind='reassign', from/to)。
   - `confirmCheckin(db, checkinId, reason?)`：清 `low_confidence`（或标记已确认），写 `focus_events`(kind='confirm')。
   - `dropCheckin(db, checkinId, reason?)`：软删除语义（不物理删，用状态/标记表达），写 `focus_events`(kind='delete_checkin')。
   - `getCorrectionStats(db)`：修正率 = 被 reassign/纠正的 check-in 数 / 总 check-in 数等。
3. **CLI**（`src/cli/index.ts`）新增：`fie checkin reassign <checkinId> <focusId>`、`fie checkin confirm <checkinId>`、`fie checkin drop <checkinId>`。
4. **统计入口**：CLI 展示修正率（如 `fie stats` 或并入 `fie focus`），供“用户修正率”指标落地。
5. **测试**（`tests/` 新增）：reassign 后指针变更 + `corrected` 标记 + 审计记录；confirm 清低置信；修正率统计正确。
6. **文档**：`design-review-notes.md §5` 标注已落地；`development-guide.md`/`protocol.md` 若有 CLI/接口出入同步。

注意：原始 run/decision 记录不可改、不可删；纠正一律体现为新的 `focus_events` + check-in 指针/标记变更（约束铁律 2.4、数据库约束第 4 条）。

## 5. 关键文件地图

- 摄取主流程：`src/ingestion/ingest-event.ts`
- 迁移通道：`src/db/migrations.ts`（新增列/表入口）
- 仓库层（所有 SQL）：`src/db/repository.ts`
- 决策双阈值：`src/decision/decision-engine.ts`
- 匹配打分：`src/matching/focus-matcher.ts`
- 路径工具：`src/shared/paths.ts`
- 配置：`src/config.ts`（阈值/dormant 天数）
- CLI：`src/cli/index.ts`
- HTTP：`src/server/http.ts`

## 6. 恢复指引

```bash
npm install
npm run typecheck && npm run lint && npm test   # 应全绿（36 passed）
```

从「步骤 5」开始：先按第 4 节加迁移 `0005_checkin_corrected`，再补仓库函数与 CLI，最后补测试与文档。完成后 D1/D2/D3 三条 P0 全部闭合，可回看 `design-review-notes.md` 的 D4-D8（P1/P2）决定是否继续。

## 7. 尚未处理的已知项（低优先，非阻塞）

`code-review-notes.md` 中仍开放：#5（活跃度用摄取时间而非 occurredAt）、#6（先查后插非原子）、#7（批量无逐条隔离）、#8（metadata 隐私未最小化）、#9（脱敏覆盖窄）、#11（日志同步写盘）。均为 P1/P2，可在 D3 后按需处理。
