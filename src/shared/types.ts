export type PrivacyMode = 'metadata' | 'summary' | 'local_raw';

export interface AttentionEventInput {
  source: string;
  sourceEventId: string;
  occurredAt: string;
  type: string;
  project?: string;
  summary?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredAttentionEvent extends AttentionEventInput {
  id: string;
  redactedSummary: string | null;
  createdAt: string;
}

export interface IngestionRun {
  id: string;
  eventId: string;
  status: 'accepted' | 'duplicate' | 'failed';
  decision: DecisionType | null;
  reason: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DecisionType = 'skip' | 'check_in' | 'create_and_check_in' | 'update_metadata';

export interface ExtractionResult {
  substantive: boolean;
  topic: string | null;
  progress: string | null;
  blocker: string | null;
  nextAction: string | null;
  reason: string;
  keywords: string[];
}

export interface FocusCandidate {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface DecisionResult {
  decision: DecisionType;
  reason: string;
  focusId: string | null;
  focusName: string | null;
  candidates: FocusCandidate[];
}

export interface IngestResult {
  status: 'accepted' | 'duplicate';
  deduplicated: boolean;
  decision: DecisionType | null;
  focusId: string | null;
  runId: string;
  reason: string | null;
}
