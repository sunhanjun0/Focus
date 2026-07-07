import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { migrations, runMigrations } from './migrations.js';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function applyMigrations(db: Db): void {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const fallbackSchemaPath = path.resolve('src/db/schema.sql');
  const schema = fs.readFileSync(fs.existsSync(schemaPath) ? schemaPath : fallbackSchemaPath, 'utf8');
  db.exec(schema);
  runMigrations(db, migrations);
}
