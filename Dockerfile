# 构建阶段
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# 运行阶段
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
COPY public ./public

ENV FIE_HOST=0.0.0.0 \
    FIE_PORT=17879 \
    FIE_DB_PATH=/data/fie.sqlite \
    FIE_LOG_PATH=/data/logs/fie.jsonl \
    FIE_PRIVACY_MODE=summary

EXPOSE 17879
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
