import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { POST as postDocument } from '@/app/api/documents/route';
import { GET as getDoc } from '@/app/api/documents/[id]/route';
import { GET as getImage } from '@/app/api/documents/[id]/pages/[index]/image/route';
import { GET as listGuides } from '@/app/api/guides/route';
import { PUT as putProgress } from '@/app/api/guides/[id]/progress/route';
import { sniffType } from '@/lib/upload/sniff';
import { clientIp } from '@/lib/http/context';
import { readJson } from '@/lib/http/respond';
import { setActiveUploadsForTests } from '@/lib/http/documents';
import { sessionCookieName, sessionSetCookie, verifySessionValue } from '@/lib/session/cookie';
import { loadConfig, resetConfigCache } from '@/lib/config';
import { assertRendererAvailable, childExecArgv, probePdf, renderChildPath } from '@/lib/render/pdf';
import { listPages } from '@/lib/db';
import { UPLOAD_LIMIT_PER_SESSION, UPLOAD_LIMIT_GLOBAL, MAX_CONCURRENT_UPLOADS } from '@/lib/limits';
import { createTestApp, fixture, lumenPages, TestClient, uploadForm, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(() => {
  app = createTestApp();
});
afterEach(() => {
  setActiveUploadsForTests(0);
  delete process.env.RENDER_CHILD_PATH;
  resetConfigCache();
  app.close();
});

const up = (c: TestClient, data: Uint8Array, headers: Record<string, string> = {}) =>
  c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm({ data }), headers });
const rows = (table: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3');
  const sql = new Db(`${app.dir}/t.db`);
  const n = (sql.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;
  sql.close();
  return n;
};

describe('1. file type sniffing', () => {
  it('a valid photo containing %PDF- in its metadata stays a photo', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().withExif({ IFD0: { ImageDescription: '%PDF-1.7 not a pdf' } }).toBuffer();
    expect(Buffer.from(jpeg).includes('%PDF-')).toBe(true);
    expect(sniffType(jpeg)).toBe('jpeg');
    const res = await up(new TestClient(), jpeg);
    expect(res.status).toBe(201);
  });
  it('PDF only when the header leads the file (BOM and whitespace allowed)', () => {
    const pdf = fixture('lumen-bookcase.pdf');
    expect(sniffType(pdf)).toBe('pdf');
    expect(sniffType(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\n  %PDF-1.4\n')]))).toBe('pdf');
    expect(sniffType(Buffer.from('<html>junk junk junk %PDF-1.4 inside'))).toBeUndefined();
    expect(sniffType(Buffer.concat([Buffer.alloc(200, 0x41), Buffer.from('%PDF-1.4')]))).toBeUndefined();
  });
});

describe('2. rate limiting and concurrency', () => {
  it('ignores X-Forwarded-For and X-Real-IP when no proxy is trusted', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' } });
    expect(clientIp(req, 0)).toBeUndefined();
  });
  it('takes the Nth entry from the right when proxies are trusted', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7, 10.0.0.1' } });
    expect(clientIp(req, 1)).toBe('10.0.0.1');
    expect(clientIp(req, 2)).toBe('203.0.113.7');
    expect(clientIp(req, 5)).toBeUndefined();
  });
  it('without a trusted IP, spoofed headers do not bypass the session limit and different sessions do not share a bucket', async () => {
    const a = new TestClient();
    for (let i = 0; i < UPLOAD_LIMIT_PER_SESSION.limit; i++) expect((await up(a, fixture('mock-failure.pdf'), { 'x-forwarded-for': `9.9.9.${i}` })).status).toBe(201);
    expect((await up(a, fixture('mock-failure.pdf'), { 'x-forwarded-for': '8.8.8.8' })).status).toBe(429);
    // Other sessions, even with the same forwarding header, are unaffected.
    expect((await up(new TestClient(), fixture('mock-failure.pdf'), { 'x-forwarded-for': '9.9.9.0' })).status).toBe(201);
  }, 60_000);
  it('a global ceiling still applies', async () => {
    await app.ctx.limiter.hit('upload:global', UPLOAD_LIMIT_GLOBAL.limit, UPLOAD_LIMIT_GLOBAL.windowMs); // 1
    for (let i = 1; i < UPLOAD_LIMIT_GLOBAL.limit; i++) await app.ctx.limiter.hit('upload:global', UPLOAD_LIMIT_GLOBAL.limit, UPLOAD_LIMIT_GLOBAL.windowMs);
    const res = await up(new TestClient(), fixture('mock-failure.pdf'));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  }, 30_000);
  it('503 with Retry-After and code rate_limited when too many uploads are in flight', async () => {
    setActiveUploadsForTests(MAX_CONCURRENT_UPLOADS);
    const res = await up(new TestClient(), fixture('mock-failure.pdf'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect((await res.json()).error.code).toBe('rate_limited');
  });
  it('quota_exceeded (403) only when FREE_GUIDES_PER_MONTH is set, and rate_limited stays separate', async () => {
    const c = new TestClient();
    expect((await up(c, fixture('mock-failure.pdf'))).status).toBe(201);
    app.ctx.freeGuidesPerMonth = 1;
    const res = await up(c, fixture('not-a-manual.pdf'));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('quota_exceeded');
    app.clock.now += 31 * 24 * 3600 * 1000;
    expect((await up(c, fixture('not-a-manual.pdf'))).status).toBe(201);
  });
  it('config parses the new settings', () => {
    expect(loadConfig({ TRUST_PROXY_HOPS: '2', FREE_GUIDES_PER_MONTH: '5' })).toMatchObject({ trustProxyHops: 2, freeGuidesPerMonth: 5 });
    expect(loadConfig({})).toMatchObject({ trustProxyHops: 0, freeGuidesPerMonth: undefined });
  });
});

describe('3. bounded JSON bodies', () => {
  it('readJson refuses a body over the limit, declared or streamed', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    await expect(readJson(new Request('http://x/', { method: 'PUT', body: big }))).rejects.toMatchObject({ code: 'too_large', status: 413 });
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(200 * 1024)); c.enqueue(new Uint8Array(200 * 1024)); c.close(); } });
    await expect(readJson(new Request('http://x/', { method: 'PUT', body: stream, duplex: 'half' } as RequestInit))).rejects.toMatchObject({ code: 'too_large' });
    expect(await readJson(new Request('http://x/', { method: 'PUT', body: '{"a":1}' }))).toEqual({ a: 1 });
  });
  it('the progress route returns 413 for an oversized body', async () => {
    const c = new TestClient();
    await up(c, fixture('lumen-bookcase.pdf'));
    await app.drain();
    const guideId = (await (await c.call(listGuides, '/x')).json())[0].id;
    const res = await c.call(putProgress, '/x', { method: 'PUT', body: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }) }, { id: guideId });
    expect(res.status).toBe(413);
  }, 30_000);
});

