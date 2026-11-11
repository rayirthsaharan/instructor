import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postDocument } from '@/app/api/documents/route';
import { GET as getDoc } from '@/app/api/documents/[id]/route';
import { failureMessage } from '@/lib/client/messages';
import { createTestApp, fixture, TestClient, uploadForm, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(() => {
  app = createTestApp();
});
afterEach(() => app.close());

describe('M1 integration: server status vs. UI failure copy', () => {
  it('the first terminal failure of an analysis the user has never retried must still offer "Try again"', async () => {
    const c = new TestClient();
    const up = await c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm({ data: fixture('mock-failure.pdf') }) });
    const { documentId } = await up.json();
    await app.drain();
    const st = await (await c.call(getDoc, '/x', {}, { id: documentId })).json();
    expect(st.status).toBe('failed');
    const f = failureMessage(st.stage, st.error?.code, st.attempts);
    // DEFECT: `attempts` counts the server's own automatic attempts (3 already), so the UI shows the
    // "still not working" copy and hides Try again on the user's first visible failure.
    expect(f.retryAllowed, `attempts=${st.attempts}`).toBe(true);
    expect(f.message).not.toContain("still not working");
  });
});
