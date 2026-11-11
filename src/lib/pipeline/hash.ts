import { createHash } from 'node:crypto';

export const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

/** PDF: the hash of the bytes. Photo set: a hash over the ordered per-file hashes, so order matters. */
export function contentHashFor(kind: 'pdf' | 'images', files: Uint8Array[]): string {
  if (kind === 'pdf') {
    if (files.length !== 1) throw new Error('A PDF upload is exactly one file');
    return sha256(files[0]!);
  }
  return sha256(`images:${files.length}:${files.map((f) => sha256(f)).join(',')}`);
}
