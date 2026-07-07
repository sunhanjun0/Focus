# Repository Guidelines

## 项目结构与模块组织

本仓库已进入实现阶段，`src/` 下是 Focus Ingestion Engine 的 TypeScript 实现，`tests/` 是 Vitest 测试，`docs/` 是设计与约束基准。根目录 `focus-ingestion-engine-independent-app-proposal.md` 是最初方案存档，产品设计以 `docs/product-design.md` 为准。

开始开发或修改前，先阅读 `docs/project-constraints.md`、`docs/product-design.md` 和 `docs/development-guide.md`。其中 `docs/project-constraints.md` 是项目约束准则，优先级高于临时实现便利；`docs/design-review-notes.md` 与 `docs/code-review-notes.md` 记录设计方案与实现待办。

现有代码结构：`src/server/` HTTP 路由，`src/db/` schema 与仓库层，`src/ingestion/` 事件摄取与幂等，`src/redaction/` 脱敏，`src/extraction/` 规则提取，`src/matching/` Focus 匹配，`src/decision/` 决策引擎，`src/outputs/` 输出适配器，`src/cli/` 命令行入口，`src/shared/` 类型与工具。`src/mcp/`（MCP 工具）为规划中，尚未实现。

## 构建、测试与开发命令

当前已提供 Node.js + TypeScript 项目脚本：

- `npm install`：安装本地依赖。
- `npm run dev`：启动本地摄取 HTTP 服务。
- `npm test`：运行 Vitest 测试。
- `npm run build`：用 `tsconfig.build.json` 只编译 `src/` 到 `dist/`（入口为 `dist/index.js`）。
- `npm run lint`：运行 ESLint。
- `npm run typecheck`：执行 TypeScript 类型检查。

仅修改文档时，建议使用：

- `git diff --check`：检查提交前的空白字符问题。
- `npx markdownlint-cli2 "**/*.md"`：在可用 Node 环境中检查 Markdown 格式。

## 编码风格与命名约定

本仓库的文档、注释、提交说明和开发讨论统一使用中文；代码标识、协议字段、命令和第三方 API 名称保持英文原文。Markdown 使用简洁段落、清晰标题，并为代码块标注语言，例如 `text`、`json`、`ts`。扩展现有方案时，保留其编号章节风格。文档文件名优先使用描述性的 kebab-case，例如 `adapter-security-notes.md`。

未来 TypeScript 代码使用 2 空格缩进、kebab-case 文件名、命名导出，并让模块名与架构职责对应，例如 `focus-matcher.ts`、`ingest-event.ts`。

## 测试规范

测试位于 `tests/`，使用 Vitest 和 `*.test.ts` 命名（如 `ingestion.test.ts`、`extractor.test.ts`、`redaction.test.ts`、`http.test.ts`）。核心链路必须有覆盖：事件 schema 校验、幂等去重、redaction 脱敏、trivial/substantive 判定、Focus 候选排序（含文件路径维度）、双阈值决策与 reason 保存、纠正闭环（reassign/merge/archive）、以及输出适配器失败后的 run 状态。没有测试覆盖时不要重构核心决策逻辑；修复 bug 时优先补回归测试。

## 提交与 Pull Request 规范

提交请使用简短、祈使句风格的 Conventional Commit 信息，并优先使用中文描述，例如 `docs: 补充适配器隐私说明`、`feat: 初始化摄取 API`。

Pull Request 应包含简明摘要、影响到的章节或模块、已执行的验证，以及相关 issue 或决策背景。只有涉及 UI 或渲染效果变化时，才需要附截图。

## 安全与配置提示

不要提交密钥、本地数据库、原始注意力日志或 `.env` 文件；`.env.example` 只放占位符，不放真实 endpoint、token 或部署路径。隐私保护、脱敏和数据边界是本项目的核心要求，不应作为后续可选优化处理。隐私模式支持按来源覆盖全局默认（见 `docs/product-design.md` 第 13 节），新增 Adapter 时须说明其读取、保存和输出的数据。
