import type { Db } from '../db/index.js';
import {
  appendCheckin,
  createFocusWithCheckin,
  createIngestionRun,
  insertAttentionEvent,
  listFocusCandidates,
  markRunFailed,
  updateRunDecision,
} from '../db/repository.js';
import { decideFocusAction } from '../decision/decision-engine.js';
import { extractEventSignal } from '../extraction/rule-extractor.js';
import { matchFocuses } from '../matching/focus-matcher.js';
import { redactEvent } from '../redaction/redact.js';
import { extractPaths } from '../shared/paths.js';
import type { AppConfig } from '../config.js';
import type { AttentionEventInput, IngestResult } from '../shared/types.js';

export function ingestEvent(db: Db, config: AppConfig, event: AttentionEventInput): IngestResult {
  const redacted = redactEvent(event, config.privacyMode);
  const inserted = insertAttentionEvent(db, {
    event,
    redactedSummary: redacted.summary,
    redactedContent: redacted.content,
    redactedMetadata: redacted.metadata,
  });

  const runId = createIngestionRun(db, inserted.id, inserted.duplicate ? 'duplicate' : 'processing');
  if (inserted.duplicate) {
    return {
      status: 'duplicate',
      deduplicated: true,
      decision: null,
      focusId: null,
      runId,
      reason: 'source + sourceEventId 已存在，跳过重复处理',
    };
  }

  try {
    return db.transaction((): IngestResult => {
      const extraction = extractEventSignal(event, redacted.summary);
      const eventPaths = extractPaths(redacted.metadata);
      const candidates = matchFocuses(event, extraction, eventPaths, listFocusCandidates(db));
      const decision = decideFocusAction(extraction, candidates, { tMatch: config.tMatch, tCreate: config.tCreate });

      let focusId = decision.focusId;
      if (decision.decision === 'create_and_check_in') {
        focusId = createFocusWithCheckin(db, runId, event, extraction, eventPaths);
      } else if (decision.decision === 'check_in' && decision.focusId) {
        appendCheckin(db, decision.focusId, runId, event, extraction, eventPaths, decision.lowConfidence);
      }

      updateRunDecision(db, runId, { ...decision, focusId });

      return {
        status: 'accepted',
        deduplicated: false,
        decision: decision.decision,
        focusId,
        runId,
        reason: decision.reason,
        lowConfidence: decision.lowConfidence,
      };
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markRunFailed(db, runId, message);
    throw error;
  }
}