describe('4. renderer location and failures', () => {
  it('resolves the default script without the working directory and honours RENDER_CHILD_PATH', () => {
    const prev = process.cwd();
    process.chdir('/');
    try {
      expect(renderChildPath()).toMatch(/src\/lib\/render\/pdf-child\.mjs$/);
      expect(assertRendererAvailable()).toBe(renderChildPath());
    } finally {
      process.chdir(prev);
    }
    process.env.RENDER_CHILD_PATH = '/nonexistent/pdf-child.mjs';
    resetConfigCache();
    expect(() => assertRendererAvailable()).toThrowError(/RENDER_CHILD_PATH/);
  });
  it('a missing renderer is a 503 render_failed, not a damaged file; the pipeline reports render_failed', async () => {
    process.env.RENDER_CHILD_PATH = '/nonexistent/pdf-child.mjs';
    resetConfigCache();
    const res = await up(new TestClient(), fixture('lumen-bookcase.pdf'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('render_failed');
    await expect(probePdf(fixture('lumen-bookcase.pdf'))).rejects.toMatchObject({ code: 'render_unavailable' });
  });
});

describe('5. render child permission model', () => {
  it('is started with --permission, minimal read access and one write directory', () => {
    const args = childExecArgv(renderChildPath(), '/tmp/work-dir', 512);
    expect(args).toContain('--permission');
    const reads = args.filter((a) => a.startsWith('--allow-fs-read='));
    expect(reads).toHaveLength(3);
    expect(reads.join(' ')).not.toMatch(/--allow-fs-read=\/?$/);
    expect(args.filter((a) => a.startsWith('--allow-fs-write='))).toEqual(['--allow-fs-write=/tmp/work-dir']);
    expect(args).not.toContain('--allow-child-process');
    expect(args).not.toContain('--allow-worker');
  });
  it('still renders under the permission model and cannot read other files', async () => {
    const { renderPdfPages } = await import('@/lib/render/pdf');
    const got: number[] = [];
    await renderPdfPages(fixture('lumen-bookcase.pdf'), [0], async (p) => void got.push(p.width));
    expect(got).toHaveLength(1);
    // Direct check of the model: a child with the same flags is denied /etc/passwd.
    const { execFileSync } = await import('node:child_process');
    const args = [...childExecArgv(renderChildPath(), '/tmp', 256), '-e', "try{require('fs').readFileSync('/etc/passwd');console.log('READ')}catch(e){console.log(e.code)}"];
    expect(execFileSync(process.execPath, args, { encoding: 'utf8' }).trim()).toBe('ERR_ACCESS_DENIED');
  }, 30_000);
});

describe('6. cookie name and cross-site requests', () => {
  it('uses the __Host- prefix when Secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-instructor_session');
    const c = sessionSetCookie(crypto.randomUUID(), 's', true);
    expect(c).toMatch(/^__Host-instructor_session=/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Domain/i);
    expect(sessionSetCookie(crypto.randomUUID(), 's', false)).toMatch(/^instructor_session=/);
  });
  it('production-mode context reads only the prefixed cookie', async () => {
    app.ctx.secureCookies = true;
    const c = new TestClient();
    const first = await c.call(listGuides, '/x');
    expect(first.headers.get('set-cookie')).toMatch(/^__Host-instructor_session=/);
    expect(verifySessionValue(decodeURIComponent(c.cookie.split('=')[1]!), app.ctx.secret)).toBeTruthy();
    expect((await c.call(listGuides, '/x')).headers.get('set-cookie')).toBeNull();
  });
  it.each([
    [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'sec-fetch-site': 'same-site' }, 403],
    [{ origin: 'https://evil.example' }, 403],
    [{ origin: 'null' }, 403],
    [{ 'sec-fetch-site': 'same-origin', origin: 'http://localhost' }, 201],
    [{}, 201],
  ])('non-GET with %j -> %i', async (headers, status) => {
    const res = await up(new TestClient(), fixture('mock-failure.pdf'), headers as Record<string, string>);
    expect(res.status).toBe(status);
    if (status === 403) expect((await res.json()).error.code).toBe('forbidden');
  });
  it('GET is never blocked by origin headers', async () => {
    expect((await new TestClient().call(listGuides, '/x', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(200);
  });
});

describe('7. sessions are written on first write only', () => {
  it('cookieless reads leave no session rows; an upload creates exactly one', async () => {
    for (let i = 0; i < 3; i++) await new TestClient().call(listGuides, '/x');
    expect(rows('sessions')).toBe(0);
    const c = new TestClient();
    await c.call(listGuides, '/x');
    expect(rows('sessions')).toBe(0);
    expect((await up(c, fixture('mock-failure.pdf'))).status).toBe(201); // cookie from the earlier read still works
    expect(rows('sessions')).toBe(1);
    const list = await (await c.call(listGuides, '/x')).json();
    expect(list).toHaveLength(1);
  });
  it('a failed upload does not create a session row', async () => {
    await up(new TestClient(), Buffer.from('plain text'));
    expect(rows('sessions')).toBe(0);
  });
});

describe('8. shared page images', () => {
  it('the page reference exists before the file is written', async () => {
    let referencedAtWrite = false;
    const storage = app.deps.storage;
    const realPut = storage.put.bind(storage);
    const docIds: string[] = [];
    storage.put = async (key, data) => {
      if (key.startsWith('pages/') && docIds[0]) referencedAtWrite ||= (await listPages(app.db, docIds[0])).some((p) => p.imagePath === key);
      return realPut(key, data);
    };
    const c = new TestClient();
    docIds.push((await (await up(c, lumenPages()[0]!)).json()).documentId);
    await app.drain();
    expect(referencedAtWrite).toBe(true);
  }, 30_000);
});

describe('9-10. headers and status', () => {
  it('page images are private, no-cache; status includes attempts', async () => {
    const c = new TestClient();
    const { documentId } = await (await up(c, fixture('lumen-bookcase.pdf'))).json();
    expect((await (await c.call(getDoc, '/x', {}, { id: documentId })).json()).attempts).toBe(0);
    await app.drain();
    const s = await (await c.call(getDoc, '/x', {}, { id: documentId })).json();
    expect(s).toMatchObject({ status: 'ready', attempts: 1 });
    expect((await c.call(getImage, '/x', {}, { id: documentId, index: '0' })).headers.get('cache-control')).toBe('private, no-cache');
    const failed = await (await up(c, fixture('mock-failure.pdf'))).json();
    await app.drain();
    expect((await (await c.call(getDoc, '/x', {}, { id: failed.documentId })).json()).attempts).toBe(3);
  }, 30_000);
});

