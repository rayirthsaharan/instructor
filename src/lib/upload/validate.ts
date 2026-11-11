import { ApiError } from '../http/respond';
import { MAX_PAGES, MAX_TOTAL_BYTES } from '../limits';
import { contentHashFor } from '../pipeline/hash';
import { ImageError, probeImage } from '../render/image';
import { RenderError, probePdf } from '../render/pdf';
import { MIME, sniffType } from './sniff';

export interface ValidatedFile {
  bytes: Uint8Array;
  type: 'pdf' | 'jpeg' | 'png' | 'webp';
  mime: string;
  ext: string;
}

export interface ValidatedUpload {
  kind: 'pdf' | 'images';
  files: ValidatedFile[];
  contentHash: string;
  pageCount: number;
}

const BODY_OVERHEAD = 1024 * 1024; // multipart framing

/** Reads the request body with a hard cap so an oversized upload is refused before it is held in memory. */
export async function readBoundedBody(req: Request, limit = MAX_TOTAL_BYTES + BODY_OVERHEAD): Promise<Uint8Array> {
  const tooLarge = () => new ApiError('too_large', 'These files are too big. The total must be under 40 MB.', 413);
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

/** Parses the multipart body into the `files` entries, in the order given. */
export async function readUploadFiles(req: Request): Promise<Uint8Array[]> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApiError('unsupported_type', 'Send the files as multipart form data in a field named "files".', 415);
  }
  const body = await readBoundedBody(req);
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { 'content-type': type } }).formData();
  } catch {
    throw new ApiError('corrupt_file', 'The upload could not be read. Please try again.', 400);
  }
  const out: Uint8Array[] = [];
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string') continue;
    out.push(new Uint8Array(await entry.arrayBuffer()));
  }
  return out;
}

/** Validates by content, never by file name or declared type. Throws ApiError with the contract's error codes. */
export async function validateUpload(raw: Uint8Array[]): Promise<ValidatedUpload> {
  if (raw.length === 0 || raw.every((f) => f.byteLength === 0)) throw new ApiError('empty', 'No file was received. Choose a PDF or some photos.', 400);
  if (raw.some((f) => f.byteLength === 0)) throw new ApiError('empty', 'One of the files is empty.', 400);
  const total = raw.reduce((n, f) => n + f.byteLength, 0);
  if (total > MAX_TOTAL_BYTES) throw new ApiError('too_large', 'These files are too big. The total must be under 40 MB.', 413);

  const files: ValidatedFile[] = raw.map((bytes) => {
    const type = sniffType(bytes);
    if (type === 'heic') {
      throw new ApiError('unsupported_type', 'HEIC photos cannot be read here. Convert them to JPEG first (the app does this on your device), or upload a PDF.', 415);
    }
    if (!type) throw new ApiError('unsupported_type', 'Only PDF files and JPEG, PNG or WebP photos are supported.', 415);
    return { bytes, type, mime: MIME[type], ext: type === 'jpeg' ? 'jpg' : type };
  });

  const pdfs = files.filter((f) => f.type === 'pdf');
  if (pdfs.length > 0) {
    if (files.length !== 1) throw new ApiError('unsupported_type', 'Upload either one PDF or a set of photos, not a mix.', 415);
    const pdf = files[0]!;
    try {
      const { pageCount } = await probePdf(pdf.bytes);
      if (pageCount > MAX_PAGES) throw new ApiError('too_many_pages', `This manual has ${pageCount} pages. The limit is ${MAX_PAGES}.`, 422);
      return { kind: 'pdf', files, contentHash: contentHashFor('pdf', [pdf.bytes]), pageCount };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof RenderError && e.code === 'encrypted_pdf') {
        throw new ApiError('encrypted_pdf', 'This PDF is password protected. Remove the password and upload it again.', 422);
      }
      throw new ApiError('corrupt_file', 'This PDF could not be opened. It may be damaged.', 422);
    }
  }

  if (files.length > MAX_PAGES) throw new ApiError('too_many_pages', `That is ${files.length} photos. The limit is ${MAX_PAGES}.`, 422);
  for (const f of files) {
    try {
      await probeImage(f.bytes);
    } catch (e) {
      if (e instanceof ImageError) throw new ApiError('corrupt_file', 'One of the photos could not be read. It may be damaged.', 422);
      throw e;
    }
  }
  return { kind: 'images', files, contentHash: contentHashFor('images', files.map((f) => f.bytes)), pageCount: files.length };
}
