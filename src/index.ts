import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createHttpServer } from './server/http.js';
import { createJsonlLogger } from './shared/logger.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const logger = createJsonlLogger(config.logPath);
const server = createHttpServer(db, config, logger);

await server.listen({ host: config.host, port: config.port });
logger.write('info', 'app', 'server_started', { host: config.host, port: config.port });
console.log(`FIE listening on http://${config.host}:${config.port}`);

// 优雅关闭：先停服务器，再冲刷日志流缓冲，避免退出时丢失缓冲中的日志行。
async function shutdown(signal: string): Promise<void> {
  logger.write('info', 'app', 'server_stopping', { signal });
  await server.close();
  await logger.close?.();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

