import { STAGE_LABELS, stageRow } from './messages';
import type { DocumentState } from './types';

export type RowMarker = 'pending' | 'active' | 'done' | 'failed';
export interface Row {
  label: string;
  marker: RowMarker;
  detail: string | null;
}

export const DOUBLE_CHECK_DETAIL = 'Comparing numbers and part labels with the original';
export const SLOW_DETAIL = 'Still working - long manuals take longer.';

/**
 * Stage rows from the job's real state only: one row per stage the API reports.
 */
export function buildRows(doc: Pick<DocumentState, 'status' | 'stage' | 'pageCount' | 'pagesRendered'>, slow = false): Row[] {
  const rows: Row[] = STAGE_LABELS.map((label) => ({ label, marker: 'pending', detail: null }));
  const row = (i: number): Row => rows[i] ?? rows[0]!;
  if (doc.status === 'ready') {
    rows.forEach((r) => (r.marker = 'done'));
    return rows;
  }
  if (doc.status === 'queued') {
    row(0).detail = 'Waiting to start';
    return rows;
  }
  const at = stageRow(doc.stage);
  const bad = doc.status === 'failed';
  rows.forEach((r, i) => {
    if (i < at) r.marker = 'done';
    else if (i === at) r.marker = bad ? 'failed' : 'active';
  });
  if (doc.stage === 'render' || doc.stage === 'ingest' || doc.stage === null) {
    if (doc.pageCount && doc.pagesRendered && doc.pagesRendered > 0) {
      row(0).detail = `Page ${Math.min(doc.pagesRendered, doc.pageCount)} of ${doc.pageCount}`;
    }
  }
  if (!bad && doc.stage === 'verify') row(2).detail = DOUBLE_CHECK_DETAIL;
  if (!bad && slow) {
    const active = row(at);
    active.detail = active.detail ? `${active.detail}. ${SLOW_DETAIL}` : SLOW_DETAIL;
  }
  return rows;
}
