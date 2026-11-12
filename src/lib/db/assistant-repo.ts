import { and, desc, eq, sql } from 'drizzle-orm';
import { unwrap, type Db } from './client';
import { messages, simplifications } from './schema';

// Repository for the step-aware assistant: conversation messages and cached simplifications.

export interface StoredCitation {
  stepId?: string;
  pageIndex: number;
  region?: { x: number; y: number; w: number; h: number };
}

export interface MessageRecord {
  id: string;
  guideId: string;
  role: 'user' | 'assistant';
  text: string;
  stepId: string | null;
  createdAt: number;
  citations: StoredCitation[];
  notInManual: boolean;
  /** Server-side note, e.g. `no_citation` (an answer that could not be pointed at the manual). */
  note: string | null;
}

export type NewMessage = Omit<MessageRecord, 'guideId'>;

/** `citations_json` holds `{ citations, notInManual, note }`, so no migration is needed for the extra flags. */
function encodeMeta(m: NewMessage): string {
  return JSON.stringify({ citations: m.citations, notInManual: m.notInManual, note: m.note });
}

function decodeMeta(raw: string | null): Pick<MessageRecord, 'citations' | 'notInManual' | 'note'> {
  const empty = { citations: [], notInManual: false, note: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<Pick<MessageRecord, 'citations' | 'notInManual' | 'note'>> | null;
    if (!v || typeof v !== 'object') return empty;
    return {
      citations: Array.isArray(v.citations) ? v.citations : [],
      notInManual: v.notInManual === true,
      note: typeof v.note === 'string' ? v.note : null,
    };
  } catch {
    return empty;
  }
}

/** Stores a question and its answer together, in order, or neither. */
export async function insertMessages(db: Db, guideId: string, analysisId: string, rows: NewMessage[]): Promise<void> {
  unwrap(db).transaction((tx) => {
    for (const m of rows) {
      tx.insert(messages).values({
        id: m.id, guideId, analysisId, stepId: m.stepId, role: m.role, content: m.text, citationsJson: encodeMeta(m), createdAt: m.createdAt,
      }).run();
    }
  }, { behavior: 'immediate' });
}

/** The newest `limit` messages of a guide, oldest first. */
export async function listMessages(db: Db, guideId: string, limit: number): Promise<MessageRecord[]> {
  const rows = unwrap(db)
    .select()
    .from(messages)
    .where(eq(messages.guideId, guideId))
    .orderBy(desc(messages.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all();
  return rows.reverse().map((r) => ({
    id: r.id, guideId: r.guideId, role: r.role, text: r.content, stepId: r.stepId, createdAt: r.createdAt, ...decodeMeta(r.citationsJson),
  }));
}

export async function clearMessages(db: Db, guideId: string): Promise<number> {
  return unwrap(db).delete(messages).where(eq(messages.guideId, guideId)).run().changes;
}

export async function getSimplification(db: Db, analysisId: string, stepId: string, level: number): Promise<string | undefined> {
  return unwrap(db)
    .select({ text: simplifications.text })
    .from(simplifications)
    .where(and(eq(simplifications.analysisId, analysisId), eq(simplifications.stepId, stepId), eq(simplifications.level, level)))
    .get()?.text;
}

export async function saveSimplification(db: Db, analysisId: string, stepId: string, level: number, text: string): Promise<void> {
  unwrap(db).insert(simplifications).values({ analysisId, stepId, level, text }).onConflictDoNothing().run();
}
