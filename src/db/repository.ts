import type { Db } from './index.js';
import type { AttentionEventInput, DecisionResult, ExtractionResult } from '../shared/types.js';
import { createId, nowIso } from '../shared/id.js';

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

export function createIngestionRun(db: Db, eventId: string, status: 'accepted' | 'duplicate' | 'failed'): string {
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

export function listFocusCandidates(db: Db): Array<{ id: string; name: string; project: string | null; keywords: string[]; lastActivityAt: string }> {
  const rows = db.prepare('SELECT id, name, project, keywords_json, last_activity_at FROM focuses ORDER BY last_activity_at DESC LIMIT 50').all() as Array<{
    id: string;
    name: string;
    project: string | null;
    keywords_json: string;
    last_activity_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    project: row.project,
    keywords: JSON.parse(row.keywords_json) as string[],
    lastActivityAt: row.last_activity_at,
  }));
}

export function createFocusWithCheckin(db: Db, runId: string, event: AttentionEventInput, extraction: ExtractionResult): string {
  const timestamp = nowIso();
  const focusId = createId('focus');
  const name = extraction.topic || event.project || event.type;
  const keywords = extraction.keywords.length > 0 ? extraction.keywords : [event.type];

  db.prepare(`
    INSERT INTO focuses (id, name, project, keywords_json, last_activity_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(focusId, name, event.project || null, JSON.stringify(keywords), timestamp, timestamp, timestamp);

  insertCheckin(db, focusId, runId, event, extraction);
  return focusId;
}

export function appendCheckin(db: Db, focusId: string, runId: string, event: AttentionEventInput, extraction: ExtractionResult): void {
  insertCheckin(db, focusId, runId, event, extraction);
  db.prepare('UPDATE focuses SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), focusId);
}

function insertCheckin(db: Db, focusId: string, runId: string, event: AttentionEventInput, extraction: ExtractionResult): void {
  const checkinId = createId('chk');
  db.prepare(`
    INSERT INTO focus_checkins (id, focus_id, run_id, notes, blocker, next_action, source, source_event_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkinId,
    focusId,
    runId,
    extraction.progress || event.summary || event.type,
    extraction.blocker,
    extraction.nextAction,
    event.source,
    event.sourceEventId,
    nowIso(),
  );
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
  weight: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export function listFocusRows(db: Db, limit: number): FocusRow[] {
  const rows = db.prepare(`
    SELECT id, name, project, keywords_json, weight, last_activity_at, created_at, updated_at
    FROM focuses
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(limit) as Array<Omit<FocusRow, 'keywords'> & { keywords_json: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    project: row.project,
    keywords: JSON.parse(row.keywords_json) as string[],
    weight: row.weight,
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
