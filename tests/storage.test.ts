import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage, StorageKeyError } from '@/lib/storage';

let dir: string;
let store: LocalStorage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storage-'));
  store = new LocalStorage(join(dir, 'root'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LocalStorage', () => {
  it('round-trips bytes under nested keys', async () => {
    await store.put('a/b/c.bin', Buffer.from([1, 2, 3]));
    expect(await store.exists('a/b/c.bin')).toBe(true);
    expect([...(await store.get('a/b/c.bin'))]).toEqual([1, 2, 3]);
  });
  it('reports missing keys and deletes idempotently', async () => {
    expect(await store.exists('nope')).toBe(false);
    await expect(store.get('nope')).rejects.toThrow();
    await store.put('x', Buffer.from('1'));
    await store.delete('x');
    await store.delete('x');
    expect(await store.exists('x')).toBe(false);
  });
  it.each(['../evil', 'a/../../evil', '/etc/passwd', 'a//b', './a', 'a\\..\\b', 'a\0b', '', '..'])(
    'rejects unsafe key %j',
    async (key) => {
      await expect(store.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(StorageKeyError);
      await expect(store.get(key)).rejects.toBeInstanceOf(StorageKeyError);
      await expect(store.exists(key)).rejects.toBeInstanceOf(StorageKeyError);
      await expect(store.delete(key)).rejects.toBeInstanceOf(StorageKeyError);
    },
  );
  it('never writes outside the root', async () => {
    await store.put('..x', Buffer.from('ok')).catch(() => {});
    expect(existsSync(join(dir, 'evil'))).toBe(false);
  });
});
