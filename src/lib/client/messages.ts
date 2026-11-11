import type { DocumentStage } from './types';

// Exact copy from USER_FLOWS sections 3 and 10.

export const MAX_BYTES = 40 * 1024 * 1024;
export const MAX_PAGES = 60;

export const MSG = {
  unsupported: "That file type isn't supported. Use a PDF, or JPEG, PNG, HEIC or WebP photos.",
  tooLarge: "That's over the 40 MB limit. Try a smaller PDF, or photos of the pages instead.",
  encrypted: 'This PDF is locked with a password. Remove the password, or take photos of the pages.',
  corrupt: "We couldn't open that file. It may be damaged. Try downloading it again or use photos.",
  network: 'The upload stopped. Check your connection.',
  limit: "You've used this month's free guides.",
  empty: 'Add a PDF or at least one page photo.',
  oneKind: 'Add one PDF, or photos of the pages - not both.',
  onePdf: 'Add one PDF at a time.',
  heic: "We couldn't convert that HEIC photo in this browser. Share it as a JPEG, or switch your camera to the most compatible format.",
} as const;

export function tooManyPages(pages?: number | null): string {
  const lead = pages ? `This manual has ${pages} pages.` : 'This manual has too many pages.';
  return `${lead} The limit is ${MAX_PAGES}. If your product is one section of it, upload just those pages.`;
}

export interface MappedUploadError {
  message: string;
  /** Info banner (not an error) for the free-limit case. */
  kind: 'error' | 'info';
  /** Offer "Try again" with the files kept. */
  retry: boolean;
}

/** Maps an API error code (or network failure) to the specified message. */
export function uploadErrorMessage(code: string, serverMessage = ''): MappedUploadError {
  switch (code) {
    case 'unsupported_type':
      return { message: MSG.unsupported, kind: 'error', retry: false };
    case 'too_large':
      return { message: MSG.tooLarge, kind: 'error', retry: false };
    case 'too_many_pages': {
      const n = /(\d+)\s*pages?/i.exec(serverMessage);
      return { message: tooManyPages(n ? Number(n[1]) : null), kind: 'error', retry: false };
    }
    case 'encrypted_pdf':
      return { message: MSG.encrypted, kind: 'error', retry: false };
    case 'corrupt_file':
      return { message: MSG.corrupt, kind: 'error', retry: false };
    case 'empty':
      return { message: MSG.empty, kind: 'error', retry: false };
    case 'rate_limited':
      return { message: MSG.limit, kind: 'info', retry: false };
    case 'network':
      return { message: MSG.network, kind: 'error', retry: true };
    default:
      return { message: 'The upload didn\'t go through. Try again.', kind: 'error', retry: true };
  }
}

/** Row of the four-row stage list (DS 7.14). */
export const STAGE_LABELS = ['Reading pages', 'Finding parts', 'Building steps', 'Double-checking'] as const;

/** Index of the stage row a pipeline stage belongs to. `analyse` covers rows 1 and 2; see DECISIONS entry. */
export function stageRow(stage: DocumentStage | null): number {
  switch (stage) {
    case 'ingest':
    case 'render':
    case null:
      return 0;
    case 'analyse':
      return 1;
    case 'verify':
    case 'publish':
      return 3;
  }
}

/** Section 10.3. `repeated` = third failure. */
export function failureMessage(stage: DocumentStage | null, code: string | undefined, repeated: boolean): { message: string; repeated: boolean; retryAllowed: boolean; differentFile: boolean } {
  let message: string;
  if (code && /unreadable/.test(code)) {
    message = "We couldn't read these pages. Try photos in brighter light, with each page flat and filling the frame.";
  } else if (stage === 'ingest' || stage === 'render' || stage === null) {
    message = "We couldn't read this file's pages.";
  } else if (stage === 'analyse') {
    message = "We couldn't build a guide from this manual. This is on our side.";
  } else {
    message = "We built the steps but couldn't verify them against the original, so we haven't shown them.";
  }
  if (repeated) message += " It's still not working. Your manual is saved; try again later.";
  const readFail = stage === 'ingest' || stage === 'render' || stage === null;
  return { message, repeated, retryAllowed: !repeated, differentFile: readFail && !repeated };
}
