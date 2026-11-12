import { expect, type Page } from '@playwright/test';
import { shotDir } from './screenshot-dir';

export const SHOT = shotDir('m3');

export interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stepId: string;
  createdAt: number;
  citations: Array<{ stepId?: string; pageIndex: number; region?: { x: number; y: number; w: number; h: number } }>;
  notInManual: boolean;
  note?: string;
}

let n = 0;
export const user = (text: string, stepId = 's2'): Msg => ({ id: `u${++n}`, role: 'user', text, stepId, createdAt: 1000 + n, citations: [], notInManual: false });
export const answer = (text: string, stepId = 's2', extra: Partial<Msg> = {}): Msg => ({
  id: `a${++n}`,
  role: 'assistant',
  text,
  stepId,
  createdAt: 1000 + n,
  citations: [],
  notInManual: false,
  ...extra,
});

export interface ApiMock {
  history: Msg[];
  suggestions: string[];
  /** Resolves GET /messages only when called (loading state). */
  holdHistory?: boolean;
  releaseHistory: () => void;
  deletes: number;
  suggestionRequests: string[];
  simplify: { mode: 'ok' | 'fellBack' | 'error' | 'hold'; text: string; calls: number; failFirst?: boolean };
  releaseSimplify: () => void;
}

/**
 * Mocks the assistant routes. POST /messages is controlled from the page (see installStreamControl) so a test can
 * feed an answer chunk by chunk, or fail it before the stream starts.
 */
export async function mockAssistantApi(page: Page, opts: Partial<Pick<ApiMock, 'history' | 'suggestions' | 'holdHistory'>> = {}): Promise<ApiMock> {
  let releaseH: () => void = () => {};
  const gateH = new Promise<void>((r) => (releaseH = r));
  let releaseS: () => void = () => {};
  const gateS = new Promise<void>((r) => (releaseS = r));
  const m: ApiMock = {
    history: opts.history ?? [],
    suggestions: opts.suggestions ?? ['What does this mean?', 'Which piece is this?', 'Why am I doing this?'],
    holdHistory: opts.holdHistory,
    releaseHistory: () => releaseH(),
    deletes: 0,
    suggestionRequests: [],
    simplify: { mode: 'ok', text: 'Push each wooden pin into its hole.', calls: 0 },
    releaseSimplify: () => releaseS(),
  };
  await page.route(/\/api\/guides\/[^/]+\/messages$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (m.holdHistory) await gateH;
      return route.fulfill({ json: { messages: m.history } });
    }
    if (method === 'DELETE') {
      m.deletes++;
      m.history = [];
      return route.fulfill({ status: 204, body: '' });
    }
    return route.continue();
  });
  await page.route(/\/api\/guides\/[^/]+\/suggestions/, async (route) => {
    m.suggestionRequests.push(new URL(route.request().url()).searchParams.get('stepId') ?? '');
    return route.fulfill({ json: { suggestions: m.suggestions } });
  });
  await page.route(/\/api\/guides\/[^/]+\/steps\/[^/]+\/simplify$/, async (route) => {
    m.simplify.calls++;
    if (m.simplify.mode === 'hold') await gateS;
    if (m.simplify.mode === 'error' || (m.simplify.failFirst && m.simplify.calls === 1)) {
      return route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } });
    }
    return route.fulfill({ json: { text: m.simplify.text, cached: false, fellBack: m.simplify.mode === 'fellBack' } });
  });
  return m;
}

/**
 * Replaces fetch for POST /api/guides/:id/messages with a stream the test feeds by hand:
 * `window.__posts` records request bodies; `window.__ctl.send/close`; `window.__aborted`; `window.__next` makes the
 * next POST fail before streaming with { status, body }.
 */
export async function installStreamControl(page: Page) {
  await page.addInitScript(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const realFetch = window.fetch.bind(window);
    w.__posts = [];
    w.__aborted = false;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/api\/guides\/[^/]+\/messages$/.test(new URL(url, location.href).pathname) && init?.method === 'POST') {
        w.__posts.push(JSON.parse(String(init.body)));
        w.__aborted = false;
        if (w.__next) {
          const { status, body } = w.__next;
          w.__next = null;
          return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
        }
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(c) {
            w.__ctl = { send: (s: string) => c.enqueue(enc.encode(s)), close: () => c.close() };
            init.signal?.addEventListener('abort', () => {
              w.__aborted = true;
              try {
                c.error(new DOMException('Aborted', 'AbortError'));
              } catch {
                /* already closed */
              }
            });
          },
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
}

export const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
export const sendDelta = (page: Page, text: string) => page.evaluate((s) => (window as any).__ctl.send(s), frame('delta', { text }));  
export const sendDone = (page: Page, message: Msg) =>
  page.evaluate((s) => {
    const c = (window as any).__ctl;  
    c.send(s);
    c.close();
  }, frame('done', { message }));
export const sendError = (page: Page, code = 'provider_error', message = 'boom') =>
  page.evaluate((s) => {
    const c = (window as any).__ctl;  
    c.send(s);
    c.close();
  }, frame('error', { error: { code, message } }));
export const failNext = (page: Page, status: number, code: string) =>
  page.evaluate((v) => ((window as any).__next = v), { status, body: { error: { code, message: 'server words' } } });  
export const posts = (page: Page) => page.evaluate(() => (window as any).__posts as Array<{ stepId: string; text: string }>);  
export const wasAborted = (page: Page) => page.evaluate(() => (window as any).__aborted as boolean);  

export const askButton = (page: Page) => page.getByTestId('ask-button');
export const panelOf = (page: Page) => page.getByTestId('assistant-panel');
export const composer = (page: Page) => page.getByTestId('composer-input');

/** Opens the assistant from the action bar and waits for it. */
export async function openAssistant(page: Page) {
  await askButton(page).click();
  await expect(panelOf(page)).toBeVisible();
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT}/${name}.png`, animations: 'disabled' });
}
