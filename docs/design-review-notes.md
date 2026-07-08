# 应用设计评审与 P0 方案（Design Review Notes）

评审时间：2026-07-07
范围：Focus Ingestion Engine 产品/概念设计层面（实现层问题见 `docs/code-review-notes.md`）。
结论：骨架（事件 → run → 归因 → Focus、幂等、脱敏、可解释）自洽扎实；缺口集中在“长期可用”的几块。

## 1. 设计缺口清单

| 编号 | 缺口 | 级别 | 一句话 |
|---|---|---|---|
| D1 | Focus 无生命周期 | P0 | 无合并/归档/衰减，长期必然膨胀，与“降低维护成本”目标矛盾 |
| D2 | 归因信号过窄 | P0 | matcher 未用 files 路径与历史 check-in，跨工具归因卖点落空 |
| D3 | 无反馈闭环 | P0 | 定义了“用户修正率”指标却无任何纠正入口，质量无法迭代 |
| D4 | Focus 扁平无层级 | P1 | 粒度两难，缺 focus↔focus 关系 |
| D5 | 隐私全局单档 | P1 | 缺 per-source 粒度（open question #5，实为刚需）（✅ 已于 2026-07-08 落地） |
| D6 | 缺时间序模型 | P1 | 按摄取序而非 occurredAt，趋势/活跃度算错（部分落地：活跃度已改用 occurredAt，见 code-review #5） |
| D7 | 输出状态机悬空 | P1 | 反复强调”失败重试”，MVP 输出却是 pull-only 无失败态（✅ 已于 2026-07-08 文档对齐 pull-only；push+重试状态机随真实下游落地） |
| D8 | 宣称 > 实现 | P2 | update_metadata、MCP/SDK 入口未落地，需标注“规划中”（✅ 已于 2026-07-08 标注） |

本文详细展开 D1/D2/D3 三条 P0，其余列为后续迭代。

---

## 2. 通用实施约束（先明确，避免踩坑）

- 迁移必须可重复执行（约束第 5 节）。当前 `applyMigrations` 直接 `exec` 整份 `schema.sql`，全是 `CREATE TABLE IF NOT EXISTS`。**新增列不能直接写 `ALTER TABLE`**（重复执行会报 duplicate column）。
- 已落地幂等迁移通道（2026-07-07）：`src/db/migrations.ts` 提供有序 `migrations` 列表 + `runMigrations`（用 `schema_migrations` 表记录已应用项，事务内执行，失败回滚不记录）+ `columnExists`/`addColumn`（`PRAGMA table_info` 守卫，重复执行安全）。`applyMigrations` 先 exec 基础 `schema.sql`，再跑增量迁移。**下述所有 schema 变更都走这条通道，禁止裸 `ALTER TABLE ADD COLUMN`。**
- 所有新增写路径仍受铁律约束：不绕过 redaction、决策可解释、run 可追溯、输出不重判。

---

## 3. D1 方案：Focus 生命周期

> 状态：已落地（2026-07-07）。迁移 `0002_focus_lifecycle`（status/merged_into/last_decayed_at）、`0003_checkin_low_confidence`、`0004_focus_events`；决策引擎改双阈值（`FIE_T_MATCH`/`FIE_T_CREATE` 可配，见 `src/config.ts`）；活跃度分段衰减（≤7d +5 / ≤30d +2 / 更久 0）；`fie focus merge/archive/sweep` CLI + `mergeFocuses`/`archiveFocus`/`sweepDormantFocuses`；merge/archive 写 `focus_events` 审计。低置信标记随 check-in 落 `low_confidence`。`corrected` 列与 reassign/confirm/drop 留待 D3。

### 3.1 目标
让 Focus 数量在长期使用下收敛而非发散，且收敛过程可解释、可回滚。

### 3.2 数据模型变更

`focuses` 增加：

```sql
-- 幂等迁移追加
status        TEXT NOT NULL DEFAULT 'active',   -- active | dormant | archived | merged
merged_into   TEXT,                             -- status=merged 时指向目标 focus_id
last_decayed_at TEXT                            -- 上次衰减计算时间
```

状态语义：
- `active`：正常参与匹配。
- `dormant`：超过 N 天（默认 30）无 check-in，仍可被匹配但不计“最近活跃”加分，且在默认列表折叠。
- `archived`：用户手动归档，不再参与匹配，可查询。
- `merged`：被合并进 `merged_into`，不参与匹配；历史 check-in 通过指针可回溯到目标 Focus。

### 3.3 创建阈值：从单阈值改双阈值

当前只有 `MATCH_THRESHOLD=50`：≥50 check_in，否则一律新建。改为双阈值区间：

