import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, openDb, runMigrations, type Db } from '@/lib/db';
import { MockProvider } from '@/lib/ai';
import type { AIProvider } from '@/lib/ai';
import { DbJobQueue, HandlerRegistry, runOnce } from '@/lib/jobs';
import { createStorage } from '@/lib/storage';
import { DbRateLimiter } from '@/lib/ratelimit';
import { setAppContextForTests, type AppContext } from '@/lib/http/context';
import { createAnalysisHandler } from '@/lib/pipeline/handler';
import { JOB_TYPE, type PipelineDeps } from '@/lib/pipeline/types';

export const fixture = (name: string) => readFileSync(join(process.cwd(), 'fixtures', name));
export const lumenPages = () => [1, 2, 3, 4, 5, 6].map((n) => fixture(`lumen-bookcase/page-${n}.png`));

/** Counts provider calls so tests can assert that deduped uploads cost nothing. */
export class CountingProvider extends MockProvider {
  analyseCalls = 0;
  verifyCalls = 0;
  override analyseDocument(...a: Parameters<MockProvider['analyseDocument']>) {
    this.analyseCalls++;
    return super.analyseDocument(...a);
  }
  override verifyGuide(...a: Parameters<MockProvider['verifyGuide']>) {
    this.verifyCalls++;
    return super.verifyGuide(...a);
  }
}

export interface TestApp {
  dir: string;
  db: Db;
  ctx: AppContext;
  deps: PipelineDeps;
  provider: CountingProvider;
  registry: HandlerRegistry;
  clock: { now: number };
  /** Runs queued jobs until none are left (each runOnce claims one). */
  drain(max?: number): Promise<number>;
  close(): void;
}

export function createTestApp(opts: { provider?: AIProvider; deps?: Partial<PipelineDeps> } = {}): TestApp {
  const dir = mkdtempSync(join(tmpdir(), 'app-'));
  const db = openDb(join(dir, 't.db'));
  runMigrations(db);
  const clock = { now: 1_700_000_000_000 };
  const provider = new CountingProvider();
  const storage = createStorage(join(dir, 'files'));
  const queue = new DbJobQueue(db, () => clock.now);
  const ctx: AppContext = {
    db, storage, queue, limiter: new DbRateLimiter(db, () => clock.now), secret: 'test-secret-test-secret-test-secret!', secureCookies: false, trustProxyHops: 0, now: () => clock.now,
  };
  const deps: PipelineDeps = { db, storage, provider: opts.provider ?? provider, now: () => clock.now, ...opts.deps };
  const registry = new HandlerRegistry();
  registry.register(JOB_TYPE, createAnalysisHandler(deps));
  setAppContextForTests(ctx);
  const app: TestApp = {
    dir, db, ctx, deps, provider, registry, clock,
    async drain(max = 20) {
      let n = 0;
      while (n < max && (await runOnce(queue, registry, { log: () => {}, retryMs: 1 }))) n++;
      return n;
    },
    close() {
      setAppContextForTests(undefined);
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return app;
}

/** Minimal client: keeps a cookie jar so each instance behaves like one browser (one device session). */
export class TestClient {
  cookie = '';
  async call(handler: (req: Request, ctx: never) => Promise<Response> | Response, url: string, init: RequestInit = {}, params?: Record<string, string>): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const req = new Request(`http://localhost${url}`, { ...init, headers });
    const res = await handler(req, { params: Promise.resolve(params ?? {}) } as never);
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) this.cookie = c.split(';')[0]!;
    return res;
  }
}

export function uploadForm(...files: { data: Uint8Array; name?: string; type?: string }[]): FormData {
  const fd = new FormData();
  for (const f of files) fd.append('files', new File([new Uint8Array(f.data)], f.name ?? 'upload', { type: f.type ?? 'application/octet-stream' }));
  return fd;
}
