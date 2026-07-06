import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.js';
import { listExportableCheckins } from '../db/repository.js';

export interface JsonExportOptions {
  outputPath: string;
  limit: number;
}

export interface JsonExportResult {
  outputPath: string;
  count: number;
}

export function exportCheckinsToJsonl(db: Db, options: JsonExportOptions): JsonExportResult {
  const rows = listExportableCheckins(db, options.limit);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const lines = rows.map((row) => JSON.stringify({
    schemaVersion: 'fie.checkin.v1',
    checkinId: row.checkin_id,
    focus: {
      id: row.focus_id,
      name: row.focus_name,
    },
    runId: row.run_id,
    event: {
      id: row.event_id,
      source: row.source,
      sourceEventId: row.source_event_id,
      type: row.event_type,
      project: row.project,
    },
    notes: row.notes,
    blocker: row.blocker,
    nextAction: row.next_action,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
  }));
  fs.writeFileSync(options.outputPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  return { outputPath: options.outputPath, count: rows.length };
}
