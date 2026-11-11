export type SniffedType = 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic';

export const MIME: Record<'pdf' | 'jpeg' | 'png' | 'webp', string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const ascii = (b: Uint8Array, from: number, to: number) => Buffer.from(b.subarray(from, to)).toString('latin1');
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);

/** Identifies a file by its leading bytes. The declared MIME type and file name are never trusted. */
export function sniffType(b: Uint8Array): SniffedType | undefined {
  // Image signatures first: a valid photo may carry "%PDF-" in its metadata and must stay a photo.
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(b, 8, 12))) return 'heic';
  // PDF: the header must be the first thing in the file, after an optional UTF-8 BOM and whitespace.
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && i < 64 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x00 || b[i] === 0x0c)) i++;
  if (ascii(b, i, i + 5) === '%PDF-') return 'pdf';
  return undefined;
}
