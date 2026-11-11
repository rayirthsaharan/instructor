'use client';

import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { Skeleton } from './Skeleton';

export type PageTile = {
  id: string;
  /** Object URL for the preview; absent while the browser decodes or converts (HEIC). */
  src?: string;
  name: string;
  loading?: boolean;
};

/**
 * Page-photo thumbnails (DS 7.9): 3 columns (sm), 5 (md), 6 (lg); 3:4 tiles with a page number, a 44px remove
 * button and a menu with "Move earlier / Move later" (the keyboard and screen-reader path). Tiles also drag.
 */
export function PageThumbnailGrid({
  tiles,
  onRemove,
  onMove,
  disabled,
  addTiles,
}: {
  tiles: PageTile[];
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  /** Trailing tiles ("Add more pages"). */
  addTiles?: ReactNode;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  return (
    <ul className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-6" aria-label="Page photos, in reading order">
      {tiles.map((t, i) => (
        <li
          key={t.id}
          data-testid="page-tile"
          draggable={!disabled}
          onDragStart={(e) => {
            setDragFrom(i);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
          }}
          onDragOver={(e) => {
            if (dragFrom === null) return;
            e.preventDefault();
            setDragOver(i);
          }}
          onDrop={(e) => {
            if (dragFrom === null) return;
            e.preventDefault();
            e.stopPropagation();
            onMove(dragFrom, i);
            setDragFrom(null);
            setDragOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragOver(null);
          }}
          className={cn('relative aspect-[3/4]', dragFrom === i && 'opacity-40')}
        >
          <div
            className={cn(
              'absolute inset-0 overflow-hidden rounded-sm border bg-surface-sunken',
              dragOver === i && dragFrom !== i ? 'border-2 border-accent' : 'border-line',
            )}
          >
            {t.loading || !t.src ? (
              <Skeleton className="size-full rounded-none" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not optimisable
              <img src={t.src} alt={`Page ${i + 1} photo: ${t.name}`} className="size-full object-cover" draggable={false} />
            )}
          </div>
          <span className="type-tag absolute bottom-1 left-1 rounded-xs bg-surface px-1.5 py-1 text-ink shadow-elev-1">
            p. {i + 1}
          </span>
          {!t.loading && (
            <>
              <IconButton
                icon="close"
                aria-label={`Remove page ${i + 1}`}
                onClick={() => onRemove(i)}
                disabled={disabled}
                className="absolute right-0 top-0 bg-surface/90"
              />
              <Menu
                label={`Move page ${i + 1}`}
                placement="above"
                className="absolute bottom-0 right-0"
                items={[
                  { label: 'Move earlier', onSelect: () => onMove(i, i - 1), disabled: disabled || i === 0 },
                  { label: 'Move later', onSelect: () => onMove(i, i + 1), disabled: disabled || i === tiles.length - 1 },
                ]}
              />
            </>
          )}
        </li>
      ))}
      {addTiles}
    </ul>
  );
}

/** "Add more pages" tile for the grid. */
export function AddPagesTile({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <li className="aspect-[3/4]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="type-body-sm flex size-full cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed border-ink-subtle bg-surface p-2 text-center text-ink t-fast hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="plus" />
        {label}
      </button>
    </li>
  );
}
