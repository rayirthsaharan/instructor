import { constants, realpathSync, rmSync } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter } from './types';

export class StorageKeyError extends Error {}

const ESCAPES = 'Storage key escapes the storage root';

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
        if (!within(realRoot, real)) throw new StorageKeyError(ESCAPES);
        return;
      } catch (e) {
        if (e instanceof StorageKeyError) throw e;
        if (dir === this.root || dir === dirname(dir)) return;
        dir = dirname(dir); // nonexistent: check the nearest existing ancestor
      }
    }
  }

  /** For writes: create missing directories. A symlinked directory is never replaced; one leaving the root is refused. */
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
        if (!real || !within(realRoot, real)) throw new StorageKeyError(ESCAPES);
        continue;
      }
      if (!st) await mkdir(cur).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e;
      });
    }
  }

  /** The leaf itself may never be a symlink: put would replace it and get would follow it. */
  private async assertLeafNotSymlink(p: string): Promise<void> {
    const st = await lstat(p).catch(() => undefined);
    if (!st?.isSymbolicLink()) return;
    const realRoot = await realpath(this.root).catch(() => this.root);
    const real = await realpath(p).catch(() => undefined);
    throw new StorageKeyError(!real || !within(realRoot, real) ? ESCAPES : 'Storage key is a symbolic link');
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await this.prepareParent(p);
    await this.assertContained(p);
    await this.assertLeafNotSymlink(p);
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
    let fh;
    try {
      fh = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOOP') throw new StorageKeyError(ESCAPES);
      throw e;
    }
    try {
      return await fh.readFile();
    } finally {
      await fh.close();
    }
  }

  async exists(key: string): Promise<boolean> {
    const p = this.pathFor(key);
    await this.assertContained(p);
    try {
      return (await lstat(p)).isFile(); // lstat: a symlink leaf is not a stored file
    } catch {
      return false;
    }
  }

  deleteSync(key: string): void {
    const p = this.pathFor(key);
    let realRoot = this.root;
    try {
      realRoot = realpathSync(this.root);
    } catch {
      /* no root yet: nothing stored */
    }
    let dir = dirname(p);
    for (;;) {
      try {
        if (!within(realRoot, realpathSync(dir))) throw new StorageKeyError(ESCAPES);
        break;
      } catch (e) {
        if (e instanceof StorageKeyError) throw e;
        if (dir === this.root || dir === dirname(dir)) break;
        dir = dirname(dir);
      }
    }
    rmSync(p, { force: true });
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
