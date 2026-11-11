import { sqliteTable, text, integer, primaryKey, unique, index } from 'drizzle-orm/sqlite-core';

// Timestamps are epoch milliseconds (integer) to stay portable across databases.

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  contentHash: text('content_hash').notNull(),
  kind: text('kind', { enum: ['pdf', 'images'] }).notNull(),
  originalPath: text('original_path').notNull(),
  pageCount: integer('page_count'),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('documents_session_idx').on(t.sessionId), index('documents_hash_idx').on(t.contentHash)]);

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  index: integer('index').notNull(),
  imagePath: text('image_path').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
}, (t) => [unique('pages_doc_index').on(t.documentId, t.index)]);

// Immutable once written. Keyed by (content_hash, pipeline_version, provider).
// Mock-provider rows are never shared across sessions (enforced in the repository);
// photo-set analyses are scoped to ownerSessionId.
export const analyses = sqliteTable('analyses', {
  id: text('id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  pipelineVersion: text('pipeline_version').notNull(),
  provider: text('provider').notNull(),
  // '' = globally shareable (real-provider PDFs); otherwise the owning session id.
  ownerSessionId: text('owner_session_id').notNull().default(''),
  guideJson: text('guide_json').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  model: text('model'),
  createdAt: integer('created_at').notNull(),
}, (t) => [unique('analyses_key').on(t.contentHash, t.pipelineVersion, t.provider, t.ownerSessionId)]);

export const guides = sqliteTable('guides', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  analysisId: text('analysis_id').notNull().references(() => analyses.id),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('guides_session_idx').on(t.sessionId)]);

export const progress = sqliteTable('progress', {
  guideId: text('guide_id').primaryKey().references(() => guides.id),
  analysisId: text('analysis_id').notNull().references(() => analyses.id),
  currentStepId: text('current_step_id'),
  completedStepsJson: text('completed_steps_json').notNull().default('[]'),
  checklistJson: text('checklist_json').notNull().default('{}'),
  updatedAt: integer('updated_at').notNull(),
});

export const stepNotes = sqliteTable('step_notes', {
  guideId: text('guide_id').notNull().references(() => guides.id),
  analysisId: text('analysis_id').notNull().references(() => analyses.id),
  stepId: text('step_id').notNull(),
  note: text('note').notNull().default(''),
  bookmarked: integer('bookmarked', { mode: 'boolean' }).notNull().default(false),
}, (t) => [primaryKey({ columns: [t.guideId, t.stepId] })]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  guideId: text('guide_id').notNull().references(() => guides.id),
  analysisId: text('analysis_id').notNull().references(() => analyses.id),
  stepId: text('step_id'),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  citationsJson: text('citations_json'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('messages_guide_idx').on(t.guideId)]);

export const simplifications = sqliteTable('simplifications', {
  analysisId: text('analysis_id').notNull().references(() => analyses.id),
  stepId: text('step_id').notNull(),
  level: integer('level').notNull(),
  text: text('text').notNull(),
}, (t) => [primaryKey({ columns: [t.analysisId, t.stepId, t.level] })]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  documentId: text('document_id'),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull().default('{}'),
  status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull(),
  stage: text('stage'),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  error: text('error'),
  leaseUntil: integer('lease_until'),
  heartbeatAt: integer('heartbeat_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('jobs_claim_idx').on(t.status, t.leaseUntil)]);

// Saved result of each paid chunk so a resumed job never re-pays.
export const jobArtifacts = sqliteTable('job_artifacts', {
  jobId: text('job_id').notNull().references(() => jobs.id),
  key: text('key').notNull(),
  dataJson: text('data_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.jobId, t.key] })]);
