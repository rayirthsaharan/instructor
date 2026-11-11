import { lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter } from './types';

export class StorageKeyError extends Error {}

function within(root: string, p: string): boolean {
  return p === root || p.startsWith(root + sep);
}

/** Local-disk storage. Keys are relative, '/'-separated, and can never escape the root. */
export class LocalStorage implements StorageAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!key || key.includes('\0') || key.includes('\\') || key.startsWith('/')) {
      throw new StorageKeyError(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    const parts = key.split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..')) {
      throw new StorageKeyError(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    const full = resolve(this.root, ...parts);
    if (!full.startsWith(this.root + sep)) {
      throw new StorageKeyError(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    return full;
  }

  /** Throws if the existing part of `p`'s parent chain resolves outside the real root. */
  private async assertContained(p: string): Promise<void> {
    const realRoot = await realpath(this.root).catch(() => this.root);
    let dir = dirname(p);
    for (;;) {
      try {
        const real = await realpath(dir);
        if (!within(realRoot, real)) throw new StorageKeyError('Storage key escapes the storage root');
        return;
      } catch (e) {
        if (e instanceof StorageKeyError) throw e;
        if (dir === this.root || dir === dirname(dir)) return;
        dir = dirname(dir); // nonexistent: check the nearest existing ancestor
      }
    }
  }

  /** For writes: replace any symlinked directory that points outside the root with a real directory. */
  private async prepareParent(p: string): Promise<void> {
    const rel = p.slice(this.root.length + 1).split(sep).slice(0, -1);
    await mkdir(this.root, { recursive: true });
    const realRoot = await realpath(this.root);
    let cur = this.root;
    for (const part of rel) {
      cur = resolve(cur, part);
      const st = await lstat(cur).catch(() => undefined);
      if (st?.isSymbolicLink()) {
        const real = await realpath(cur).catch(() => undefined);
        if (!real || !within(realRoot, real)) await unlink(cur);
      }
      await mkdir(cur, { recursive: true }).catch(() => {});
    }
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await this.prepareParent(p);
    await this.assertContained(p);
    const tmp = `${p}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data, { flag: 'wx' });
      await rename(tmp, p);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Buffer> {
    const p = this.pathFor(key);
    await this.assertContained(p);
    return readFile(p);
  }

  async exists(key: string): Promise<boolean> {
    const p = this.pathFor(key);
    await this.assertContained(p);
    try {
      return (await stat(p)).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.pathFor(key);
    await this.assertContained(p);
    await rm(p, { force: true });
  }
}

export function createStorage(root: string = process.env.STORAGE_ROOT ?? './data/files'): StorageAdapter {
  return new LocalStorage(root);
}
