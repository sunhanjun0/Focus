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
