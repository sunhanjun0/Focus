# Focus Ingestion Engine

Focus Ingestion Engine（FIE）是一个本地注意力摄取与焦点归因引擎。它接收 Agent、CLI、Git、自动化系统等来源的事件，经过幂等、脱敏、提取、匹配和决策后，将实质关注信号归并为 Focus 与 check-in。

## 核心能力

- **单向摄取流水线**：脱敏 → 幂等写入 → 提取信号 → 匹配候选 Focus → 决策 → 写 Focus/check-in，全程可解释、run 可追溯。
- **跨工具归因**：基于项目名、关键词、**文件路径**（完整/目录/文件名分级）与活跃度打分，把改同一批文件的不同来源事件收敛到同一 Focus。
- **双阈值收敛**：分数 `>= T_match` 高置信 check-in；`[T_create, T_match)` 归入最高候选并标 `low_confidence` 进复核；`< T_create` 才新建，抑制碎片化。
- **Focus 生命周期**：`active/dormant/archived/merged` 状态，支持手动 merge/archive 与 dormant 衰减 sweep。
- **纠正闭环**：`reassign/confirm/drop` 纠正归因，写审计（原始记录不物理删），`stats` 输出修正率与低置信占比。
- **时间序模型**：归因、活跃度、趋势一律基于事件 `occurredAt`，支持乱序与历史回填；`trend` 按日聚合活跃度。
- **隐私优先**：默认脱敏摘要，支持 `metadata/summary/local_raw` 三档与 per-source 覆盖；任何输出/日志都经统一 redaction 层。

## 本地开发

```bash
npm install
npm run dev
npm test
npm run build
```

默认服务地址为 `http://127.0.0.1:17879`。配置项见 `.env.example`。

## 容器化运行

```bash
docker compose build
docker compose up -d
curl http://127.0.0.1:17879/health
```

容器默认监听 `0.0.0.0:17879`，数据库和日志写入 `/data` 卷。

## 摄取事件

启动服务后调用：

```bash
curl -X POST http://127.0.0.1:17879/v1/events/ingest \
  -H 'content-type: application/json' \
  --data @samples/codex-event.json

curl -X POST http://127.0.0.1:17879/v1/events/batch \
  -H 'content-type: application/json' \
  --data @samples/batch-events.json
```

## CLI

```bash
# 摄取与查看
npm run cli -- ingest samples/codex-event.json
npm run cli -- runs tail
npm run cli -- runs show <runId>
npm run cli -- focus list [--all]
npm run cli -- export jsonl --output exports/checkins.jsonl

# Focus 生命周期
npm run cli -- focus merge <fromId> <intoId>
npm run cli -- focus archive <focusId>
npm run cli -- focus sweep

# 纠正闭环与质量指标
npm run cli -- checkin reassign <checkinId> <focusId>
npm run cli -- checkin confirm <checkinId>
npm run cli -- checkin drop <checkinId>
npm run cli -- stats
npm run cli -- trend --days 30
```

## 查询结果

```bash
curl http://127.0.0.1:17879/v1/runs?limit=10
curl http://127.0.0.1:17879/v1/runs/{runId}
curl http://127.0.0.1:17879/v1/focuses?limit=10
curl "http://127.0.0.1:17879/v1/trend?days=30"
```

## 阈值校准

用真实摄取流水线对候选阈值重放语料，辅助选定 `T_match`/`T_create` 默认值（方法见 `docs/design-review-notes.md §7a`）：

```bash
npm run calibrate -- samples/calibration-corpus.json [--tmatch 40,50,60] [--tcreate 20,25,30]
```

## Adapter 示例

```bash
node scripts/adapters/ci-webhook-example.mjs
node scripts/adapters/git-hook-example.mjs
```

这些脚本只演示标准事件生成和 HTTP 发送方式，不包含任何特定下游系统逻辑。

## 规划中（尚未实现）

`update_metadata` 决策、Focus 层级关系（D4，见 `docs/design-review-notes.md §5c`）、push 输出与失败重试状态机、MCP/SDK 入口。

## 项目文档

- `docs/project-constraints.md`：项目约束准则，定义铁律和模块边界。
- `docs/development-guide.md`：开发文档，说明技术栈、接口、数据模型和测试重点。
- `docs/product-design.md`：产品设计书，说明目标用户、MVP 范围和设计基准（含 D1–D8）。
- `docs/design-review-notes.md`：设计评审与缺口方案（D1–D8）、阈值校准方法与 D4 需求验证。
- `docs/adapters.md`：通用 Adapter 接入说明，面向 webhook、CLI、自动化和下游输出。
- `docs/protocol.md`：通用协议，说明事件格式、批量摄取、错误码和 JSONL 导出。
