import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, lstatSync, readlinkSync } from 'node:fs';
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

  describe('symlinks', () => {
    let root: string;
    let outside: string;
    beforeEach(() => {
      root = join(dir, 'root');
      outside = join(dir, 'outside');
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, 'secret'), 'top secret');
    });

    it('put through a directory symlink that escapes throws and leaves the symlink alone', async () => {
      symlinkSync(outside, join(root, 'link'));
      await expect(store.put('link/pwn', Buffer.from('x'))).rejects.toThrow('Storage key escapes the storage root');
      await expect(store.put('link/deeper/pwn', Buffer.from('x'))).rejects.toBeInstanceOf(StorageKeyError);
      expect(lstatSync(join(root, 'link')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(root, 'link'))).toBe(outside);
      expect(existsSync(join(outside, 'pwn'))).toBe(false);
    });

    it('put onto a leaf symlink never replaces it or the target', async () => {
      symlinkSync(join(outside, 'secret'), join(root, 'leaf'));
      await expect(store.put('leaf', Buffer.from('x'))).rejects.toThrow('Storage key escapes the storage root');
      expect(lstatSync(join(root, 'leaf')).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('top secret');
    });

    it('get does not follow a leaf symlink, even one pointing inside the root', async () => {
      symlinkSync(join(outside, 'secret'), join(root, 'leaf'));
      await expect(store.get('leaf')).rejects.toBeInstanceOf(StorageKeyError);
      await store.put('real', Buffer.from('ok'));
      symlinkSync(join(root, 'real'), join(root, 'inner'));
      await expect(store.get('inner')).rejects.toBeInstanceOf(StorageKeyError);
      expect(await store.exists('inner')).toBe(false);
      expect(await store.exists('real')).toBe(true);
    });

    it('get refuses to read through an escaping directory symlink', async () => {
      symlinkSync(outside, join(root, 'link'));
      await expect(store.get('link/secret')).rejects.toBeInstanceOf(StorageKeyError);
    });
  });
});
