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
}

export type NewMessage = Omit<MessageRecord, 'guideId'>;

/** The newest messages kept per guide; older ones are deleted when new ones are stored. */
export const MAX_STORED_MESSAGES = 200;

/** `citations_json` holds `{ citations, notInManual }`, so no migration is needed for the extra flag. Old rows may carry a retired `note`, which is ignored. */
function encodeMeta(m: NewMessage): string {
  return JSON.stringify({ citations: m.citations, notInManual: m.notInManual });
}

function decodeMeta(raw: string | null): Pick<MessageRecord, 'citations' | 'notInManual'> {
  const empty = { citations: [], notInManual: false };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<Pick<MessageRecord, 'citations' | 'notInManual'>> | null;
    if (!v || typeof v !== 'object') return empty;
    return {
      citations: Array.isArray(v.citations) ? v.citations : [],
      notInManual: v.notInManual === true,
    };
  } catch {
    return empty;
  }
}

/** Stores a question and its answer together, in order, or neither. Keeps only the newest `MAX_STORED_MESSAGES` of the guide. */
export async function insertMessages(db: Db, guideId: string, analysisId: string, rows: NewMessage[]): Promise<void> {
  unwrap(db).transaction((tx) => {
    for (const m of rows) {
      tx.insert(messages).values({
        id: m.id, guideId, analysisId, stepId: m.stepId, role: m.role, content: m.text, citationsJson: encodeMeta(m), createdAt: m.createdAt,
      }).run();
    }
    tx.run(sql`DELETE FROM messages WHERE guide_id = ${guideId} AND rowid NOT IN (
      SELECT rowid FROM messages WHERE guide_id = ${guideId} ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_STORED_MESSAGES})`);
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
