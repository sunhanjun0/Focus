import type { Db } from './index.js';
import { nowIso } from '../shared/id.js';

export interface Migration {
  id: string;
  up: (db: Db) => void;
}

/**
 * 增量迁移列表，按 id 顺序执行。基础表由 schema.sql 建立；
 * 此处只放「在基础表之上的结构变更」（加列、加表、加索引）。
 * 每个 migration 的 up 必须可重复执行且自带存在性守卫，
 * 例如用 addColumn/columnExists，禁止裸 ALTER TABLE ADD COLUMN。
 */
export const migrations: Migration[] = [
  {
    // D2：为 Focus 与 check-in 增加文件路径信号列
    id: '0001_focus_paths',
    up: (db) => {
      addColumn(db, 'focuses', 'paths_json', "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'focus_checkins', 'paths_json', "TEXT NOT NULL DEFAULT '[]'");
    },
  },
  {
    // D1：Focus 生命周期字段
    id: '0002_focus_lifecycle',
    up: (db) => {
      addColumn(db, 'focuses', 'status', "TEXT NOT NULL DEFAULT 'active'");
      addColumn(db, 'focuses', 'merged_into', 'TEXT');
      addColumn(db, 'focuses', 'last_decayed_at', 'TEXT');
    },
  },
  {
    // D1：双阈值低置信标记（corrected 列留待 D3 纠正闭环）
    id: '0003_checkin_low_confidence',
    up: (db) => {
      addColumn(db, 'focus_checkins', 'low_confidence', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    // D1/D3：生命周期与纠正操作审计表（merge/archive 先用，reassign/confirm/drop 待 D3）
    id: '0004_focus_events',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS focus_events (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          checkin_id TEXT,
          from_focus_id TEXT,
          to_focus_id TEXT,
          actor TEXT NOT NULL DEFAULT 'user',
          reason TEXT,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    // D3：纠正闭环。corrected 标记 check-in 被 reassign/纠正过；
    // dropped 为软删除标记（误记录不物理删，用状态字段表达）。
    id: '0005_checkin_corrected',
    up: (db) => {
      addColumn(db, 'focus_checkins', 'corrected', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'focus_checkins', 'dropped', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
];

export function runMigrations(db: Db, list: Migration[] = migrations): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of list) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, nowIso());
    });
    apply();
  }
}

export function columnExists(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function addColumn(db: Db, table: string, column: string, definition: string): void {
  if (columnExists(db, table, column)) return;
  db.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} ${definition}`);
}

// 迁移中的表名、列名均来自内部常量，非用户输入；此处仅做标识符防御性转义。
function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`非法 SQL 标识符：${identifier}`);
  }
  return identifier;
}
