import { getAppContext, resolveSession, type AppContext, type SessionInfo } from './context';

export type ApiErrorCode =
  | 'unsupported_type' | 'too_large' | 'too_many_pages' | 'encrypted_pdf' | 'corrupt_file' | 'empty' | 'rate_limited'
  | 'quota_exceeded' | 'render_failed' | 'forbidden'
  | 'not_found' | 'invalid_request' | 'conflict' | 'internal';

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status: number, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE } });
}

export function errorResponse(e: ApiError): Response {
  const res = json({ error: { code: e.code, message: e.message } }, e.status);
  if (e.retryAfterSeconds !== undefined) res.headers.set('Retry-After', String(e.retryAfterSeconds));
  return res;
}

export const notFound = (what = 'That item') => new ApiError('not_found', `${what} was not found.`, 404);

/**
 * Wraps a route handler: resolves the anonymous session (creating it on first use), sends the session cookie when new,
 * and turns thrown ApiErrors into the `{ error: { code, message } }` contract. Unknown errors become a generic 500;
 * their details are logged, never returned.
 */
export async function handle(
  req: Request,
  fn: (ctx: AppContext, session: SessionInfo) => Promise<Response>,
  ctx: AppContext = getAppContext(),
): Promise<Response> {
  let session: SessionInfo | undefined;
  let res: Response;
  try {
    assertSameOrigin(req);
    session = await resolveSession(ctx, req);
    res = await fn(ctx, session);
  } catch (e) {
    if (e instanceof ApiError) res = errorResponse(e);
    else {
      console.error('Unhandled API error', e);
      res = errorResponse(new ApiError('internal', 'Something went wrong on our side. Please try again.', 500));
    }
  }
  if (session?.setCookie) res.headers.append('Set-Cookie', session.setCookie);
  return res;
}

/** Route ids are unguessable UUIDs; anything else is a 404 without touching the database. */
export function parseId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  return id;
}

/** Reads a request body with a hard cap; over the cap is refused (413 `too_large`) without buffering the rest. */
export async function readBoundedBody(req: Request, limit: number, message = 'The request is too large.'): Promise<Uint8Array> {
  const tooLarge = () => new ApiError('too_large', message, 413);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const body = await readBoundedBody(req, maxBytes);
  try {
    return JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
  } catch {
    throw new ApiError('invalid_request', 'The request body is not valid JSON.', 400);
  }
}

/** Rejects state-changing requests that the browser says come from another site. Same-origin and non-browser clients pass. */
export function assertSameOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new ApiError('forbidden', 'This request came from another site.', 403);
  const origin = req.headers.get('origin');
  if (origin && origin !== 'null') {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      /* invalid origin falls through to rejection */
    }
    const expected = req.headers.get('host') ?? new URL(req.url).host;
    if (host !== expected) throw new ApiError('forbidden', 'This request came from another site.', 403);
  } else if (origin === 'null') {
    throw new ApiError('forbidden', 'This request came from another site.', 403);
  }
}