| 最高候选分数 | 决策 | 说明 |
|---|---|---|
| `>= T_match`（默认 50） | `check_in` | 高置信归属已有 Focus |
| `T_create <= 分 < T_match`（默认 25~50） | `check_in` + `low_confidence=true` | 归到最高候选但标低置信，进纠正队列（配合 D3） |
| `< T_create`（默认 25） | `create_and_check_in` | 确无归属才新建 |

效果：中间地带不再无脑造新 Focus，抑制碎片化；低置信记录暴露给用户复核。

### 3.4 近似 Focus 合并

- 触发：CLI 手动 `fie focus merge <fromId> <intoId>`（MVP）；后续可加自动候选提示。
- 行为：`from` 的 check-in 的 `focus_id` 改指 `into`；`from.status='merged'`、`merged_into=into`；合并 keywords 去重；`into.last_activity_at` 取两者较新。
- 可回滚：保留 merged 记录与指针，不物理删除（符合“run/记录不可删”精神）。
- 合并动作本身写一条 `focus_event`（见 D3 反馈表）记录操作者与理由。

### 3.5 活跃度衰减

- 每次摄取或 CLI `fie focus sweep` 时，对超过阈值未活跃的 `active` Focus 置 `dormant`。
- 匹配加分里“7 天内 +5”改为分段：≤7 天 +5，≤30 天 +2，>30 天（dormant）0。

### 3.6 MVP 边界
- 必做：`status`/`merged_into` 字段、双阈值、手动 merge/archive CLI、dormant 衰减。
- 后置：自动合并候选推荐、Focus 健康度评分。

---

## 4. D2 方案：拓宽归因信号

> 状态：已落地（2026-07-07）。`focuses`/`focus_checkins` 经迁移 `0001_focus_paths` 增 `paths_json`；路径规范化见 `src/shared/paths.ts`；打分扩展与名称防噪见 `src/matching/focus-matcher.ts`；跨工具收敛有集成测试覆盖。阈值重标定（4.5）待 D1 双阈值一并处理。

### 4.1 目标
兑现“跨工具归因”卖点：让改同一批文件/同一主题的不同来源事件收敛到同一 Focus。

### 4.2 数据模型变更

Focus 需要“记住”自己涉及过哪些文件路径。两种方案：

- 方案 A（推荐，MVP）：`focuses` 增加 `paths_json TEXT NOT NULL DEFAULT '[]'`，聚合最近 N 条 check-in 涉及的规范化路径。
- 方案 B：从 `focus_checkins` 关联事件的 metadata 实时聚合（省列但每次匹配要 join + 解析，较慢）。

采用方案 A；`focus_checkins` 增加 `paths_json TEXT NOT NULL DEFAULT '[]'` 保存该次涉及路径，Focus 的 `paths_json` 由最近若干 check-in 的路径并集（上限如 50 条）维护。

### 4.3 路径规范化

在 redaction 之后、matching 之前，对 `metadata.files` 做规范化（不破坏脱敏）：
- 统一分隔符、去重、取相对项目根路径（若可推断）。
- 保留：完整相对路径、目录、文件名三级，供分级匹配。

### 4.4 打分维度扩展

现有：项目名 +50 / 名称命中 +30 / 每关键词 +10 / 近期活跃 +5。新增文件与历史信号：

| 维度 | 加分 | 说明 |
|---|---|---|
| 完整相对路径重合 | +25 / 命中路径（上限 +50） | 最强跨工具信号 |
| 同目录重合 | +8 / 目录 | 次强 |
| 同文件名（不同目录） | +4 | 弱信号 |
| 历史 check-in 关键词重合 | +6 / 词（上限 +18） | 主题延续性 |

同时修正 D-code#10：Focus 名称子串匹配加最小长度门槛（如 name 长度 < 4 或为纯通用词时不加 +30），降低噪音。

### 4.5 与 D1 阈值联动
路径维度接入后，`T_match`/`T_create` 需要重标定（路径命中会显著抬高分数）。建议用一批真实事件做一次离线校准，把阈值写进配置而非硬编码，便于 open question #3 迭代。

### 4.6 MVP 边界
- 必做：路径规范化 + 完整路径/目录匹配 + Focus.paths_json 维护 + 名称匹配防噪。
- 后置：历史 check-in 语义相似度（向量）——保持 MVP“不依赖向量库”。

---

## 5. D3 方案：反馈闭环

> 状态：已落地（2026-07-08）。迁移 `0005_checkin_corrected`（`focus_checkins` 加 `corrected`/`dropped`）；仓库层 `reassignCheckin`/`confirmCheckin`/`dropCheckin`/`getCorrectionStats`（`src/db/repository.ts`）；CLI `fie checkin reassign|confirm|drop` 与 `fie stats`（`src/cli/index.ts`）；reassign 复用 D2 逻辑维护目标 Focus 的 `paths_json`/`last_activity_at`，纠正一律写 `focus_events` 审计，原始 run/check-in 不物理删（drop 用 `dropped` 软删标记）。测试见 `tests/correction.test.ts`。

