import type { ClientErrorCode, DocumentState, GuideSummary } from './types';

export class ApiError extends Error {
  constructor(
    public readonly code: ClientErrorCode | (string & {}),
    message: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const KNOWN_CODES = new Set([
  'unsupported_type',
  'too_large',
  'too_many_pages',
  'encrypted_pdf',
  'corrupt_file',
  'empty',
  'rate_limited',
  'quota_exceeded',
]);

/** Turns an HTTP status + body into an ApiError. Exported for tests. */
export function parseErrorResponse(status: number, body: unknown): ApiError {
  const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof e?.code === 'string' ? e.code : status === 404 ? 'not_found' : 'unknown';
  const message = typeof e?.message === 'string' ? e.message : `Request failed (${status})`;
  return new ApiError(KNOWN_CODES.has(code) || code === 'not_found' ? code : code, message, status);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch (err) {
    if (init?.signal?.aborted) throw new ApiError('aborted', 'Request cancelled');
    throw new ApiError('network', err instanceof Error ? err.message : 'Network error');
  }
  let body: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) throw parseErrorResponse(res.status, body);
  return body as T;
}

export function getDocument(id: string, signal?: AbortSignal): Promise<DocumentState> {
  return request<DocumentState>(`/api/documents/${encodeURIComponent(id)}`, { signal });
}

export async function retryDocument(id: string): Promise<void> {
  await request<unknown>(`/api/documents/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function listGuides(signal?: AbortSignal): Promise<GuideSummary[]> {
  return request<GuideSummary[]>('/api/guides', { signal });
}

export async function deleteGuide(id: string): Promise<void> {
  await request<unknown>(`/api/guides/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deleteDocument(id: string): Promise<void> {
  await request<unknown>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function pageImageUrl(documentId: string, pageIndex: number): string {
  return `/api/documents/${encodeURIComponent(documentId)}/pages/${pageIndex}/image`;
}

/** Multipart upload with real progress (fetch cannot report upload progress). */
export function createDocument(
  files: File[],
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ documentId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    xhr.open('POST', '/api/documents');
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => reject(new ApiError('network', 'Network error'));
    xhr.ontimeout = () => reject(new ApiError('network', 'Timed out'));
    xhr.onabort = () => reject(new ApiError('aborted', 'Upload cancelled'));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const id = (body as { documentId?: unknown } | null)?.documentId;
        if (typeof id === 'string' && id) resolve({ documentId: id });
        else reject(new ApiError('unknown', 'The server did not return a document id', xhr.status));
      } else {
        reject(parseErrorResponse(xhr.status, body));
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) return reject(new ApiError('aborted', 'Upload cancelled'));
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}
