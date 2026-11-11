import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { sniffType } from '@/lib/upload/sniff';
import { validateUpload, readBoundedBody } from '@/lib/upload/validate';
import { ApiError } from '@/lib/http/respond';
import { contentHashFor } from '@/lib/pipeline/hash';
import { MAX_PAGES, MAX_TOTAL_BYTES } from '@/lib/limits';
import { fixture, lumenPages } from './helpers/app';
import manifest from '../fixtures/manifest.json';

const code = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as ApiError).code;
const png = (w = 8, h = 8) => sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toBuffer();

describe('sniffType', () => {
  it('identifies by magic bytes, not by name', () => {
    expect(sniffType(fixture('lumen-bookcase.pdf'))).toBe('pdf');
    expect(sniffType(lumenPages()[0]!)).toBe('png');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(sniffType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffType(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0'))).toBe('heic');
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'))).toBeUndefined();
    expect(sniffType(Buffer.from('GIF89a......'))).toBeUndefined();
  });
});

describe('validateUpload', () => {
  it('accepts a PDF and reports its page count and hash', async () => {
    const pdf = fixture('lumen-bookcase.pdf');
    const v = await validateUpload([pdf]);
    expect(v).toMatchObject({ kind: 'pdf', pageCount: 6, contentHash: manifest.lumenBookcasePdf });
  });

  it('accepts a photo set in order and hashes the set (order matters)', async () => {
    const pages = lumenPages();
    const v = await validateUpload(pages);
    expect(v).toMatchObject({ kind: 'images', pageCount: 6, contentHash: manifest.lumenBookcaseImages });
    expect(contentHashFor('images', [...pages].reverse())).not.toBe(v.contentHash);
  });

  it('rejects with the contract codes', async () => {
    expect(await code(validateUpload([]))).toBe('empty');
    expect(await code(validateUpload([new Uint8Array()]))).toBe('empty');
    expect(await code(validateUpload([Buffer.from('hello world, plain text')]))).toBe('unsupported_type');
    expect(await code(validateUpload([Buffer.from('\0\0\0\x18ftypheic\0\0\0\0')]))).toBe('unsupported_type');
    expect(await code(validateUpload([fixture('lumen-bookcase.pdf'), lumenPages()[0]!]))).toBe('unsupported_type');
    expect(await code(validateUpload([fixture('lumen-bookcase.pdf'), fixture('not-a-manual.pdf')]))).toBe('unsupported_type');
    expect(await code(validateUpload([fixture('encrypted.pdf')]))).toBe('encrypted_pdf');
    expect(await code(validateUpload([Buffer.from('%PDF-1.4\nthis is not really a pdf')]))).toBe('corrupt_file');
    expect(await code(validateUpload([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('broken')])]))).toBe('corrupt_file');
    expect(await code(validateUpload([new Uint8Array(MAX_TOTAL_BYTES + 1).fill(0x25)]))).toBe('too_large');
  });

  it('rejects too many photos and too many PDF pages', async () => {
    const one = await png();
    expect(await code(validateUpload(Array.from({ length: MAX_PAGES + 1 }, () => one)))).toBe('too_many_pages');
    const doc = await PDFDocument.create();
    for (let i = 0; i < MAX_PAGES + 1; i++) doc.addPage([200, 200]);
    expect(await code(validateUpload([await doc.save()]))).toBe('too_many_pages');
    const ok = await PDFDocument.create();
    for (let i = 0; i < MAX_PAGES; i++) ok.addPage([200, 200]);
    expect((await validateUpload([await ok.save()])).pageCount).toBe(MAX_PAGES);
  }, 30_000);

  it('refuses a decompression bomb image before decoding it', async () => {
    const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await code(validateUpload([huge]))).toBe('corrupt_file');
  }, 30_000);
});

describe('readBoundedBody', () => {
  it('stops reading once the cap is passed', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); } });
    const req = new Request('http://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await code(readBoundedBody(req, 1000))).toBe('too_large');
  });
  it('rejects early on a declared oversize length', async () => {
    const req = new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-length': '5000' } });
    expect(await code(readBoundedBody(req, 1000))).toBe('too_large');
  });
});
