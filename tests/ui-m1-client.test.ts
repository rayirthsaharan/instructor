import { describe, expect, it } from 'vitest';
import { parseErrorResponse } from '@/lib/client/api';
import { errorLabel, failureMessage, MSG, pageList, tooManyPages, uploadErrorMessage } from '@/lib/client/messages';
import { classifyFile, insertAt, move, planAdd } from '@/lib/client/selection';
import { nextDelay, POLL_ERROR_MAX_MS, POLL_MAX_MS, POLL_MIN_MS } from '@/lib/client/poll';
import { buildRows } from '@/lib/client/stages';
import { guideHref, hero, libraryState } from '@/lib/client/library';
import type { GuideSummary } from '@/lib/client/types';

const MB = 1024 * 1024;
const pdf = (size = MB, name = 'a.pdf') => ({ name, type: 'application/pdf', size });
const jpg = (n = 1, size = MB) => ({ name: `p${n}.jpg`, type: 'image/jpeg', size });

describe('classifyFile', () => {
  it('classifies by MIME type, falling back to extension when the type is empty', () => {
    expect(classifyFile({ name: 'a.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(classifyFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image');
    expect(classifyFile({ name: 'x.HEIC', type: '' })).toBe('heic');
    expect(classifyFile({ name: 'x.heic', type: 'image/heic' })).toBe('heic');
    expect(classifyFile({ name: 'x.webp', type: 'image/webp' })).toBe('image');
    expect(classifyFile({ name: 'x.gif', type: 'image/gif' })).toBe('unsupported');
    expect(classifyFile({ name: 'x.docx', type: '' })).toBe('unsupported');
  });
});

describe('planAdd (USER_FLOWS 3)', () => {
  it('rejects unsupported types with the exact message and keeps the valid files', () => {
    const plan = planAdd([], [jpg(1), { name: 'a.gif', type: 'image/gif', size: 10 }]);
    expect(plan.accepted).toEqual([0]);
    expect(plan.errors).toEqual([MSG.unsupported]);
  });
  it('rejects a file over 40 MB', () => {
    const plan = planAdd([], [pdf(41 * MB)]);
    expect(plan.accepted).toEqual([]);
    expect(plan.errors).toEqual([MSG.tooLarge]);
  });
  it('rejects photos that push the total over 40 MB', () => {
    const plan = planAdd([jpg(1, 30 * MB)], [jpg(2, 15 * MB)]);
    expect(plan.accepted).toEqual([]);
    expect(plan.errors).toEqual([MSG.tooLarge]);
  });
  it('rejects empty files as unreadable', () => {
    expect(planAdd([], [jpg(1, 0)]).errors).toEqual([MSG.corrupt]);
  });
  it('limits photos to 60 pages with the page count in the message', () => {
    const existing = Array.from({ length: 58 }, (_, i) => jpg(i, 1000));
    const plan = planAdd(existing, [jpg(100, 1000), jpg(101, 1000), jpg(102, 1000)]);
    expect(plan.accepted).toEqual([0, 1]);
    expect(plan.errors).toEqual([tooManyPages(61)]);
  });
  it('does not mix a PDF and photos in one drop', () => {
    const plan = planAdd([], [pdf(), jpg()]);
    expect(plan.accepted).toEqual([]);
    expect(plan.errors).toEqual([MSG.oneKind]);
  });
  it('accepts one PDF out of several', () => {
    const plan = planAdd([], [pdf(MB, 'a.pdf'), pdf(MB, 'b.pdf')]);
    expect(plan.accepted).toEqual([0]);
    expect(plan.errors).toEqual([MSG.onePdf]);
  });
  it('asks before replacing photos with a PDF, and a PDF with photos', () => {
    expect(planAdd([jpg(1)], [pdf()]).replace).toBe('photos-with-pdf');
    expect(planAdd([pdf()], [jpg(1)]).replace).toBe('pdf-with-photos');
    expect(planAdd([pdf()], [pdf(MB, 'b.pdf')]).replace).toBe('pdf-with-pdf');
    expect(planAdd([jpg(1)], [jpg(2)]).replace).toBeNull();
  });
  it('counts the size against what remains after a replace', () => {
    expect(planAdd([jpg(1, 39 * MB)], [pdf(30 * MB)]).accepted).toEqual([0]);
  });
});

describe('move / insertAt', () => {
  it('moves and clamps', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
  });
  it('re-inserts a removed item where it was (Undo)', () => {
    expect(insertAt(['a', 'c'], 1, 'b')).toEqual(['a', 'b', 'c']);
    expect(insertAt(['a'], 9, 'b')).toEqual(['a', 'b']);
  });
});

describe('error code mapping', () => {
  it('maps every upload code to its specified copy', () => {
    expect(uploadErrorMessage('unsupported_type').message).toBe(MSG.unsupported);
    expect(uploadErrorMessage('too_large').message).toBe(MSG.tooLarge);
    expect(uploadErrorMessage('encrypted_pdf').message).toBe(MSG.encrypted);
    expect(uploadErrorMessage('corrupt_file').message).toBe(MSG.corrupt);
    expect(uploadErrorMessage('empty').message).toBe(MSG.empty);
    expect(uploadErrorMessage('rate_limited')).toMatchObject({ message: 'Too many uploads in a short time. Wait a little, then try again.', label: 'TOO MANY UPLOADS', kind: 'error', retry: true });
    expect(uploadErrorMessage('quota_exceeded')).toMatchObject({ message: MSG.limit, kind: 'info', retry: false });
    expect(uploadErrorMessage('network')).toMatchObject({ message: MSG.network, retry: true });
  });
  it('puts the page count from the server message into the too-many-pages copy', () => {
    expect(uploadErrorMessage('too_many_pages', 'PDF has 84 pages').message).toBe(
      'This manual has 84 pages. The limit is 60. If your product is one section of it, upload just those pages.',
    );
    expect(uploadErrorMessage('too_many_pages', '').message).toContain('too many pages');
  });
  it('labels every upload error as in USER_FLOWS 3', () => {
    const label = (c: string) => uploadErrorMessage(c).label;
    expect(['unsupported_type', 'too_large', 'too_many_pages', 'encrypted_pdf', 'corrupt_file', 'rate_limited', 'network', 'whatever'].map(label)).toEqual([
      'FILE TYPE NOT SUPPORTED', 'FILE TOO LARGE', 'TOO MANY PAGES', 'PDF IS LOCKED', "COULDN'T OPEN FILE", 'TOO MANY UPLOADS', 'UPLOAD STOPPED', 'UPLOAD FAILED',
    ]);
    expect(label('quota_exceeded')).toBeUndefined();
    expect(errorLabel(MSG.tooLarge)).toBe('FILE TOO LARGE');
    expect(errorLabel(tooManyPages(84))).toBe('TOO MANY PAGES');
    expect(errorLabel(MSG.oneKind)).toBe('UPLOAD FAILED');
  });
  it('parses the contract error body and falls back safely', () => {
    const e = parseErrorResponse(415, { error: { code: 'unsupported_type', message: 'nope' } });
    expect(e).toMatchObject({ code: 'unsupported_type', status: 415, message: 'nope' });
    expect(parseErrorResponse(404, null).code).toBe('not_found');
    expect(parseErrorResponse(500, '<html>').code).toBe('unknown');
  });
  it('picks failure copy by stage and adds the repeated-failure sentence', () => {
    expect(failureMessage('render', undefined, 1).message).toBe("We couldn't read this file's pages.");
    expect(failureMessage('render', undefined, 1).differentFile).toBe(true);
    expect(failureMessage('analyse', undefined, undefined)).toMatchObject({
      message: "We couldn't build a guide from this manual. This is on our side.",
      differentFile: false,
    });
    expect(failureMessage('verify', undefined, 2).message).toContain("couldn't verify them against the original");
    // The server's own attempts never trigger the repeated copy; only the user's retries do (third failure = 2 retries).
    expect(failureMessage('analyse', undefined, 3, 0)).toMatchObject({ repeated: false, retryAllowed: true });
    expect(failureMessage('analyse', undefined, 3, 1).repeated).toBe(false);
    const third = failureMessage('analyse', undefined, 3, 2);
    expect(third.message.endsWith("It's still not working. Your manual is saved; try again later.")).toBe(true);
    expect(third.retryAllowed).toBe(false);
    expect(failureMessage('ingest', 'all_pages_unreadable', 1).message).toMatch(/brighter light/);
  });
});

describe('polling backoff', () => {
  it('resets on change, grows when unchanged, caps, and backs off harder on errors', () => {
    expect(nextDelay(4000, 'changed')).toBe(POLL_MIN_MS);
    expect(nextDelay(1000, 'same')).toBe(1500);
    expect(nextDelay(4000, 'same')).toBe(POLL_MAX_MS);
    expect(nextDelay(1000, 'error')).toBe(2000);
    expect(nextDelay(8000, 'error')).toBe(POLL_ERROR_MAX_MS);
  });
});

describe('stage rows come only from the real state', () => {
  const base = { pageCount: 20, pagesRendered: 8 };
  it('queued: nothing started', () => {
    const rows = buildRows({ status: 'queued', stage: null, pageCount: null, pagesRendered: null });
    expect(rows.map((r) => r.marker)).toEqual(['pending', 'pending', 'pending', 'pending']);
  });
  it('render: reading pages active with the real page count', () => {
    const rows = buildRows({ status: 'processing', stage: 'render', ...base });
    expect(rows[0]).toMatchObject({ marker: 'active', detail: 'Page 8 of 20' });
    expect(rows[1]?.marker).toBe('pending');
    expect(rows.map((r) => r.label)).toEqual(['Reading pages', 'Finding parts and building steps', 'Double-checking', 'Finishing']);
  });
  it('no page detail when the count is unknown or zero', () => {
    expect(buildRows({ status: 'processing', stage: 'render', pageCount: null, pagesRendered: null })[0]?.detail).toBeNull();
    expect(buildRows({ status: 'processing', stage: 'render', pageCount: 20, pagesRendered: 0 })[0]?.detail).toBeNull();
  });
  it('verify: earlier stages done, double-checking active with its detail', () => {
    const rows = buildRows({ status: 'processing', stage: 'verify', ...base });
    expect(rows.map((r) => r.marker)).toEqual(['done', 'done', 'active', 'pending']);
    expect(rows[2]?.detail).toBe('Comparing numbers and part labels with the original');
  });
  it('failed: the failed row gets the failed marker, earlier ones stay done', () => {
    const rows = buildRows({ status: 'failed', stage: 'verify', ...base });
    expect(rows.map((r) => r.marker)).toEqual(['done', 'done', 'failed', 'pending']);
  });
  it('slow adds the line under the active stage only', () => {
    const rows = buildRows({ status: 'processing', stage: 'analyse', ...base }, true);
    expect(rows[1]?.detail).toBe('Still working - long manuals take longer.');
    expect(rows[0]?.detail).toBeNull();
  });
});

describe('library state', () => {
  const g = (over: Partial<GuideSummary> & { done?: number }): GuideSummary => ({
    id: 'g1',
    documentId: 'd1',
    title: 'T',
    stepCount: 10,
    estimatedMinutes: 30,
    progress: { currentStepId: null, completedCount: over.done ?? 0, percent: 0 },
    status: 'ready',
    updatedAt: Date.parse('2026-01-01T00:00:00Z'),
    thumbnailPage: 0,
    ...over,
  });
  it('derives the card state and link', () => {
    expect(libraryState(g({}))).toBe('ready');
    expect(libraryState(g({ done: 3 }))).toBe('inProgress');
    expect(libraryState(g({ done: 10 }))).toBe('finished');
    expect(libraryState(g({ status: 'processing' }))).toBe('processing');
    expect(libraryState(g({ status: 'failed' }))).toBe('failed');
    expect(guideHref(g({ done: 3 }))).toBe('/g/g1/play');
    expect(guideHref(g({}))).toBe('/g/g1');
    expect(guideHref(g({ done: 10 }))).toBe('/g/g1');
    expect(guideHref(g({ status: 'failed' }))).toBe('/d/d1');
  });
  it('the hero is the first in-progress guide of the given order', () => {
    const list = [g({ id: 'a' }), g({ id: 'b', done: 2 }), g({ id: 'c', done: 5 })];
    expect(hero(list)?.id).toBe('b');
    expect(hero([g({ done: 10 }), g({ status: 'processing' })])).toBeNull();
  });
});

describe('pageList', () => {
  it('words one, two and many pages', () => {
    expect(pageList([7])).toBe('page 7');
    expect(pageList([7, 8])).toBe('pages 7 and 8');
    expect(pageList([7, 8, 12])).toBe('pages 7, 8 and 12');
  });
});
