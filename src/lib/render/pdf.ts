import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PDF probing and rasterising run in a child process with time and memory limits (ARCHITECTURE section 10, item 5).
 * Import this module from the worker and from route handlers only through `probePdf`; the heavy libraries
 * (pdfjs-dist, @napi-rs/canvas) are loaded by the child script and never enter the Next bundle.
 */

export type RenderErrorCode = 'encrypted_pdf' | 'corrupt_file' | 'render_failed' | 'render_timeout';

export class RenderError extends Error {
  constructor(message: string, public readonly code: RenderErrorCode) {
    super(message);
    this.name = 'RenderError';
  }
}

export interface RenderLimits {
  /** Kill the child when no page (or probe result) arrives for this long. Default 60 s. */
  stepTimeoutMs?: number;
  /** Kill the child when its resident memory passes this. Default 1 GiB. */
  maxRssBytes?: number;
  /** V8 heap ceiling for the child, in MiB. Default 768. */
  maxHeapMb?: number;
  /** Long edge of rendered pages in pixels. Default 1600. */
  maxDim?: number;
}

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  png: Buffer;
  text: string;
}

type ChildMessage =
  | { type: 'probe'; pageCount: number }
  | { type: 'page'; index: number; width: number; height: number; png: Uint8Array; text: string }
  | { type: 'done' }
  | { type: 'error'; code: RenderErrorCode; message: string };

/** The child script lives next to this file; under Next's bundle `import.meta.url` is not a file path, so fall back to cwd. */
function childScript(): string {
  const candidates = [join(process.cwd(), 'src', 'lib', 'render', 'pdf-child.mjs')];
  try {
    const here = fileURLToPath(new URL('./pdf-child.mjs', import.meta.url));
    candidates.unshift(here);
  } catch {
    /* not a file URL */
  }
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new RenderError('PDF renderer is not installed', 'render_failed');
  return found;
}

async function rssBytes(pid: number): Promise<number | undefined> {
  try {
    const statm = await readFile(`/proc/${pid}/statm`, 'utf8');
    return Number(statm.split(' ')[1]) * 4096;
  } catch {
    return undefined; // not Linux: the child's own check after each page still applies
  }
}

function run(request: Record<string, unknown>, limits: RenderLimits, onMessage: (m: ChildMessage) => Promise<void> | void): Promise<void> {
  const stepTimeout = limits.stepTimeoutMs ?? 60_000;
  const maxRss = limits.maxRssBytes ?? 1024 * 1024 * 1024;
  return new Promise<void>((resolve, reject) => {
    const child = fork(childScript(), [], {
      serialization: 'advanced',
      execArgv: [`--max-old-space-size=${limits.maxHeapMb ?? 768}`],
      env: { NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    let timer: NodeJS.Timeout;
    let chain: Promise<void> = Promise.resolve();
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      child.kill('SIGKILL');
      if (err) reject(err);
      else resolve();
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new RenderError('Rendering took too long', 'render_timeout')), stepTimeout);
    };
    const watchdog = setInterval(() => {
      const pid = child.pid;
      if (pid === undefined) return;
      void rssBytes(pid).then((rss) => {
        if (rss !== undefined && rss > maxRss) finish(new RenderError('Rendering used too much memory', 'render_failed'));
      });
    }, 250);
    arm();
    child.on('message', (m: ChildMessage) => {
      // Messages are handled strictly in order; a slow handler (storage write) holds back the next one.
      chain = chain.then(async () => {
        if (settled) return;
        arm();
        if (m.type === 'error') return finish(new RenderError(m.message, m.code));
        try {
          await onMessage(m);
        } catch (e) {
          return finish(e instanceof Error ? e : new Error(String(e)));
        }
        if (m.type === 'done' || m.type === 'probe') finish();
      });
    });
    child.on('error', (e) => finish(new RenderError(`Renderer failed to start: ${e.message}`, 'render_failed')));
    child.on('exit', (code, signal) => {
      // Let queued messages drain first, then treat an exit without a result as a crash.
      void chain.then(() => finish(new RenderError(`Renderer exited unexpectedly (${signal ?? code})`, 'render_failed')));
    });
    child.send({ ...request }, (err) => {
      if (err) finish(new RenderError('Could not hand the file to the renderer', 'render_failed'));
    });
  });
}

/** Opens the PDF in the child and reports its page count. Throws RenderError encrypted_pdf / corrupt_file. */
export async function probePdf(data: Uint8Array, limits: RenderLimits = {}): Promise<{ pageCount: number }> {
  let pageCount = -1;
  await run({ cmd: 'probe', data }, { stepTimeoutMs: 20_000, ...limits }, (m) => {
    if (m.type === 'probe') pageCount = m.pageCount;
  });
  if (pageCount < 1) throw new RenderError('The PDF has no pages', 'corrupt_file');
  return { pageCount };
}

/** Renders the given zero-based page indices, calling `onPage` for each as soon as it is ready. */
export async function renderPdfPages(
  data: Uint8Array,
  indices: number[],
  onPage: (page: RenderedPage) => Promise<void>,
  limits: RenderLimits = {},
): Promise<void> {
  if (indices.length === 0) return;
  await run(
    { cmd: 'render', data, indices, maxDim: limits.maxDim ?? 1600, maxRssBytes: limits.maxRssBytes ?? 1024 * 1024 * 1024 },
    limits,
    async (m) => {
      if (m.type === 'page') await onPage({ index: m.index, width: m.width, height: m.height, png: Buffer.from(m.png), text: m.text });
    },
  );
}
