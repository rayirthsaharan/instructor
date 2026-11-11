import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config';

/**
 * PDF probing and rasterising run in a child process with time and memory limits (ARCHITECTURE section 10, item 5).
 * Import this module from the worker and from route handlers only through `probePdf`; the heavy libraries
 * (pdfjs-dist, @napi-rs/canvas) are loaded by the child script and never enter the Next bundle.
 */

/** `render_unavailable`: the renderer itself is missing or cannot start. That is our fault, never the user's file. */
export type RenderErrorCode = 'encrypted_pdf' | 'corrupt_file' | 'render_failed' | 'render_timeout' | 'render_unavailable';

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

/** Walks up from this file to the package root, so the default does not depend on the working directory. */
function packageRoot(): string | undefined {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'lib', 'render', 'pdf-child.mjs'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    /* not a file URL */
  }
  return undefined;
}

/** `RENDER_CHILD_PATH` if set, otherwise `<package root>/src/lib/render/pdf-child.mjs`. */
export function renderChildPath(): string {
  const configured = getConfig().renderChildPath;
  if (configured) return configured;
  const root = packageRoot();
  return root ? join(root, 'src', 'lib', 'render', 'pdf-child.mjs') : '';
}

/** Throws RenderError('render_unavailable') with a clear message when the renderer script cannot be found. */
export function assertRendererAvailable(): string {
  const path = renderChildPath();
  if (!path || !existsSync(path)) {
    throw new RenderError(`PDF renderer script not found at "${path || '(unresolved)'}". Set RENDER_CHILD_PATH to the location of src/lib/render/pdf-child.mjs.`, 'render_unavailable');
  }
  return path;
}

/**
 * Node permission model for the child: it may read only its script and the two libraries it loads, and write only its
 * own empty temp directory. Native addons are allowed because the canvas backend is one; they are not restricted by the model.
 */
export function childExecArgv(script: string, workDir: string, maxHeapMb: number): string[] {
  const root = packageRoot() ?? dirname(script);
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const reads = [real(script), real(join(root, 'node_modules', 'pdfjs-dist')), real(join(root, 'node_modules', '@napi-rs'))];
  return [
    `--max-old-space-size=${maxHeapMb}`,
    '--permission',
    '--allow-addons',
    '--disable-warning=SecurityWarning',
    ...reads.map((p) => `--allow-fs-read=${p}`),
    `--allow-fs-write=${real(workDir)}`,
  ];
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
  return runInWorkDir(request, limits, onMessage, stepTimeout, maxRss);
}

async function runInWorkDir(
  request: Record<string, unknown>,
  limits: RenderLimits,
  onMessage: (m: ChildMessage) => Promise<void> | void,
  stepTimeout: number,
  maxRss: number,
): Promise<void> {
  const script = assertRendererAvailable();
  const workDir = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    await spawnChild(script, workDir, request, limits, onMessage, stepTimeout, maxRss);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function spawnChild(
  script: string,
  workDir: string,
  request: Record<string, unknown>,
  limits: RenderLimits,
  onMessage: (m: ChildMessage) => Promise<void> | void,
  stepTimeout: number,
  maxRss: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = fork(script, [], {
      cwd: workDir,
      serialization: 'advanced',
      execArgv: childExecArgv(script, workDir, limits.maxHeapMb ?? 768),
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
    child.on('error', (e) => finish(new RenderError(`Renderer failed to start: ${e.message}`, 'render_unavailable')));
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
