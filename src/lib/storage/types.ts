export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Synchronous delete, for callers that must remove a file while holding a database write lock. */
  deleteSync(key: string): void;
}
