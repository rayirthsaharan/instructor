import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import sharp from 'sharp';

// Integrated QA of the M1 backend fixes, over real HTTP against the webServer started by playwright.config.ts.
const fx = (n: string) => readFileSync(join(process.cwd(), 'fixtures', n));
const BASE = 'http://localhost:3100';
const dbPath = join(tmpdir(), 'instructor-e2e', 'instructor.db');

async function client(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE });
}
const mp = (data: Buffer, name = 'f.bin') => ({ multipart: { files: { name, mimeType: 'application/octet-stream', buffer: data } } });
const sessionRows = () => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare('select count(*) as n from sessions').get() as { n: number }).n;
  } finally {
    db.close();
  }
};

test.describe('M1 backend over HTTP', () => {
  test('session cookie: name, attributes, first write only', async () => {
    const c = await client();
    const before = sessionRows();
    const r = await c.get('/api/guides');
    expect(r.status()).toBe(200);
    const setCookie = r.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/^instructor_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
    await c.get('/api/guides');
    expect(sessionRows()).toBe(before); // reads leave no row
    const up = await c.post('/api/documents', { multipart: { files: { name: 'a.pdf', mimeType: 'application/pdf', buffer: fx('not-a-manual.pdf') } } });
    expect(up.status()).toBe(201);
    expect(sessionRows()).toBe(before + 1);
    await c.dispose();
  });

  test('a cookieless failed upload leaves no session row', async () => {
    const c = await client();
    const before = sessionRows();
    const r = await c.post('/api/documents', mp(Buffer.from('not a file at all')));
    expect(r.status()).toBe(415);
    expect(sessionRows()).toBe(before);
    await c.dispose();
  });

  test('foreign Origin / cross-site non-GET is rejected, same-origin passes, GET unaffected', async () => {
    const c = await client();
    const bad = await c.post('/api/documents', { ...mp(Buffer.from('x')), headers: { Origin: 'https://evil.example' } });
    expect(bad.status()).toBe(403);
    expect((await bad.json()).error.code).toBe('forbidden');
    const site = await c.post('/api/documents', { ...mp(Buffer.from('x')), headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(site.status()).toBe(403);
    const nul = await c.post('/api/documents', { ...mp(Buffer.from('x')), headers: { Origin: 'null' } });
    expect(nul.status()).toBe(403);
    const del = await c.delete('/api/documents/00000000-0000-4000-8000-000000000000', { headers: { Origin: 'https://evil.example' } });
    expect(del.status()).toBe(403);
    const ok = await c.post('/api/documents', { ...mp(Buffer.from('x')), headers: { Origin: BASE } });
    expect(ok.status()).toBe(415); // got past the origin check
    const get = await c.get('/api/guides', { headers: { Origin: 'https://evil.example' } });
    expect(get.status()).toBe(200);
    await c.dispose();
  });

  test('a photo with %PDF- in its metadata is accepted as a photo', async () => {
    const c = await client();
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
      .withExif({ IFD0: { ImageDescription: '%PDF-1.4 trick' } })
      .jpeg()
      .toBuffer();
    expect(png.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const r = await c.post('/api/documents', mp(png, 'p.jpg'));
    expect(r.status()).toBe(201);
    await c.dispose();
  });

  test('a file that only has %PDF- later in the first KB is not a PDF', async () => {
    const c = await client();
    const r = await c.post('/api/documents', mp(Buffer.concat([Buffer.from('GARBAGE HEADER\n'), fx('lumen-bookcase.pdf')]), 'x.pdf'));
    expect(r.status()).toBe(415);
    await c.dispose();
  });

  test('JSON body over 256 KB is 413 too_large; tiny invalid JSON is 400', async () => {
    const c = await client();
    // need a real guide id for the route to be reached; the route parses ids first so use any uuid
    const id = '00000000-0000-4000-8000-000000000000';
    const big = await c.put(`/api/guides/${id}/progress`, { data: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }), headers: { 'Content-Type': 'application/json' } });
    expect([413, 404]).toContain(big.status());
    const r = await c.put(`/api/guides/${id}/progress`, { data: 'x'.repeat(10), headers: { 'Content-Type': 'application/json' } });
    expect([400, 404]).toContain(r.status());
    await c.dispose();
  });

  test('oversized JSON for a real guide is 413 (body is read before ownership is revealed)', async () => {
    const c = await client();
    const up = await c.post('/api/documents', { multipart: { files: { name: 'l.pdf', mimeType: 'application/pdf', buffer: fx('lumen-bookcase.pdf') } } });
    const { documentId } = await up.json();
    let guideId: string | null = null;
    for (let i = 0; i < 100 && !guideId; i++) {
      guideId = (await (await c.get(`/api/documents/${documentId}`)).json()).guideId;
      if (!guideId) await new Promise((r) => setTimeout(r, 300));
    }
    expect(guideId).toBeTruthy();
    const big = await c.put(`/api/guides/${guideId}/progress`, { data: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }), headers: { 'Content-Type': 'application/json' } });
    expect(big.status()).toBe(413);
    expect((await big.json()).error.code).toBe('too_large');

    // page image headers
    const img = await c.get(`/api/documents/${documentId}/pages/0/image`);
    expect(img.status()).toBe(200);
    expect(img.headers()['cache-control']).toBe('private, no-cache');
    expect(img.headers()['content-type']).toBe('image/png');
    // status carries attempts
    const st = await (await c.get(`/api/documents/${documentId}`)).json();
    expect(st.attempts).toBeGreaterThanOrEqual(1);
    expect(st.status).toBe('ready');
    // another session cannot see it
    const other = await client();
    expect((await other.get(`/api/documents/${documentId}`)).status()).toBe(404);
    expect((await other.get(`/api/documents/${documentId}/pages/0/image`)).status()).toBe(404);
    await other.dispose();
    await c.dispose();
  });

  test('mock-failure reports attempts up to 3 and then failed/analysis_unavailable; retry increments', async () => {
    test.setTimeout(120_000);
    const c = await client();
    const up = await c.post('/api/documents', { multipart: { files: { name: 'm.pdf', mimeType: 'application/pdf', buffer: fx('mock-failure.pdf') } } });
    const { documentId } = await up.json();
    let st: { status: string; attempts: number; error: { code: string } | null } = { status: '', attempts: 0, error: null };
    for (let i = 0; i < 150 && st.status !== 'failed'; i++) {
      st = await (await c.get(`/api/documents/${documentId}`)).json();
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(st.status).toBe('failed');
    expect(st.error?.code).toBe('analysis_unavailable');
    expect(st.attempts).toBe(3);
    const re = await c.post(`/api/documents/${documentId}/retry`);
    expect(re.status()).toBe(202);
    await c.dispose();
  });

  test('upload rate limit: 11th upload in an hour from one session is 429 rate_limited with Retry-After; spoofed XFF does not help or hurt others', async () => {
    const c = await client();
    let last = 0;
    let res;
    for (let i = 0; i < 11; i++) {
      res = await c.post('/api/documents', { ...mp(Buffer.from('junk')), headers: { 'X-Forwarded-For': `9.9.9.${i}` } });
      last = res.status();
    }
    expect(last).toBe(429);
    expect(Number(res!.headers()['retry-after'])).toBeGreaterThan(0);
    expect((await res!.json()).error.code).toBe('rate_limited');
    // a different session is unaffected
    const d = await client();
    expect((await d.post('/api/documents', { ...mp(Buffer.from('junk')), headers: { 'X-Forwarded-For': '9.9.9.1' } })).status()).toBe(415);
    await c.dispose();
    await d.dispose();
  });
});
