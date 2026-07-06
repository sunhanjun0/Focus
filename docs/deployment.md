# 部署说明

## 1. 部署目标

本项目计划部署到树莓派环境。远程部署由 OpenClaw Agent 执行：本项目向 OpenClaw Chat Completions 接口发送一段任务提示，具体操作由远程 Agent 根据提示完成。仓库只保存调用脚本和配置说明，不保存任何真实 API Token。

## 1.1 容器化

仓库提供 `Dockerfile` 和 `docker-compose.yml`，供树莓派用 `docker compose up -d --build` 构建运行。

- 镜像分两阶段：构建阶段编译 TypeScript，运行阶段只装生产依赖。
- 容器内默认 `FIE_HOST=0.0.0.0`、`FIE_PORT=17879`。
- 数据库和日志写入 `/data` 卷，对应 compose 中的 `fie-data`，保证重建容器不丢数据。
- compose 内置 `/health` 健康检查。

本地构建命令：

```bash
docker compose build
docker compose up -d
curl http://127.0.0.1:17879/health
```

如果 `docker compose build` 报基础镜像 403 或超时，通常是本机 Docker 镜像加速器无法访问 `node:22-bookworm-slim`，与本仓库无关。可在 Docker 设置中调整或移除 registry mirror 后重试；树莓派侧确保能访问镜像源即可。

## 2. OpenClaw 配置

本地环境变量：

```bash
export OPENCLAW_ENDPOINT="https://congrong.online:18789/v1/chat/completions"
read -rsp "OpenClaw token: " OPENCLAW_API_TOKEN
export OPENCLAW_API_TOKEN
export OPENCLAW_MODEL="openclaw/default"
export OPENCLAW_USER="focus-deploy"
export OPENCLAW_TASK_PROMPT="在树莓派上部署 Focus Ingestion Engine：进入 /home/hanjun/focus，拉取 main 最新代码，并用 docker compose 重新构建和启动服务。部署后检查服务是否正常运行。"
```

`OPENCLAW_API_TOKEN` 不得写入 `.env.example`、文档正文、源码或测试快照。

## 3. Dry Run

部署前先检查请求内容：

```bash
npm run deploy:dry-run
```

该命令只打印 endpoint 和 payload，不发送请求，也不需要 token。

## 4. 执行部署

确认任务提示无误后执行：

```bash
export OPENCLAW_API_TOKEN
npm run deploy:openclaw
```

## 5. 自定义任务

OpenClaw 对端是 Agent，因此部署入口支持灵活任务提示，而不是固定命令执行器。

临时传入一段提示：

```bash
npm run deploy:openclaw -- --prompt "在树莓派上检查 /home/hanjun/focus 的服务状态，并返回 docker compose ps 和最近日志摘要。"
```

从文件读取提示：

```bash
npm run deploy:openclaw -- --prompt-file ./deploy-task.txt
```

也可以使用环境变量：

```bash
OPENCLAW_TASK_PROMPT="在树莓派上部署项目并检查健康状态。" npm run deploy:openclaw
```

兼容旧变量：如果设置了 `FIE_DEPLOY_COMMAND` 且没有设置 `OPENCLAW_TASK_PROMPT`，脚本会把它包装成“在树莓派上部署项目: ...”发送给 Agent。

## 6. 安全要求

- 不在仓库中保存真实 token。
- 部署前先执行本地验证：`npm run typecheck && npm test && npm run build && npm run lint`。
- 任务提示应描述目标、路径、分支、验证方式和期望返回内容。
- 避免让远程 Agent 执行破坏性或不可回滚操作，除非提示中明确说明风险和备份方式。
- 如果 OpenClaw 返回失败，保留响应文本用于排查，但不要把 token 或完整认证头贴入日志。
