# Repository Guidelines

## 项目结构与模块组织

本仓库目前是 Focus Ingestion Engine 的方案与规划文档仓库。根目录下的 `focus-ingestion-engine-independent-app-proposal.md` 是产品定位、系统架构、数据模型、协议、隐私安全和 MVP 范围的主要依据。新增规划内容优先放在根目录 Markdown 文件中；当文档数量增加后，再迁移到 `docs/` 目录。

开始开发或修改方案前，先阅读 `docs/project-constraints.md`、`docs/development-guide.md` 和 `docs/product-design.md`。其中 `docs/project-constraints.md` 是项目约束准则，优先级高于临时实现便利。

如果开始实现代码，请遵循方案第 12 节建议结构：`src/` 存放 TypeScript 源码，`src/server/` 存放 HTTP 路由，`src/db/` 存放 schema 与迁移，`src/ingestion/` 存放事件摄取与脱敏逻辑，`src/extraction/` 存放规则或 LLM 提取逻辑，`src/matching/` 存放 Focus 匹配逻辑，`src/mcp/` 存放 MCP 工具，`src/cli/` 存放命令行入口，`tests/` 存放自动化测试。

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

当前没有测试套件。加入代码后，请把测试放在 `tests/` 下，并按模块或行为命名，例如 `ingestion.test.ts`、`extractor.test.ts`、`matcher.test.ts`。优先覆盖事件摄取幂等性、脱敏规则、提取决策、匹配评分，以及 MCP/HTTP 协议兼容性。

## 提交与 Pull Request 规范

本仓库尚无稳定提交历史。建立约定前，请使用简短、祈使句风格的 Conventional Commit 信息，并优先使用中文描述，例如 `docs: 补充适配器隐私说明`、`feat: 初始化摄取 API`。

Pull Request 应包含简明摘要、影响到的章节或模块、已执行的验证，以及相关 issue 或决策背景。只有涉及 UI 或渲染效果变化时，才需要附截图。

## 安全与配置提示

不要提交密钥、本地数据库、原始注意力日志或 `.env` 文件。开始实现后，使用 `.env.example` 记录必要配置。隐私保护、脱敏和数据边界是本项目的核心要求，不应作为后续可选优化处理。
