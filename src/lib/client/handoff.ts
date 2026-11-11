// Files chosen or dropped on the Library are passed to Capture in memory (they cannot go in a URL).
let pending: File[] = [];

export function setPendingFiles(files: File[]): void {
  pending = files;
}

export function takePendingFiles(): File[] {
  const f = pending;
  pending = [];
  return f;
}