### 5.1 目标
让用户能纠正归因，并把纠正沉淀为可度量指标与规则改进依据。

### 5.2 数据模型变更

新增反馈/操作审计表（同时承载 D1 合并的审计）：

```sql
CREATE TABLE IF NOT EXISTS focus_events (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,          -- reassign | merge | archive | delete_checkin | confirm
  checkin_id   TEXT,                   -- 涉及的 check-in（可空）
  from_focus_id TEXT,
  to_focus_id   TEXT,
  actor        TEXT NOT NULL DEFAULT 'user',
  reason       TEXT,
  created_at   TEXT NOT NULL
);
```

`focus_checkins` 增加：
```sql
low_confidence INTEGER NOT NULL DEFAULT 0,  -- 配合 D1 双阈值
corrected      INTEGER NOT NULL DEFAULT 0   -- 是否被用户纠正过
```

原始 run/decision 记录不动（保持可解释与不可删）；纠正体现为新的 `focus_events` + check-in 指针变更。

### 5.3 操作入口（CLI 优先，MVP 用 CLI；API 后置）

| 命令 | 作用 |
|---|---|
| `fie checkin reassign <checkinId> <focusId>` | 把 check-in 改归到正确 Focus，写 focus_events(kind=reassign)，置 corrected=1 |
| `fie checkin confirm <checkinId>` | 确认低置信归因正确，清 low_confidence |
| `fie checkin drop <checkinId>` | 标记误记录（软删：状态字段，不物理删） |
| `fie focus merge <fromId> <intoId>` | D1 合并 |
| `fie focus archive <focusId>` | D1 归档 |

reassign 时同步维护目标 Focus 的 `paths_json` / `last_activity_at`（复用 D2 逻辑）。

### 5.4 指标采集（兑现第 12 节成功指标）

- 用户修正率 = `count(focus_events.kind in (reassign, drop, merge))` / `count(focus_checkins)`。
- 低置信占比 = `count(low_confidence=1)` / 总数。
- 提供 `fie stats` 输出上述指标，作为阈值调优反馈（回填 open question #3）。

### 5.5 MVP 边界
- 必做：`focus_events` 表、reassign/confirm/drop CLI、修正率统计。
- 后置：把修正数据回灌成 per-focus 学习到的关键词/路径权重（自动学习）。

---

## 5b. D5 方案：per-source 隐私粒度

> 状态：已落地（2026-07-08）。

### 目标
在全局 `privacyMode` 之外，允许按事件来源覆盖隐私模式，兑现 open question #5 的刚需（如 `ci` 用 `metadata`、本地 `agent` 用 `local_raw`）。

### 配置形态
`.env` 新增 `FIE_PRIVACY_BY_SOURCE`，值为 JSON 映射 `source → metadata|summary|local_raw`（如 `{"ci":"metadata","agent":"local_raw"}`）。Zod 校验：非法 JSON 或非法 privacyMode 值直接报错，不静默降级。缺省为 `{}`。

### 生效规则
`resolvePrivacyMode(config, source)`：命中 per-source 覆盖用覆盖值，否则回退全局 `privacyMode`。覆盖可比全局更宽或更严，**按配置直接生效**（产品决策：本地单用户场景配置即信任）。`ingestEvent` 在脱敏前调用它解析实际模式。

### 边界
- 覆盖粒度到 `source`（协议字段），不细分到 sourceEventId。
- 不影响幂等、可解释、run 可追溯等铁律；脱敏仍统一经 redaction 层。

---

## 6. 交付顺序建议

1. 先做第 2 节的幂等迁移通道（后续所有变更依赖它）。
2. D2 路径匹配（立即提升归因质量，风险低，独立可测）。
3. D1 双阈值 + status 字段 + 手动 merge/archive（依赖 D2 重标定阈值）。
4. D3 反馈表 + CLI + stats（依赖 D1 的 low_confidence）。

每步单独加回归测试：路径匹配打分、双阈值分档、reassign 后指针与 paths_json 一致性、修正率统计正确性。

## 7. 未决问题（需产品拍板）

- `T_match` / `T_create` 默认值：接入路径维度后重新校准，建议进配置。
- dormant/archive 的天数阈值默认值。
- reassign 是否允许跨 project；merge 是否允许把 active 合进 dormant。
- 这些取值直接对应 open question #3，建议用真实事件样本跑一轮校准后定稿。
