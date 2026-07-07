import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { addColumn, columnExists, runMigrations, type Migration } from '../src/db/migrations.js';
import type { Db } from '../src/db/index.js';

function memoryDb(): Db {
  return new Database(':memory:') as unknown as Db;
}

describe('migration channel', () => {
  it('runMigrations 记录已应用迁移，重复执行只应用一次', () => {
    const db = memoryDb();
    let applied = 0;
    const list: Migration[] = [
      {
        id: '0001_create_demo',
        up: (d) => {
          d.exec('CREATE TABLE demo (id TEXT PRIMARY KEY)');
          applied += 1;
        },
      },
    ];

    runMigrations(db, list);
    runMigrations(db, list);

    expect(applied).toBe(1);
    const rows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['0001_create_demo']);
  });

  it('addColumn 幂等：列已存在时跳过，不抛错', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE focuses (id TEXT PRIMARY KEY)');

    expect(columnExists(db, 'focuses', 'status')).toBe(false);
    addColumn(db, 'focuses', 'status', "TEXT NOT NULL DEFAULT 'active'");
    expect(columnExists(db, 'focuses', 'status')).toBe(true);

    // 重复调用不应抛错
    expect(() => addColumn(db, 'focuses', 'status', "TEXT NOT NULL DEFAULT 'active'")).not.toThrow();
  });

  it('迁移失败时整条回滚，不写入 schema_migrations', () => {
    const db = memoryDb();
    const list: Migration[] = [
      {
        id: '0001_broken',
        up: (d) => {
          d.exec('CREATE TABLE broken (id TEXT PRIMARY KEY)');
          throw new Error('模拟迁移失败');
        },
      },
    ];

    expect(() => runMigrations(db, list)).toThrow('模拟迁移失败');
    const migrated = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
    expect(migrated.count).toBe(0);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='broken'").get();
    expect(table).toBeUndefined();
  });

  it('非法标识符被拒绝', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE focuses (id TEXT PRIMARY KEY)');
    expect(() => addColumn(db, 'focuses; DROP TABLE focuses', 'x', 'TEXT')).toThrow('非法 SQL 标识符');
  });
});
