// Runs in a CHILD PROCESS (see pdf.ts). Plain ESM on purpose: it is never bundled by Next and needs no loader.
// Protocol (Node IPC, advanced serialization):
//   parent -> child  { cmd: 'probe', data } | { cmd: 'render', data, indices, maxDim, maxRssBytes }
//   child -> parent  { type: 'probe', pageCount } | { type: 'page', index, width, height, png, text } | { type: 'done' }
//                    | { type: 'error', code, message }
// Hostile-input posture: pinned pdfjs-dist, isEvalSupported false, no font loading from disk or network, bounded canvas.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const MAX_PIXELS = 12_000_000;

const send = (msg) => new Promise((resolve) => process.send(msg, undefined, undefined, () => resolve()));

async function open(data) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    return { doc: await task.promise, task };
  } catch (e) {
    const code = e && e.name === 'PasswordException' ? 'encrypted_pdf' : 'corrupt_file';
    throw Object.assign(new Error(String((e && e.message) || e)), { code });
  }
}

async function pageText(page) {
  try {
    const content = await page.getTextContent();
    let out = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      out += item.str;
      out += item.hasEOL ? '\n' : ' ';
    }
    return out.replace(/[ \t]+/g, ' ').trim().slice(0, 100_000);
  } catch {
    return '';
  }
}

async function main(msg) {
  const { doc, task } = await open(msg.data);
  if (msg.cmd === 'probe') {
    await send({ type: 'probe', pageCount: doc.numPages });
    return;
  }
  const maxDim = Math.min(Math.max(Number(msg.maxDim) || 1600, 200), 4000);
  const maxRss = Number(msg.maxRssBytes) || 0;
  for (const index of msg.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) throw Object.assign(new Error('page out of range'), { code: 'corrupt_file' });
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const longEdge = Math.max(base.width, base.height);
    if (!(longEdge > 0) || !Number.isFinite(longEdge)) throw Object.assign(new Error('page has no size'), { code: 'corrupt_file' });
    const scale = maxDim / longEdge;
    const vp = page.getViewport({ scale });
    const width = Math.max(1, Math.round(vp.width));
    const height = Math.max(1, Math.round(vp.height));
    if (width * height > MAX_PIXELS) throw Object.assign(new Error('page too large'), { code: 'corrupt_file' });
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const png = canvas.toBuffer('image/png');
    const text = await pageText(page);
    page.cleanup();
    await send({ type: 'page', index, width, height, png, text });
    if (maxRss > 0 && process.memoryUsage().rss > maxRss) {
      throw Object.assign(new Error('memory limit exceeded'), { code: 'render_failed' });
    }
  }
  await task.destroy();
  await send({ type: 'done' });
}

process.once('message', (msg) => {
  main(msg).then(
    () => process.exit(0),
    async (e) => {
      await send({ type: 'error', code: (e && e.code) || 'render_failed', message: String((e && e.message) || e) });
      process.exit(1);
    },
  );
});
