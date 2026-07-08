# 进度与交接记录（Progress Notes）

更新时间：2026-07-08
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
| 5 | D3 纠正闭环 + 统计 | ✅ 已完成 |

当前测试：**41 passed**（11 个测试文件）。`typecheck` / `lint` / `test` 均通过。D1/D2/D3 三条 P0 全部闭合。

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

## 4. 步骤 5（D3 纠正闭环）落地摘要

方案见 `docs/design-review-notes.md` 第 5 节。已完成：

1. **迁移** `0005_checkin_corrected`：`focus_checkins` 加 `corrected`/`dropped`（均 `INTEGER NOT NULL DEFAULT 0`），走幂等 `addColumn` 通道。
2. **仓库层**（`src/db/repository.ts`）：
   - `reassignCheckin(db, checkinId, toFocusId, reason?)`：事务内改 `focus_id`、置 `corrected=1`、复用 `mergePaths` 维护目标 Focus 的 `paths_json`/`last_activity_at`，写 `focus_events`(kind=reassign, from/to/checkin_id)。目标须为 active/dormant，且不能与原归属相同。
   - `confirmCheckin`：清 `low_confidence`，写 `focus_events`(kind=confirm)。
   - `dropCheckin`：置 `dropped=1`（软删，不物理删），写 `focus_events`(kind=delete_checkin)。
   - `getCorrectionStats`：修正率 = `focus_events` 中 reassign/delete_checkin/merge 条数 / 总 check-in 数；另出低置信占比、corrected/dropped 计数。
3. **CLI**（`src/cli/index.ts`）：`fie checkin reassign|confirm|drop`、`fie stats`。
4. **测试**：`tests/correction.test.ts`（5 例）覆盖指针变更 + corrected 标记 + 审计、非法参数返回 false、confirm 清低置信、drop 软删、修正率统计。
5. **文档**：`design-review-notes.md §5` 标注已落地。

注意（已遵守）：原始 run/decision 记录不改不删；纠正一律体现为新的 `focus_events` + check-in 指针/标记变更（约束铁律 2.4、数据库约束第 4 条）。

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
npm run typecheck && npm run lint && npm test   # 应全绿（41 passed）
```

D1/D2/D3 三条 P0 已全部闭合。下一步可回看 `design-review-notes.md` 的 D4-D8（P1/P2），按优先级决定是否继续：D5 per-source 隐私粒度（实为刚需）、D6 时间序模型（用 occurredAt 修活跃度）、D7 输出状态机、D4 Focus 层级、D8 宣称 vs 实现标注。也可先清理第 7 节的 P1/P2 实现层遗留项。

## 7. 尚未处理的已知项（低优先，非阻塞）

`code-review-notes.md` 中仍开放：#8（metadata 隐私未最小化）、#9（脱敏覆盖窄）、#11（日志同步写盘）。均为 P2，可按需处理。

已于 2026-07-08 修复：#5（活跃度改用 occurredAt + 乱序不回退）、#6（原子 upsert `ON CONFLICT DO NOTHING`）、#7（批量逐条隔离，响应加 `failed` 计数）。当前测试 **42 passed**。
