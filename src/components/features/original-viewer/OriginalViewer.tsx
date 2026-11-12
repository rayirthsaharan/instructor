'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BottomSheet, Button, cn, Icon, IconButton } from '@/components/ui';
import { pageImageUrl } from '@/lib/client/api';
import { ExtraIcon } from '../source-visual/icons';
import { SourceVisual } from '../source-visual/SourceVisual';
import type { MarkView, VisualPage } from '../source-visual/pages';

export interface OriginalViewerProps {
  open: boolean;
  documentId: string;
  pageCount: number;
  /** 0-based page being shown. */
  pageIndex: number;
  onPageChange: (pageIndex: number) => void;
  /** Relative change (keys, swipes): resolved against the URL at event time so key repeat never repeats a page. */
  onPageDelta: (delta: number) => void;
  onClose: () => void;
  /** "Back to step 7". */
  closeLabel: string;
  /** Marks (the step's regions) to draw, and the page they belong to; cleared when the page changes. */
  marks: MarkView[];
  markPage: number | null;
  /** 0-based pages the pipeline could not read. */
  unreadable: number[];
}

const stripTile = 'relative shrink-0 overflow-hidden rounded-sm border bg-surface-sunken';

function Thumb({ documentId, index, current, unreadable, onSelect, size }: { documentId: string; index: number; current: boolean; unreadable: boolean; onSelect: () => void; size: 'strip' | 'column' | 'grid' }) {
  // Until the image has loaded the tile is a sunken skeleton, never a blank white page (USER_FLOWS 8).
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Page ${index + 1}${unreadable ? ", couldn't be read" : ''}`}
      aria-current={current ? 'page' : undefined}
      data-testid="page-thumb"
      className={cn(
        stripTile,
        'cursor-pointer',
        current ? 'border-2 border-accent' : 'border-line',
        size === 'strip' && 'h-[72px] w-14',
        size === 'column' && 'aspect-[3/4] w-full',
        size === 'grid' && 'aspect-[3/4] w-full',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail of a user page from our API */}
      <img
        src={pageImageUrl(documentId, index)}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(true);
        }}
        className={cn('size-full bg-white object-cover object-top', !loaded && 'invisible')}
      />
      <span className="type-tag absolute bottom-0 left-0 bg-surface/92 px-1 text-ink">{index + 1}</span>
      {unreadable && (
        <span className="absolute right-0 top-0 rounded-bl-xs bg-warn-soft p-0.5 text-warn-fg">
          <Icon name="warn" size={16} />
        </span>
      )}
    </button>
  );
}

/**
 * Original viewer (USER_FLOWS 8): the unaltered manual, page by page, zoomable, full screen. Opened from a step or
 * region it brackets that region; changing pages clears the brackets. Closing returns to exactly where the user was
 * because the Step player stays mounted underneath.
 */
export function OriginalViewer(p: OriginalViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [marksVisible, setMarksVisible] = useState(true);
  const [grid, setGrid] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p.open && !d.open) d.showModal();
    else if (!p.open && d.open) d.close();
  }, [p.open]);

  const last = Math.max(0, p.pageCount - 1);
  const page = Math.min(Math.max(p.pageIndex, 0), last);
  const marks = p.markPage === page ? p.marks : [];
  const visual: VisualPage = { pageIndex: page, approximate: false, marks };
  const multi = p.pageCount > 1;
  const isUnreadable = p.unreadable.includes(page);
  const go = (i: number) => p.onPageChange(Math.min(last, Math.max(0, i)));

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.defaultPrevented || !multi) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') p.onPageDelta(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') p.onPageDelta(-1);
    else return;
    e.preventDefault();
  };

  const thumbs = (size: 'strip' | 'column') =>
    Array.from({ length: p.pageCount }, (_, i) => (
      <Thumb key={i} documentId={p.documentId} index={i} current={i === page} unreadable={p.unreadable.includes(i)} size={size} onSelect={() => go(i)} />
    ));

  return (
    <dialog
      ref={ref}
      aria-label="Original manual"
      aria-modal="true"
      data-testid="original-viewer"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-surface-sunken p-0 text-ink backdrop:bg-transparent"
    >
      {p.open && (
        <div className="flex size-full flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-4">
            <span className="md:hidden">
              <IconButton icon="close" aria-label={p.closeLabel} onClick={p.onClose} data-testid="viewer-close" />
            </span>
            <span className="hidden md:block">
              <Button variant="quiet" size="sm" leadingIcon="chevronLeft" onClick={p.onClose} data-testid="viewer-close-text">
                {p.closeLabel}
              </Button>
            </span>
            <div className="flex flex-1 items-center justify-center gap-1">
              {multi && (
                <span className="hidden md:block">
                  <IconButton icon="chevronLeft" aria-label="Previous page" disabled={page <= 0} onClick={() => go(page - 1)} data-testid="viewer-prev-md" />
                </span>
              )}
              <p className="type-tag text-center" data-testid="viewer-page">
                Page {page + 1} of {p.pageCount}
              </p>
              {multi && (
                <span className="hidden md:block">
                  <IconButton icon="chevronRight" aria-label="Next page" disabled={page >= last} onClick={() => go(page + 1)} data-testid="viewer-next-md" />
                </span>
              )}
            </div>
            {marks.length > 0 ? (
              <button
                type="button"
                aria-pressed={marksVisible}
                onClick={() => setMarksVisible(!marksVisible)}
                data-testid="viewer-marks"
                className="type-body-sm flex h-11 cursor-pointer items-center gap-1 rounded-sm px-3 font-semibold hover:bg-surface-sunken"
              >
                {marksVisible ? <Icon name="eye" size={20} /> : <ExtraIcon name="eyeOff" size={20} />}
                Marks
              </button>
            ) : (
              <span className="w-11 md:w-20" aria-hidden="true" />
            )}
          </header>

          {isUnreadable && (
            <p className="type-body-sm flex items-center gap-2 bg-warn-soft px-4 py-2 font-semibold text-warn-fg" data-testid="viewer-unreadable">
              <Icon name="warn" size={20} /> We couldn&apos;t read this page
            </p>
          )}

          <div className="flex min-h-0 flex-1">
            {multi && (
              <nav aria-label="Pages" className="hidden w-40 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface p-3 lg:flex">
                {thumbs('column')}
              </nav>
            )}
            <div className="min-w-0 flex-1">
              <SourceVisual
                mode="page"
                pages={[visual]}
                pageIdx={0}
                resetKey={`viewer-${page}`}
                imageUrl={(i) => pageImageUrl(p.documentId, i)}
                altFor={() => `Manual page ${page + 1} of ${p.pageCount}`}
                marksVisible={marksVisible}
                onMarksVisibleChange={setMarksVisible}
                hideMarksButton
                emphasise={marks.length > 0}
                onSwipe={multi ? (d) => p.onPageDelta(d === 'next' ? 1 : -1) : undefined}
              />
            </div>
          </div>

          {multi && (
            <>
              <nav aria-label="Pages" className="hidden shrink-0 gap-2 overflow-x-auto border-t border-line bg-surface p-2 md:flex lg:hidden">
                {thumbs('strip')}
              </nav>
              <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-line bg-surface px-2 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <IconButton icon="chevronLeft" size={56} aria-label="Previous page" disabled={page <= 0} onClick={() => go(page - 1)} data-testid="viewer-prev" />
                <button
                  type="button"
                  onClick={() => setGrid(true)}
                  className="type-tag h-14 flex-1 cursor-pointer rounded-sm hover:bg-surface-sunken"
                  aria-label={`Page ${page + 1} of ${p.pageCount}. Show all pages`}
                >
                  {page + 1} / {p.pageCount}
                </button>
                <IconButton icon="chevronRight" size={56} aria-label="Next page" disabled={page >= last} onClick={() => go(page + 1)} data-testid="viewer-next" />
              </div>
            </>
          )}
          <BottomSheet open={grid} onClose={() => setGrid(false)} title="All pages" initialDetent={p.pageCount <= 9 ? 'half' : 'full'} lgPresentation="dialog">
            <div className="grid grid-cols-3 gap-3 pb-4">
              {Array.from({ length: p.pageCount }, (_, i) => (
                <Thumb
                  key={i}
                  documentId={p.documentId}
                  index={i}
                  current={i === page}
                  unreadable={p.unreadable.includes(i)}
                  size="grid"
                  onSelect={() => {
                    setGrid(false);
                    go(i);
                  }}
                />
              ))}
            </div>
          </BottomSheet>
        </div>
      )}
    </dialog>
  );
}
