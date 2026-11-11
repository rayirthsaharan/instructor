import { MAX_BYTES, MAX_PAGES, MSG, tooManyPages } from './messages';

export type FileKind = 'pdf' | 'image' | 'heic' | 'unsupported';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function classifyFile(f: { name: string; type: string }): FileKind {
  const type = f.type.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? '';
  if (type === 'application/pdf' || (!type && ext === 'pdf')) return 'pdf';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (HEIC_TYPES.has(type) || (!type && (ext === 'heic' || ext === 'heif'))) return 'heic';
  if (!type) {
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') return 'image';
  }
  return 'unsupported';
}

export interface Candidate {
  name: string;
  type: string;
  size: number;
}

export interface AddPlan {
  /** Indexes into `incoming` that pass every check. */
  accepted: number[];
  /** Distinct banner messages for what was rejected. */
  errors: string[];
  /** The accepted files would replace what is there: ask first. */
  replace: 'photos-with-pdf' | 'pdf-with-photos' | 'pdf-with-pdf' | null;
}

/**
 * Pure rules for adding files (USER_FLOWS 3): type, 40 MB (per file and in total), one PDF OR photos,
 * at most 60 pages. Rejected files are not added; the rest are.
 */
export function planAdd(existing: Candidate[], incoming: Candidate[]): AddPlan {
  const errors = new Set<string>();
  type Entry = { i: number; c: Candidate; kind: FileKind };
  let ok: Entry[] = incoming.map((c, i) => ({ i, c, kind: classifyFile(c) }));

  const drop = (pred: (e: Entry) => boolean, msg: string) => {
    const keep = ok.filter((e) => !pred(e));
    if (keep.length !== ok.length) errors.add(msg);
    ok = keep;
  };

  drop((e) => e.kind === 'unsupported', MSG.unsupported);
  drop((e) => e.c.size > MAX_BYTES, MSG.tooLarge);
  drop((e) => e.c.size === 0, MSG.corrupt);

  const pdfs = ok.filter((e) => e.kind === 'pdf');
  const photos = ok.filter((e) => e.kind !== 'pdf');
  if (pdfs.length > 0 && photos.length > 0) {
    errors.add(MSG.oneKind);
    return { accepted: [], errors: [...errors], replace: null };
  }
  if (pdfs.length > 1) {
    errors.add(MSG.onePdf);
    ok = pdfs.slice(0, 1);
  }

  const existingKinds = existing.map(classifyFile);
  const hasPdf = existingKinds.includes('pdf');
  const hasPhotos = existingKinds.some((k) => k !== 'pdf');
  const addingPdf = ok.length > 0 && ok.every((e) => e.kind === 'pdf');
  let replace: AddPlan['replace'] = null;
  let base = existing;
  if (ok.length > 0) {
    if (addingPdf && hasPhotos) replace = 'photos-with-pdf';
    else if (addingPdf && hasPdf) replace = 'pdf-with-pdf';
    else if (!addingPdf && hasPdf) replace = 'pdf-with-photos';
    if (replace) base = [];
  }

  // Total size and page count against what would remain.
  let bytes = base.reduce((n, f) => n + f.size, 0);
  let count = base.length;
  const accepted: number[] = [];
  let sawTooLarge = false;
  let sawTooMany = false;
  for (const e of ok) {
    if (bytes + e.c.size > MAX_BYTES) {
      sawTooLarge = true;
      continue;
    }
    if (e.kind !== 'pdf' && count + 1 > MAX_PAGES) {
      sawTooMany = true;
      continue;
    }
    bytes += e.c.size;
    count += 1;
    accepted.push(e.i);
  }
  if (sawTooLarge) errors.add(MSG.tooLarge);
  if (sawTooMany) errors.add(tooManyPages(base.length + ok.length));
  return { accepted, errors: [...errors], replace: accepted.length > 0 ? replace : null };
}

/** Moves item `from` to `to` (clamped). Returns the same array when nothing changes. */
export function move<T>(list: T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === target) return list;
  const next = list.slice();
  const removed = next.splice(from, 1);
  next.splice(target, 0, ...removed);
  return next;
}

export function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = list.slice();
  next.splice(Math.max(0, Math.min(list.length, index)), 0, item);
  return next;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
