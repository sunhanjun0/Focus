import type { Db } from './index.js';
import type { AttentionEventInput, DecisionResult, ExtractionResult } from '../shared/types.js';
import { createId, nowIso } from '../shared/id.js';
import { mergePaths } from '../shared/paths.js';

export interface InsertEventInput {
  event: AttentionEventInput;
  redactedSummary: string | null;
  redactedContent: string | null;
  redactedMetadata: Record<string, unknown>;
}

export interface InsertEventResult {
  id: string;
  duplicate: boolean;
}

export function insertAttentionEvent(db: Db, input: InsertEventInput): InsertEventResult {
  const existing = db.prepare('SELECT id FROM attention_events WHERE source = ? AND source_event_id = ?')
    .get(input.event.source, input.event.sourceEventId) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };

  const id = createId('evt');
  db.prepare(`
    INSERT INTO attention_events (
      id, source, source_event_id, occurred_at, type, project, summary, content,
      metadata_json, redacted_summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.event.source,
    input.event.sourceEventId,
    input.event.occurredAt,
    input.event.type,
    input.event.project || null,
    input.redactedSummary,
    input.redactedContent,
    JSON.stringify(input.redactedMetadata),
    input.redactedSummary,
    nowIso(),
  );
  return { id, duplicate: false };
}

export function createIngestionRun(db: Db, eventId: string, status: 'processing' | 'duplicate'): string {
  const id = createId('run');
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO ingestion_runs (id, event_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, eventId, status, timestamp, timestamp);
  return id;
}

export function updateRunDecision(db: Db, runId: string, decision: DecisionResult): void {
  db.prepare(`
    UPDATE ingestion_runs
    SET status = 'accepted', decision = ?, reason = ?, candidates_json = ?, updated_at = ?
    WHERE id = ?
  `).run(decision.decision, decision.reason, JSON.stringify(decision.candidates), nowIso(), runId);
}

export function markRunFailed(db: Db, runId: string, error: string): void {
  db.prepare(`
    UPDATE ingestion_runs
    SET status = 'failed', error = ?, updated_at = ?
    WHERE id = ?
  `).run(error.slice(0, 500), nowIso(), runId);
}

export function listFocusCandidates(db: Db): Array<{ id: string; name: string; project: string | null; keywords: string[]; paths: string[]; lastActivityAt: string }> {
  const rows = db.prepare(`
    SELECT id, name, project, keywords_json, paths_json, last_activity_at
    FROM focuses
    WHERE status IN ('active', 'dormant')
    ORDER BY last_activity_at DESC
    LIMIT 50
  `).all() as Array<{
    id: string;
    name: string;
    project: string | null;
    keywords_json: string;
    paths_json: string;
    last_activity_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    project: row.project,
    keywords: JSON.parse(row.keywords_json) as string[],
    paths: JSON.parse(row.paths_json) as string[],
    lastActivityAt: row.last_activity_at,
  }));
}

export function createFocusWithCheckin(db: Db, runId: string, event: AttentionEventInput, extraction: ExtractionResult, paths: string[]): string {
  const timestamp = nowIso();
  const focusId = createId('focus');
  const name = extraction.topic || event.project || event.type;
  const keywords = extraction.keywords.length > 0 ? extraction.keywords : [event.type];

  db.prepare(`
    INSERT INTO focuses (id, name, project, keywords_json, paths_json, last_activity_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(focusId, name, event.project || null, JSON.stringify(keywords), JSON.stringify(paths), timestamp, timestamp, timestamp);

  insertCheckin(db, focusId, runId, event, extraction, paths, false);
  return focusId;
}

export function appendCheckin(db: Db, focusId: string, runId: string, event: AttentionEventInput, extraction: ExtractionResult, paths: string[], lowConfidence: boolean): void {
  insertCheckin(db, focusId, runId, event, extraction, paths, lowConfidence);
  const row = db.prepare('SELECT paths_json FROM focuses WHERE id = ?').get(focusId) as { paths_json: string } | undefined;
  const existing = row ? (JSON.parse(row.paths_json) as string[]) : [];
  const merged = mergePaths(existing, paths);
  const timestamp = nowIso();
  db.prepare('UPDATE focuses SET last_activity_at = ?, updated_at = ?, paths_json = ? WHERE id = ?')
    .run(timestamp, timestamp, JSON.stringify(merged), focusId);
}

function insertCheckin(db: Db, focusId: string, runId: string, event: AttentionEventInput, extraction: ExtractionResult, paths: string[], lowConfidence: boolean): void {
  const checkinId = createId('chk');
  db.prepare(`
    INSERT INTO focus_checkins (id, focus_id, run_id, notes, blocker, next_action, source, source_event_id, paths_json, low_confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkinId,
    focusId,
    runId,
    extraction.progress || event.summary || event.type,
    extraction.blocker,
    extraction.nextAction,
    event.source,
    event.sourceEventId,
    JSON.stringify(paths),
    lowConfidence ? 1 : 0,
    nowIso(),
  );
}

export interface FocusEventInput {
  kind: 'reassign' | 'merge' | 'archive' | 'delete_checkin' | 'confirm';
  checkinId?: string | null;
  fromFocusId?: string | null;
  toFocusId?: string | null;
  actor?: string;
  reason?: string | null;
}

export function insertFocusEvent(db: Db, input: FocusEventInput): string {
  const id = createId('fev');
  db.prepare(`
    INSERT INTO focus_events (id, kind, checkin_id, from_focus_id, to_focus_id, actor, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.kind,
    input.checkinId ?? null,
    input.fromFocusId ?? null,
    input.toFocusId ?? null,
    input.actor ?? 'user',
    input.reason ?? null,
    nowIso(),
  );
  return id;
}

export function archiveFocus(db: Db, focusId: string, reason?: string): boolean {
  const run = db.transaction((): boolean => {
    const focus = db.prepare('SELECT id FROM focuses WHERE id = ?').get(focusId) as { id: string } | undefined;
    if (!focus) return false;
    db.prepare("UPDATE focuses SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), focusId);
    insertFocusEvent(db, { kind: 'archive', fromFocusId: focusId, reason: reason ?? null });
    return true;
  });
  return run();
}

export function mergeFocuses(db: Db, fromId: string, intoId: string, reason?: string): boolean {
  const run = db.transaction((): boolean => {
    if (fromId === intoId) return false;
    const from = db.prepare('SELECT id, keywords_json, paths_json, last_activity_at FROM focuses WHERE id = ?').get(fromId) as
      | { id: string; keywords_json: string; paths_json: string; last_activity_at: string }
      | undefined;
    const into = db.prepare('SELECT id, keywords_json, paths_json, last_activity_at FROM focuses WHERE id = ?').get(intoId) as
      | { id: string; keywords_json: string; paths_json: string; last_activity_at: string }
      | undefined;
    if (!from || !into) return false;

    // check-in 指针改指目标 Focus
    db.prepare('UPDATE focus_checkins SET focus_id = ? WHERE focus_id = ?').run(intoId, fromId);

    const mergedKeywords = Array.from(
      new Set([...(JSON.parse(into.keywords_json) as string[]), ...(JSON.parse(from.keywords_json) as string[])]),
    );
    const mergedPaths = mergePaths(JSON.parse(into.paths_json) as string[], JSON.parse(from.paths_json) as string[]);
    const lastActivity = from.last_activity_at > into.last_activity_at ? from.last_activity_at : into.last_activity_at;
    const timestamp = nowIso();
    db.prepare('UPDATE focuses SET keywords_json = ?, paths_json = ?, last_activity_at = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(mergedKeywords), JSON.stringify(mergedPaths), lastActivity, timestamp, intoId);

    db.prepare("UPDATE focuses SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?")
      .run(intoId, timestamp, fromId);

    insertFocusEvent(db, { kind: 'merge', fromFocusId: fromId, toFocusId: intoId, reason: reason ?? null });
    return true;
  });
  return run();
}

export function sweepDormantFocuses(db: Db, dormantDays: number): number {
  const cutoff = new Date(Date.now() - dormantDays * 24 * 60 * 60 * 1000).toISOString();
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE focuses
    SET status = 'dormant', last_decayed_at = ?, updated_at = ?
    WHERE status = 'active' AND last_activity_at < ?
  `).run(timestamp, timestamp, cutoff);
  return result.changes;
}

export interface ExportableCheckinRow {
  checkin_id: string;
  focus_id: string;
  focus_name: string;
  run_id: string;
  event_id: string;
  source: string;
  source_event_id: string;
  event_type: string;
  project: string | null;
  notes: string;
  blocker: string | null;
  next_action: string | null;
  decision_reason: string | null;
  created_at: string;
}

export function listExportableCheckins(db: Db, limit: number): ExportableCheckinRow[] {
  return db.prepare(`
    SELECT
      fc.id AS checkin_id,
      f.id AS focus_id,
      f.name AS focus_name,
      ir.id AS run_id,
      ae.id AS event_id,
      ae.source AS source,
      ae.source_event_id AS source_event_id,
      ae.type AS event_type,
      ae.project AS project,
      fc.notes AS notes,
      fc.blocker AS blocker,
      fc.next_action AS next_action,
      ir.reason AS decision_reason,
      fc.created_at AS created_at
    FROM focus_checkins fc
    JOIN focuses f ON f.id = fc.focus_id
    JOIN ingestion_runs ir ON ir.id = fc.run_id
    JOIN attention_events ae ON ae.id = ir.event_id
    ORDER BY fc.created_at DESC
    LIMIT ?
  `).all(limit) as ExportableCheckinRow[];
}

export interface RunRow {
  id: string;
  status: string;
  decision: string | null;
  reason: string | null;
  source: string;
  source_event_id: string;
  event_type: string;
  created_at: string;
}

export function listRuns(db: Db, limit: number): RunRow[] {
  return db.prepare(`
    SELECT
      ir.id,
      ir.status,
      ir.decision,
      ir.reason,
      ae.source,
      ae.source_event_id,
      ae.type AS event_type,
      ir.created_at
    FROM ingestion_runs ir
    JOIN attention_events ae ON ae.id = ir.event_id
    ORDER BY ir.created_at DESC
    LIMIT ?
  `).all(limit) as RunRow[];
}

export interface FocusRow {
  id: string;
  name: string;
  project: string | null;
  keywords: string[];
  status: string;
  merged_into: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export function listFocusRows(db: Db, limit: number, options: { includeArchived?: boolean } = {}): FocusRow[] {
  const whereClause = options.includeArchived ? '' : "WHERE status IN ('active', 'dormant')";
  const rows = db.prepare(`
    SELECT id, name, project, keywords_json, status, merged_into, last_activity_at, created_at, updated_at
    FROM focuses
    ${whereClause}
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(limit) as Array<Omit<FocusRow, 'keywords'> & { keywords_json: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    project: row.project,
    keywords: JSON.parse(row.keywords_json) as string[],
    status: row.status,
    merged_into: row.merged_into,
    last_activity_at: row.last_activity_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export interface RunDetail {
  id: string;
  status: string;
  decision: string | null;
  reason: string | null;
  candidates: unknown[];
  error: string | null;
  created_at: string;
  updated_at: string;
  event: {
    id: string;
    source: string;
    sourceEventId: string;
    occurredAt: string;
    type: string;
    project: string | null;
    summary: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  };
  checkin: {
    id: string;
    notes: string;
    blocker: string | null;
    nextAction: string | null;
    createdAt: string;
    focus: {
      id: string;
      name: string;
      project: string | null;
    };
  } | null;
}

type RunDetailRow = {
  id: string;
  status: string;
  decision: string | null;
  reason: string | null;
  candidates_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  event_id: string;
  source: string;
  source_event_id: string;
  occurred_at: string;
  event_type: string;
  project: string | null;
  redacted_summary: string | null;
  metadata_json: string;
  event_created_at: string;
  checkin_id: string | null;
  notes: string | null;
  blocker: string | null;
  next_action: string | null;
  checkin_created_at: string | null;
  focus_id: string | null;
  focus_name: string | null;
  focus_project: string | null;
};

export function getRunDetail(db: Db, runId: string): RunDetail | null {
  const row = db.prepare(`
    SELECT
      ir.id, ir.status, ir.decision, ir.reason, ir.candidates_json, ir.error, ir.created_at, ir.updated_at,
      ae.id AS event_id, ae.source, ae.source_event_id, ae.occurred_at, ae.type AS event_type,
      ae.project, ae.redacted_summary, ae.metadata_json, ae.created_at AS event_created_at,
      fc.id AS checkin_id, fc.notes, fc.blocker, fc.next_action, fc.created_at AS checkin_created_at,
      f.id AS focus_id, f.name AS focus_name, f.project AS focus_project
    FROM ingestion_runs ir
    JOIN attention_events ae ON ae.id = ir.event_id
    LEFT JOIN focus_checkins fc ON fc.run_id = ir.id
    LEFT JOIN focuses f ON f.id = fc.focus_id
    WHERE ir.id = ?
  `).get(runId) as RunDetailRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    decision: row.decision,
    reason: row.reason,
    candidates: JSON.parse(row.candidates_json) as unknown[],
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    event: {
      id: row.event_id,
      source: row.source,
      sourceEventId: row.source_event_id,
      occurredAt: row.occurred_at,
      type: row.event_type,
      project: row.project,
      summary: row.redacted_summary,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      createdAt: row.event_created_at,
    },
    checkin: mapCheckin(row),
  };
}

function mapCheckin(row: RunDetailRow): RunDetail['checkin'] {
  if (!row.checkin_id || !row.notes || !row.checkin_created_at || !row.focus_id || !row.focus_name) return null;
  return {
    id: row.checkin_id,
    notes: row.notes,
    blocker: row.blocker,
    nextAction: row.next_action,
    createdAt: row.checkin_created_at,
    focus: {
      id: row.focus_id,
      name: row.focus_name,
      project: row.focus_project,
    },
  };
}
