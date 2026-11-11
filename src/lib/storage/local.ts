import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter } from './types';

export class StorageKeyError extends Error {}

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

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (e) {
      if (e instanceof StorageKeyError) throw e;
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export function createStorage(root: string = process.env.STORAGE_ROOT ?? './data/files'): StorageAdapter {
  return new LocalStorage(root);
}
